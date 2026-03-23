# non-HTTP protocols

using welcome mat enrollment as the identity foundation for non-HTTP protocols.

## the pattern

welcome mat enrollment (steps 1–5) runs over HTTP. the service issues a protocol-native credential in the signup response. the agent uses that credential on the target protocol.

```
agent                                         service
  |                                              |
  |  --- welcome mat enrollment (HTTP) ---       |
  |  steps 1–5: discovery, identity,             |
  |  terms, consent, registration                |
  |<-------------------------------------------->|
  |                                              |
  |  signup response includes:                   |
  |  { protocol-native credential,               |
  |    connection details }                      |
  |                                              |
  |  --- target protocol ---                     |
  |  agent presents credential + proof           |
  |<-------------------------------------------->|
```

1. **enroll over HTTP** — standard welcome mat flow. the agent discovers the service, generates identity, consents to terms, and registers.
2. **receive protocol-native credential** — the signup response returns a server-issued token for the target protocol, bound to the agent's key via `cnf.jkt`.
3. **connect to target protocol** — the agent opens a connection (TCP, WebSocket, gRPC, etc.) and authenticates with the issued credential plus a fresh proof of key possession.
4. **ongoing proof** (recommended) — each message or request on the target protocol carries a proof bound to the credential and the message content.

## identity continuity via `cnf.jkt`

the JWK Thumbprint (`cnf.jkt`) is the bridge between welcome mat enrollment and the target protocol. it appears in:

- the agent's self-signed access token (enrollment)
- the server-issued credential (bridging)
- every proof the agent generates (ongoing)

this means the agent's identity is the same across both protocols — the RSA keypair that proved possession during HTTP enrollment proves possession on the target protocol. no secondary identity, no mapping table.

services SHOULD include `cnf.jkt` in any credential issued for a non-HTTP protocol. agents SHOULD verify that the issued credential's `cnf.jkt` matches their own key before using it.

## designing protocol-native credentials

the credential the server issues in the signup response should be:

- **server-signed** — the service controls issuance, expiry, and revocation. use a symmetric algorithm (HS256) or asymmetric (RS256/ES256) depending on your architecture.
- **key-bound** — include `cnf.jkt` (the agent's JWK Thumbprint) so the credential cannot be used without the corresponding private key.
- **audience-scoped** — include an `aud` claim scoped to the target protocol or endpoint, not the HTTP enrollment surface.
- **protocol-typed** — use a `typ` header value specific to your protocol (e.g., `yourprotocol+jwt`), not `dpop+jwt` or `wm+jwt`.

additional claims are protocol-specific. common ones: `sub` (agent identifier), `exp` (expiry), connection endpoints, roles, capabilities.

## designing protocol-native proofs

on the target protocol, the agent proves key possession per-message or per-session. a proof should include:

- **token binding** (`ath`) — hash of the credential, binding the proof to the specific issued token. same pattern as DPoP's `ath` claim.
- **content binding** (`req_hash` or equivalent) — hash of the message or request content, making each proof tamper-evident.
- **freshness** (`iat`, `jti`) — timestamp and unique identifier to prevent replay.
- **protocol-native type** — use your own `typ` value (e.g., `yourprotocol-pop+jwt`).

per-message proofs are stronger than per-session proofs but more expensive. choose based on your protocol's trust model and performance requirements.

## what this pattern works for

any protocol where a service wants agent-native enrollment but doesn't use HTTP for ongoing communication:

- TCP wire protocols
- WebSocket connections
- gRPC streams
- MQTT
- custom binary protocols

the enrollment surface (HTTP) and the participation surface (target protocol) can run on different hosts, ports, or infrastructure. the `cnf.jkt` binding is the thread that connects them.

## reference implementations

*none yet — this section will be updated as implementations are published.*

## related

- [the welcome mat spec](../spec.md) — steps 1–5 cover enrollment; step 5 discusses server-issued tokens and `token_type` flexibility.
- [RFC 9449 (DPoP)](https://www.rfc-editor.org/rfc/rfc9449) — the proof-of-possession framework welcome mat builds on.
- [RFC 7638 (JWK Thumbprint)](https://www.rfc-editor.org/rfc/rfc7638) — the key fingerprint used for identity continuity.
