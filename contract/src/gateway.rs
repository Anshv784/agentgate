//! Host-facing gateway logic. Everything here touches the T3N host ABI, so it
//! only compiles for wasm32; the decision logic it delegates to lives in
//! `policy` and is unit-tested natively.
#![cfg(target_arch = "wasm32")]

extern crate alloc;
use alloc::{format, string::{String, ToString}, vec, vec::Vec};

use crate::host::{
    interfaces::{http_with_placeholders as hwp, kv_store, logging},
    tenant::tenant_context,
};
use crate::policy;

const MAP_ENDPOINTS: &str = "endpoints";
const MAP_SECRETS: &str = "secrets";
const MAP_AUDIT: &str = "audit";

/// An endpoint the tenant registered. The agent names one of these; it never
/// names a URL, a host, or a credential.
#[derive(serde::Deserialize, serde::Serialize)]
struct Endpoint {
    base: String,
    secret_key: String,
    auth_header: String,
    auth_prefix: String,
    allowed_paths: Vec<String>,
    allowed_placeholders: Vec<String>,
    response_fields: Vec<String>,
    #[serde(default)]
    extra_headers: Vec<(String, String)>,
}

#[derive(serde::Deserialize)]
struct InvokeReq {
    endpoint: String,
    path: String,
    #[serde(default = "post")]
    method: String,
    #[serde(default)]
    body: serde_json::Value,
}
fn post() -> String { "POST".to_string() }

#[derive(serde::Deserialize)]
struct ListReq {
    #[serde(default)]
    limit: Option<u32>,
}

fn map(tail: &str) -> String {
    format!("z:{}:{}", hex::encode(tenant_context::tenant_did()), tail)
}

fn verb(m: &str) -> Result<hwp::Verb, String> {
    Ok(match m.to_ascii_uppercase().as_str() {
        "GET" => hwp::Verb::Get,
        "POST" => hwp::Verb::Post,
        "PUT" => hwp::Verb::Put,
        "PATCH" => hwp::Verb::Patch,
        "DELETE" => hwp::Verb::Delete,
        other => return Err(format!("unsupported method '{other}'")),
    })
}

fn classify(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(h) => format!("egress-denied({h})"),
        hwp::HttpError::PlaceholderDenied(m) => format!("placeholder-denied({m})"),
        hwp::HttpError::PlaceholderUnknown(f) => format!("placeholder-unknown({f})"),
        hwp::HttpError::PlaceholderNoUserContext => "placeholder-no-user-context".to_string(),
        hwp::HttpError::UpstreamError(r) => format!("upstream-error({r})"),
    }
}

/// Append one ledger entry. Records *marker names only* — never resolved values,
/// which the contract never sees anyway.
fn audit(endpoint: &str, path: &str, markers: &[String], status: u16, outcome: &str, detail: &str) -> String {
    let ts = tenant_context::cluster_timestamp_secs();
    let seq = tenant_context::seq_no();
    // ts first so a lexicographic scan is chronological; seq disambiguates
    // two entries landing in the same second.
    let key = format!("{ts:010}-{seq:020}");
    let entry = serde_json::json!({
        "ts": ts, "seq": seq, "endpoint": endpoint, "path": path,
        "markers": markers, "status": status, "outcome": outcome, "detail": detail,
        "caller": tenant_context::calling_user_did().map(hex::encode),
    });
    if let Ok(bytes) = serde_json::to_vec(&entry) {
        let _ = kv_store::put(&map(MAP_AUDIT), key.as_bytes(), &bytes);
    }
    key
}

/// A denial returns `Ok` with `outcome:"denied"`, never `Err`.
///
/// This is deliberate: contract writes are rolled back when a function returns
/// an error, so returning `Err` on a policy denial would roll back the very
/// audit entry recording that denial — an agent could then trip the policy
/// repeatedly and leave no trace. Returning `Ok` commits the ledger write.
fn denied(endpoint: &str, path: &str, markers: &[String], reason: &str) -> Result<Vec<u8>, String> {
    let key = audit(endpoint, path, markers, 0, "denied", reason);
    let _ = logging::info(&format!("DENIED {endpoint}{path}: {reason}"));
    serde_json::to_vec(&serde_json::json!({
        "outcome": "denied", "reason": reason, "audit_key": key,
    }))
    .map_err(|e| e.to_string())
}

pub fn invoke_endpoint(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: InvokeReq = serde_json::from_slice(input).map_err(|e| format!("bad input: {e}"))?;

    let raw = kv_store::get(&map(MAP_ENDPOINTS), req.endpoint.as_bytes())
        .map_err(|e| format!("kv read: {e}"))?;
    let Some(raw) = raw else {
        return denied(&req.endpoint, &req.path, &[], "unknown endpoint");
    };
    let ep: Endpoint = serde_json::from_slice(&raw).map_err(|e| format!("endpoint config: {e}"))?;

    // 1. markers: profile-namespace only, and only fields this endpoint allows
    let body_str = serde_json::to_string(&req.body).map_err(|e| e.to_string())?;
    let found = policy::extract_markers(&body_str);
    let fields = match policy::check_markers(&found, &ep.allowed_placeholders) {
        Ok(f) => f,
        Err(e) => return denied(&req.endpoint, &req.path, &found, &e),
    };

    // 2. path must be one the tenant enumerated
    let url = match policy::resolve_path(&ep.base, &req.path, &ep.allowed_paths) {
        Ok(u) => u,
        Err(e) => return denied(&req.endpoint, &req.path, &fields, &e),
    };

    // 3. credential comes from the sealed map, never from the caller
    let secret = kv_store::get(&map(MAP_SECRETS), ep.secret_key.as_bytes())
        .map_err(|e| format!("kv read: {e}"))?
        .ok_or_else(|| format!("secret '{}' missing from z:<tid>:secrets", ep.secret_key))?;
    let secret = String::from_utf8(secret).map_err(|e| e.to_string())?;

    // Content-Type is deliberately NOT set: the host appends its own rather
    // than replacing ours, producing `application/json,application/json`,
    // which strict upstreams reject. See docs/BUGS.md #1.
    let mut headers = vec![(ep.auth_header.clone(), format!("{}{}", ep.auth_prefix, secret))];
    headers.extend(ep.extra_headers.iter().cloned());

    let payload = serde_json::to_vec(&req.body).map_err(|e| e.to_string())?;
    let resp = match hwp::call(&hwp::Request {
        method: verb(&req.method)?,
        url,
        headers: Some(headers),
        payload: Some(payload),
    }) {
        Ok(r) => r,
        Err(e) => return denied(&req.endpoint, &req.path, &fields, &classify(e)),
    };

    // 4. project the response — the outbound leg is protected by the host, the
    //    inbound one is only protected here.
    let data = policy::filter_response(&resp.payload, &ep.response_fields);
    let outcome = if (200..300).contains(&resp.code) { "ok" } else { "upstream_error" };
    let key = audit(&req.endpoint, &req.path, &fields, resp.code, outcome, "");
    let _ = logging::info(&format!("{outcome} {} {} -> {}", req.endpoint, req.path, resp.code));

    serde_json::to_vec(&serde_json::json!({
        "outcome": outcome, "status": resp.code, "data": data, "audit_key": key,
    }))
    .map_err(|e| e.to_string())
}

pub fn audit_list(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ListReq = serde_json::from_slice(input).unwrap_or(ListReq { limit: None });
    let limit = req.limit.unwrap_or(50).clamp(1, 500);
    let rows = kv_store::scan(&map(MAP_AUDIT), b"", &[0xff; 32], limit)
        .map_err(|e| format!("scan: {e}"))?;
    let entries: Vec<serde_json::Value> = rows
        .iter()
        .filter_map(|(_, v)| serde_json::from_slice(v).ok())
        .collect();
    serde_json::to_vec(&serde_json::json!({ "count": entries.len(), "entries": entries }))
        .map_err(|e| e.to_string())
}

pub fn endpoint_list(_input: &[u8]) -> Result<Vec<u8>, String> {
    let rows = kv_store::scan(&map(MAP_ENDPOINTS), b"", &[0xff; 32], 100)
        .map_err(|e| format!("scan: {e}"))?;
    let mut out = Vec::new();
    for (k, v) in rows.iter() {
        let name = String::from_utf8_lossy(k).to_string();
        let Ok(ep) = serde_json::from_slice::<Endpoint>(v) else { continue };
        // secret_key is the map key of the credential, not the credential —
        // still withheld, so a compromised agent learns nothing about layout.
        out.push(serde_json::json!({
            "name": name, "base": ep.base,
            "allowed_paths": ep.allowed_paths,
            "allowed_placeholders": ep.allowed_placeholders,
            "response_fields": ep.response_fields,
        }));
    }
    serde_json::to_vec(&serde_json::json!({ "endpoints": out })).map_err(|e| e.to_string())
}
