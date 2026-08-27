//! AgentGate — a governed outbound tool-call gateway for AI agents on T3N.
//!
//! The agent names an endpoint, not a URL. It supplies a body that may carry
//! `{{profile.<field>}}` markers. This contract:
//!   1. checks every marker against that endpoint's allowlist,
//!   2. checks the path against the endpoint's enumerated paths,
//!   3. loads the credential from its sealed KV map (the agent never holds it),
//!   4. lets the host substitute PII inside the enclave,
//!   5. projects the upstream response down to declared fields, and
//!   6. appends a ledger entry — for allowed AND denied calls alike.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "agentgate",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

mod gateway;
pub mod policy;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::agentgate::contracts::Guest for Component {
    fn invoke_endpoint(
        req: exports::z::agentgate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        gateway::invoke_endpoint(&req.input.ok_or("invoke-endpoint: missing input")?)
    }

    fn audit_list(
        req: exports::z::agentgate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        gateway::audit_list(&req.input.unwrap_or_default())
    }

    fn endpoint_list(
        req: exports::z::agentgate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        gateway::endpoint_list(&req.input.unwrap_or_default())
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
