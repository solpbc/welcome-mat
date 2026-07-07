# agent authorization

**status:** draft
**extends:** [the welcome mat specification](../spec.md), version 1.1

> **for humans:** this extension defines how a welcome mat service becomes an OAuth authorization server for its enrolled agents — a JSON preview replaces the consent screen, and the agent's authenticated fetch of the authorize URL replaces the login form and the consent click. it is written against the [atproto OAuth profile](https://atproto.com/specs/oauth) and composes with any OAuth 2.1 deployment that mandates [pushed authorization requests (RFC 9126)](https://www.rfc-editor.org/rfc/rfc9126).

## abstract

OAuth assumes a human at the authorization server: the server authenticates its account owner with a login form and collects consent with a button. the atproto OAuth profile mandates this interactive authorization interface and defines no machine grant. an agent account has no human to put in front of that screen — but it has the cryptographic identity it enrolled with.

this extension changes exactly one endpoint's behavior. a welcome mat service that is also an OAuth authorization server authenticates authorization requests with the agent's enrolled credential: an unauthenticated fetch of the authorize URL returns a JSON consent preview — the consent screen, for a reader that is an agent — and the same URL fetched as a standard authenticated welcome mat request *is* the login and the consent. everything else — discovery, client metadata, pushed authorization requests, PKCE, the token endpoint, DPoP binding, refresh — is unmodified OAuth per the host profile. clients need no modification and no knowledge of this extension; a stock atproto OAuth client completes the flow unchanged.

the enrolled key plays exactly the role a password plays for a human account: the root credential that grants delegated, scoped, independently revocable sessions to apps and tools. the root key never leaves the agent; apps hold only OAuth tokens.

```
enrolled welcome mat keypair (root — never leaves the agent)
 └── OAuth grants, one per app or service (delegated, scoped, revocable)
      ├── app A:  scope atproto + repo:org.example.record
      ├── app B:  scope atproto (identity only)
      └── app C:  revoked independently at the authorization server
```

## flow

```
client (stock OAuth client)   agent (enrolled)         service (welcome mat + AS)
  |                              |                         |
  |  1. discovery, metadata, PAR ------------------------->|   standard
  |<---- request_uri --------------------------------------|
  |  2. authorize URL ---------->|                         |
  |                              |  3. GET authorize URL   |
  |                              |     (unauthenticated) ->|   preview
  |                              |<-- JSON consent_request |
  |                              |  4. GET authorize URL   |
  |                              |     Authorization:      |
  |                              |       DPoP <wm+jwt>     |
  |                              |     DPoP: <proof> ----->|   consent
  |                              |<-- 302 redirect_uri     |
  |                              |      ?code&state&iss ---|
  |  5. callback URL <-----------|                         |
  |  6. token exchange (PKCE + DPoP) --------------------->|   standard
  |<---- access + refresh tokens --------------------------|
```

steps 1, 2, 5, and 6 are the host OAuth profile, byte for byte. steps 3 and 4 are this extension.

## advertise

a service implementing this extension SHOULD declare it in its welcome.md — for example in the endpoints section:

```
- authorization server: enrolled agents authorize OAuth clients by signed
  fetch of the authorize URL (agent authorization extension)
```

this declaration is for agents. OAuth clients never read welcome.md — they discover the authorization server through the host profile's standard metadata (for atproto: `/.well-known/oauth-protected-resource` on the resource server, then `/.well-known/oauth-authorization-server`).

## preview

an unauthenticated `GET` of the authorize URL (the URL an OAuth client constructs after PAR — `/oauth/authorize?client_id=...&request_uri=...`) MUST return JSON with content type `application/json` instead of an HTML login page:

```json
{
  "consent_request": {
    "client_id": "https://app.example.com/client-metadata.json",
    "client_metadata": {
      "client_name": "example app",
      "client_uri": "https://app.example.com"
    },
    "scope": "atproto transition:generic",
    "redirect_uri": "http://127.0.0.1/callback",
    "login_hint": null
  },
  "how_to_consent": "GET this URL again with an `Authorization: DPoP <wm+jwt>` header and a matching DPoP proof built from the granting account's welcome-mat credential to grant; append deny=1 to refuse."
}
```

`consent_request` MUST include `client_id`, the requested `scope`, and the `redirect_uri`, and SHOULD include the display fields of the client metadata the server resolved and validated at PAR time (`client_name`, `client_uri`, `logo_uri`, `policy_uri`, `tos_uri`). `how_to_consent` SHOULD restate the consent mechanics in prose — the welcome mat convention that every machine surface is also self-documenting.

this is the consent screen. agents SHOULD fetch the preview and evaluate the client identity and requested scopes against their own consent policy before signing anything.

## consent

consent is the same authorize URL fetched as a standard authenticated welcome mat request (spec, "authenticated requests"): `Authorization: DPoP <access token>` plus a DPoP proof with `ath`. the server:

1. validates the request exactly as it validates any authenticated welcome mat request — DPoP proof per [RFC 9449 section 4.3](https://www.rfc-editor.org/rfc/rfc9449#section-4.3), access token, ToS hash
2. MUST enforce single use of the proof's `jti` for consent, and single use of the `request_uri` (atomic consume — a `request_uri` grants at most one authorization code)
3. maps the proof key's thumbprint to the enrolled account; the authenticated request is that account's consent to the authorization request named by `request_uri`
4. responds with the host profile's standard redirect:

```
HTTP/1.1 302 Found
Location: <redirect_uri>?code=...&state=...&iss=...
```

the agent delivers the callback URL to the client (loopback redirect, paste-back — whatever the client's redirect flow expects), and the flow proceeds standard: the client exchanges the code at the token endpoint with its PKCE verifier and its own DPoP key.

only the enrolled root credential can grant consent. servers MUST reject consent attempts authenticated with OAuth access tokens they themselves issued — delegated credentials cannot mint further delegations.

## denial

to refuse, the agent simply does not sign — the pushed authorization request expires on its own (PAR lifetime). servers SHOULD also accept an explicit denial: the same authenticated fetch with `deny=1` appended to the authorize URL's query. the server discards the pending request and responds with the standard error redirect:

```
HTTP/1.1 302 Found
Location: <redirect_uri>?error=access_denied&state=...&iss=...
```

the agent MAY deliver this callback URL to the client so it fails fast instead of timing out.

## security considerations

- **the signature is the consent.** any authorize URL the agent fetches authenticated, it has authorized. this is the same phishing surface a human faces at a consent screen, and the preview exists so the agent can look before it signs. agent-side consent policy — known clients, expected scopes, trusted `client_id` origins — replaces the human's judgment. agents SHOULD NOT sign authorize URLs they were handed without reading the preview.
- **`htu` does not cover the query.** per [RFC 9449 section 4.2](https://www.rfc-editor.org/rfc/rfc9449#section-4.2) the DPoP proof's `htu` is the target URI without query or fragment, so the proof binds to the authorize endpoint, not to a specific `request_uri`. the consent binding is carried by the authenticated request naming the `request_uri`, single-use enforcement on both the consent proof's `jti` and the `request_uri`, the proof's `iat` window, `ath`, and TLS. implementations MUST NOT build nonstandard full-URL `htu` values — off-the-shelf DPoP libraries construct `htu` per the RFC.
- **ToS-gated consent.** the consent leg inherits welcome mat ToS-gated validity: if the service's terms changed, the consent fetch fails with `401 {"error": "tos_changed"}` and the agent MUST re-consent to the service's terms before it can authorize anything. an agent cannot delegate access under terms it hasn't accepted.
- **root and delegated credentials.** compromise of an OAuth token compromises one grant, revocable at the server without touching the enrolled key. re-authorization costs one signed fetch — no human in the loop — so servers SHOULD prefer short token lifetimes and session caps over long-lived grants.
- **everything standard stays standard.** PAR request lifetime, single-use short-lived authorization codes, PKCE, DPoP-bound tokens, refresh rotation — all host-profile hardening applies unchanged.

## atproto profile notes

when the host profile is atproto OAuth: mandatory PAR, PKCE, and DPoP; `client_id` is a URL to a client metadata document the server fetches and validates; discovery is two-hop (`/.well-known/oauth-protected-resource` → authorization server metadata); the token response's `sub` is the account's DID, which clients verify against the DID document. none of that changes under this extension.

an agent PDS whose authorization server implements agent authorization admits its agents to any atproto OAuth service through the same code path human accounts use — a relying party that only wants "sign in with your atproto identity" requests the `atproto` scope and receives a verified DID. first implementation: [rookery](https://github.com/solpbc/rookery), the agent PDS behind [rook.host](https://rook.host) — a stock `@atproto/oauth-client-node` completes login and repo writes against it with zero modification.

## license

CC0 — this work is dedicated to the public domain, same as the welcome mat specification.
