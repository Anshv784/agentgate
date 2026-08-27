# X post draft

Tag **@terminal3io** for the challenge bonus. Post the repo link, attach the demo
screenshot (four denials + the allowed send).

---

## Main post

> Built **AgentGate** on @terminal3io's Agent Developer Kit.
>
> An AI agent that sends a personalised email to a real person — without ever seeing
> their email address.
>
> No API key. No URL. No PII. It names an *endpoint*, and a TEE decides the rest.
>
> github.com/Anshv784/agentgate

*(attach: the `npm run demo` screenshot)*

---

## Thread

**2/**
> The agent holds a bearer token and nothing else — its signing key was minted inside
> the enclave and never left.
>
> Policy, credentials and the audit ledger all live on the other side of a boundary the
> agent can't reach. Prompt-level guardrails are advisory. This isn't.

**3/**
> Every attempt is recorded — allowed *and* denied.
>
> ```
> denied   0  resend/emails   'ssn' is not allowed on this endpoint
> denied   0  resend/domains  path not enumerated
> ok     200  resend/emails   markers=[first_name, last_name, email]
> ```
>
> It logs which profile fields were referenced. Never their values — the contract
> never had them.

**4/**
> Subtle one: denials return Ok, not Err.
>
> T3N rolls back contract writes on error — so returning Err on a policy denial would
> roll back the audit entry recording that denial. An agent could probe your policy
> surface all day and leave no trace.

**5/**
> It ships as an MCP server, so any MCP client gets governed tool calls by adding one
> config entry. No framework, no rewrite.
>
> Adding an endpoint is one JSON block — no Rust, no redeploy.

**6/**
> Also filed 13 bugs against the platform, each with a runnable reproduction.
>
> Including: the host appends its own Content-Type instead of replacing yours, so
> upstreams silently receive `application/json,application/json` and drop the body.
> Affects @terminal3io's own reference contract.
>
> github.com/Anshv784/agentgate/blob/main/docs/BUGS.md

---

## Shorter single-post version

> An AI agent that emails a real person without ever seeing their email address.
>
> Built **AgentGate** on @terminal3io's ADK — policy, credentials and audit trail inside
> a TEE the agent can't reach. Ships as an MCP server.
>
> 13 bugs filed along the way, with reproductions.
>
> github.com/Anshv784/agentgate
