//! Pure policy logic — no host calls, so it runs (and is tested) natively.
//!
//! Three checks the platform does NOT do for you:
//!   1. every `{{...}}` marker is a `profile.` marker this endpoint allows
//!   2. the path is one this endpoint enumerated
//!   3. the upstream response is projected down to declared fields
//!
//! (3) matters because `http-with-placeholders` protects only the OUTBOUND leg.
//! The upstream response returns into WASM in full, so an endpoint that echoes
//! its request would hand the caller back the very PII the markers withheld.
//! Verified empirically — see docs/BUGS.md "Design note".

extern crate alloc;
use alloc::{format, string::{String, ToString}, vec::Vec};
use serde_json::Value;

/// Every `{{ ... }}` marker in the text, deduped, marker body verbatim.
pub fn extract_markers(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        let after = &rest[i + 2..];
        let Some(j) = after.find("}}") else { break };
        let m = after[..j].trim().to_string();
        if !out.contains(&m) {
            out.push(m);
        }
        rest = &after[j + 2..];
    }
    out
}

/// Deny unless every marker is `profile.<field>` and `<field>` is allowlisted.
/// A marker in any other namespace is rejected here rather than handed to the
/// host to adjudicate.
pub fn check_markers(found: &[String], allowed: &[String]) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    for m in found {
        let Some(field) = m.strip_prefix("profile.") else {
            return Err(format!("marker rejected: '{m}' is not a profile marker"));
        };
        if !allowed.iter().any(|a| a == field) {
            return Err(format!(
                "marker rejected: '{field}' is not in this endpoint's allowed_placeholders"
            ));
        }
        fields.push(field.to_string());
    }
    Ok(fields)
}

/// Exact match only — no globs, no prefixes. An agent cannot reach a path the
/// tenant did not enumerate, even on an allowed host.
pub fn resolve_path(base: &str, path: &str, allowed: &[String]) -> Result<String, String> {
    if path.contains("://") || path.contains("..") || !path.starts_with('/') {
        return Err(format!("path rejected: '{path}' must be a plain absolute path"));
    }
    if !allowed.iter().any(|a| a == path) {
        return Err(format!("path rejected: '{path}' is not in this endpoint's allowed_paths"));
    }
    Ok(format!("{}{}", base.trim_end_matches('/'), path))
}

/// Deny-by-default projection: an endpoint declaring no `response_fields` gets
/// a status code back and nothing else.
pub fn filter_response(body: &[u8], fields: &[String]) -> Value {
    let empty = Value::Object(serde_json::Map::new());
    if fields.is_empty() {
        return empty;
    }
    let Ok(v) = serde_json::from_slice::<Value>(body) else { return empty };
    let mut out = serde_json::Map::new();
    for f in fields {
        if let Some(found) = v.get(f) {
            out.insert(f.clone(), found.clone());
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

    #[test]
    fn extracts_and_dedupes_markers() {
        let b = r#"{"to":"{{profile.email}}","cc":"{{profile.email}}","n":"{{profile.first_name}}"}"#;
        assert_eq!(extract_markers(b), s(&["profile.email", "profile.first_name"]));
    }

    #[test]
    fn unterminated_marker_terminates() {
        assert_eq!(extract_markers("{{profile.email"), Vec::<String>::new());
    }

    #[test]
    fn rejects_non_profile_namespace() {
        let e = check_markers(&s(&["secret.resend_api_key"]), &s(&["email"])).unwrap_err();
        assert!(e.contains("is not a profile marker"), "{e}");
    }

    #[test]
    fn rejects_marker_outside_endpoint_allowlist() {
        let e = check_markers(&s(&["profile.ssn"]), &s(&["first_name"])).unwrap_err();
        assert!(e.contains("allowed_placeholders"), "{e}");
    }

    #[test]
    fn accepts_allowlisted_markers() {
        assert_eq!(
            check_markers(&s(&["profile.first_name"]), &s(&["first_name", "ssn"])).unwrap(),
            s(&["first_name"])
        );
    }

    #[test]
    fn path_must_be_enumerated_and_cannot_escape() {
        let allowed = s(&["/emails"]);
        assert_eq!(
            resolve_path("https://api.resend.com/", "/emails", &allowed).unwrap(),
            "https://api.resend.com/emails"
        );
        for bad in ["/admin", "https://evil.test/emails", "/emails/../admin", "emails"] {
            assert!(resolve_path("https://api.resend.com", bad, &allowed).is_err(), "{bad} slipped through");
        }
    }

    #[test]
    fn response_is_projected_not_passed_through() {
        let upstream = br#"{"id":"abc","to":"real@person.test","secret":"leak"}"#;
        let out = filter_response(upstream, &s(&["id"]));
        assert_eq!(out.get("id").unwrap(), "abc");
        assert!(out.get("to").is_none() && out.get("secret").is_none());
    }

    #[test]
    fn no_declared_fields_means_nothing_comes_back() {
        assert_eq!(filter_response(br#"{"id":"abc"}"#, &[]).as_object().unwrap().len(), 0);
    }

    #[test]
    fn non_json_upstream_body_does_not_leak() {
        assert_eq!(filter_response(b"<html>oops</html>", &s(&["id"])).as_object().unwrap().len(), 0);
    }
}
