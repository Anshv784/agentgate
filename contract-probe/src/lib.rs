//! Probe contract: answers, empirically, which `{{profile.*}}` markers the T3N
//! host will resolve — and how it fails for the ones it won't.
//!
//! Deliberately echoes resolved values back into WASM so we can SEE them. That
//! is the opposite of what a production contract should do; this exists only to
//! map the placeholder surface, and is not part of the shipped gateway.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;
use alloc::{format, string::{String, ToString}, vec::Vec};

wit_bindgen::generate!({
    world: "agentgate-probe",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

#[cfg(target_arch = "wasm32")]
use host::interfaces::{http as http_iface, http_with_placeholders as hwp, logging};

#[derive(serde::Deserialize)]
struct ProbeReq {
    url: String,
    #[serde(default)]
    markers: Vec<String>,
    /// When false, send NO headers at all — isolates whether the host is the
    /// one appending Content-Type.
    #[serde(default)]
    send_content_type: bool,
}

#[derive(serde::Serialize)]
struct MarkerResult {
    marker: String,
    ok: bool,
    verdict: String,
}

/// Classify the host's typed error so each variant is distinguishable.
#[cfg(target_arch = "wasm32")]
fn classify(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(h) => format!("egress-denied({h})"),
        hwp::HttpError::PlaceholderDenied(m) => format!("placeholder-denied({m})"),
        hwp::HttpError::PlaceholderUnknown(f) => format!("placeholder-unknown({f})"),
        hwp::HttpError::PlaceholderNoUserContext => "placeholder-no-user-context".to_string(),
        hwp::HttpError::UpstreamError(r) => format!("upstream-error({r})"),
    }
}

#[cfg(target_arch = "wasm32")]
fn probe_placeholders(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ProbeReq = serde_json::from_slice(input).map_err(|e| format!("bad input: {e}"))?;
    let mut results = Vec::new();

    // One request per marker: a denied marker aborts its own call only, so a
    // single bad marker can't mask verdicts for the rest.
    for marker in &req.markers {
        let body = serde_json::json!({ "probe": format!("{{{{profile.{marker}}}}}") });
        let payload = serde_json::to_vec(&body).map_err(|e| e.to_string())?;

        let r = hwp::call(&hwp::Request {
            method: hwp::Verb::Post,
            url: req.url.clone(),
            headers: if req.send_content_type {
                Some(alloc::vec![("Content-Type".to_string(), "application/json".to_string())])
            } else { None },
            payload: Some(payload),
        });

        let (ok, verdict) = match r {
            // Echo service returns our body back; truncate so a chatty bin
            // can't blow the response size.
            Ok(resp) => (
                resp.code == 200,
                format!("HTTP {} | {}", resp.code,
                    String::from_utf8_lossy(&resp.payload).chars().take(600).collect::<String>()),
            ),
            Err(e) => (false, classify(e)),
        };
        let _ = logging::info(&format!("marker {marker} -> ok={ok}"));
        results.push(MarkerResult { marker: marker.clone(), ok, verdict });
    }

    serde_json::to_vec(&serde_json::json!({ "results": results })).map_err(|e| e.to_string())
}

/// Plain `http` with no placeholders — isolates "egress works" from
/// "placeholders resolve", so a failure above can't be misread.
#[cfg(target_arch = "wasm32")]
fn probe_egress(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ProbeReq = serde_json::from_slice(input).map_err(|e| format!("bad input: {e}"))?;
    let resp = http_iface::call(&http_iface::Request {
        method: http_iface::Verb::Post,
        url: req.url.clone(),
        headers: if req.send_content_type {
            Some(alloc::vec![("Content-Type".to_string(), "application/json".to_string())])
        } else { None },
        payload: Some(b"{\"probe\":\"no-placeholders\"}".to_vec()),
    })
    .map_err(|e| format!("http error: {e}"))?;

    serde_json::to_vec(&serde_json::json!({
        "code": resp.code,
        "body": String::from_utf8_lossy(&resp.payload).chars().take(600).collect::<String>(),
    }))
    .map_err(|e| e.to_string())
}

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::agentgate_probe::contracts::Guest for Component {
    fn probe_placeholders(
        req: exports::z::agentgate_probe::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        probe_placeholders(&req.input.ok_or("probe-placeholders: missing input")?)
    }
    fn probe_egress(
        req: exports::z::agentgate_probe::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        probe_egress(&req.input.ok_or("probe-egress: missing input")?)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
