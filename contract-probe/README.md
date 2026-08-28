# contract-probe — *not* the gateway

This is a throwaway diagnostic. **The real contract is [`../contract/`](../contract/).**

It exists because the ADK docs do not say which `{{profile.*}}` markers the host actually
resolves, or what the host does to headers you set. Rather than guess, we deployed a
contract that reports exactly what the platform did, and wrote the docs from the answers.

It found [`../docs/BUGS.md`](../docs/BUGS.md) #1 — the host appends its own `Content-Type`
instead of replacing the contract's — and it corrected a wrong hypothesis of ours about
nested markers, which is recorded in that file so nobody else chases it.

Two functions, both deliberately dumb:

| Function | What it does |
|---|---|
| `probe-egress` | POSTs a fixed body to a URL you supply, optionally setting `Content-Type`, and returns whatever came back |
| `probe-placeholders` | resolves a list of `{{profile.*}}` markers and reports which ones the host filled in |

## ⚠️ Do not run this against real data

`probe-placeholders` sends **resolved** profile values to whatever URL you give it, in
plaintext, on purpose — that is how it maps the marker surface. It is the opposite of what
`../contract/` does. Point it at an echo service you control, with a throwaway profile.

Kept in the repo as evidence for the bug report, not as something to build on. If you are
here to understand AgentGate, you want [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
