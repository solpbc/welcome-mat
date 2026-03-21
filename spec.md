# the welcome mat specification

**version:** 1.0 (draft)

> **for humans:** this spec is a minimum profile of [DPoP (RFC 9449)](https://www.rfc-editor.org/rfc/rfc9449) optimized for agents to read and implement autonomously. for the full protocol details, refer to the RFC itself.

## abstract

the welcome mat is the signup pattern for services built for AI agents. agents autonomously discover and register using cryptographic identity, signed consent, and proof-of-possession authentication. it follows a [Trust on First Use (TOFU)](https://en.wikipedia.org/wiki/Trust_on_first_use) model — the same trust pattern behind SSH — where both sides accept the other's identity on first contact, then verify cryptographically on every subsequent request.

a service publishes a markdown file at `/.well-known/welcome.md` describing its requirements and enrollment flow. agents discover this file, generate a cryptographic identity, sign the service's terms, and register — no human intervention required.

authentication is built on DPoP ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)). agents prove key possession on every request via signed DPoP proofs in HTTP headers. the access token is a self-signed JWT encoding the agent's consent to the service's current terms of service. when terms change, existing tokens become invalid — agents must re-consent to continue.

## the welcome.md file

### location

the file MUST be served at `/.well-known/welcome.md` over HTTPS with content type `text/markdown` or `text/plain`.

### format

plain markdown with required and optional sections. the file is both human-readable documentation and the machine-readable discovery endpoint — agents parse the markdown directly.

### required sections

| section | description |
|---------|-------------|
| service name | the H1 heading. identifies the service. |
| description | a brief paragraph explaining what the service does and what agents can do here. |
| requirements | protocol version, supported DPoP algorithms, minimum key sizes. |
| endpoints | URLs for terms of service (GET) and signup (POST), plus any service-specific API endpoints. |
| enrollment flow | step-by-step instructions with request/response examples for the complete signup process. |

### optional sections

| section | description |
|---------|-------------|
| signup requirements | service-specific fields required during registration (handle, subject, etc.). |
| rate limits | request rate limits, cooldown periods, or throttling policies. |
| pricing | cost information, free tier limits, or payment requirements. |
| usage policies | acceptable use, content policies, or behavioral expectations. |

### example

see [examples/welcome.md](examples/welcome.md) for a complete example.

## enrollment flow

```
agent                                         service
  |                                              |
  |  GET /.well-known/welcome.md                 |
  |--------------------------------------------->|
  |  markdown (endpoints, algorithms,            |
  |   signup requirements)                       |
  |<---------------------------------------------|
  |                                              |
  |  GET /tos                                    |
  |--------------------------------------------->|
  |  terms of service text                       |
  |<---------------------------------------------|
  |                                              |
  |  sign ToS text with private key              |
  |  generate self-signed access token JWT       |
  |   { tos_hash, aud, cnf, iat, jti }           |
  |                                              |
  |  POST /signup                                |
  |  DPoP: <proof>                               |
  |  Body: { tos_signature, access_token,        |
  |          ...service-specific fields }         |
  |--------------------------------------------->|
  |  { access_token, token_type: "DPoP",         |
  |    ...service-specific response }            |
  |<---------------------------------------------|
  |                                              |
  |  --- enrolled ---                            |
  |                                              |
  |  POST /api/action                            |
  |  Authorization: DPoP <access_token>          |
  |  DPoP: <proof, with ath>                     |
  |  Body: { business data }                     |
  |--------------------------------------------->|
  |  { ok }                                      |
  |<---------------------------------------------|
```

### 1. discovery

the agent fetches `GET /.well-known/welcome.md` from the service. this returns the welcome mat file containing requirements, endpoints, and enrollment instructions.

agents SHOULD check for `/.well-known/welcome.md` on any service they want to interact with. the presence of this file indicates the service supports agent-initiated signup.

### 2. identity generation

the agent generates a keypair using one of the algorithms listed in the service's requirements section. the public key becomes the agent's identity on this service. the private key MUST be stored securely and never transmitted.

agents MAY reuse the same keypair across multiple services (portable identity) or generate a unique keypair per service (isolated identity). note that key reuse across services enables cross-service correlation via [JWK Thumbprint](https://www.rfc-editor.org/rfc/rfc7638) — agents that need unlinkability SHOULD use unique keys per service.

### 3. terms retrieval

the agent fetches the terms of service from the URL specified in the welcome.md endpoints section. this is a plain `GET` request — no authentication required. the terms are a public document.

the response body is the canonical text the agent must sign. services SHOULD serve terms as `text/plain` or `text/markdown` for unambiguous agent consumption.

### 4. consent and access token generation

the agent performs two operations locally:

**sign the ToS text** — a signature over the UTF-8 encoded bytes of the ToS response body, using the [JWA](https://www.rfc-editor.org/rfc/rfc7518) algorithm that matches the `alg` value the agent will use in its DPoP proofs (e.g., RSASSA-PKCS1-v1_5 with SHA-256 for `RS256`). the signature is base64url-encoded.

**generate a self-signed access token** — a JWT signed with the agent's private key:

```
HEADER: {"typ": "wm+jwt", "alg": "<algorithm>"}
PAYLOAD: {
  "jti": "<unique identifier>",
  "tos_hash": "<base64url-encoded SHA-256 of the ToS text>",
  "aud": "<service origin, e.g. https://example.com>",
  "cnf": {"jkt": "<JWK SHA-256 Thumbprint per RFC 7638>"},
  "iat": <unix timestamp>
}
```

| claim | required | description |
|-------|----------|-------------|
| `jti` | REQUIRED | unique token identifier |
| `tos_hash` | REQUIRED | base64url(SHA-256(ToS text)) — binds the token to the specific terms the agent consented to |
| `aud` | REQUIRED | the service's origin URL — prevents cross-service token confusion |
| `cnf.jkt` | REQUIRED | JWK SHA-256 Thumbprint ([RFC 7638](https://www.rfc-editor.org/rfc/rfc7638)) of the agent's public key — explicit key binding per [RFC 9449 section 6](https://www.rfc-editor.org/rfc/rfc9449#section-6) |
| `iat` | REQUIRED | token creation time (unix timestamp) |
| `exp` | OPTIONAL | expiration time — services MAY require this |

### 5. registration

the agent sends `POST /signup` (or the service's configured signup endpoint) with:

- a DPoP proof in the `DPoP` HTTP header
- a JSON body containing:
  - `tos_signature`: the base64url-encoded signature of the ToS text
  - `access_token`: the self-signed access token JWT
  - any service-specific fields declared in the welcome.md signup requirements

```json
{
  "tos_signature": "base64url-encoded-signature-of-tos-text",
  "access_token": "eyJ0eXAiOiJ3bStqd3QiLC..."
}
```

the DPoP proof on this request has no `ath` claim. the access token in the body is a *proposed* credential, not an authentication credential — the DPoP proof alone authenticates this request via key possession. the `ath` binding begins on the first authenticated request after enrollment.

the DPoP proof MUST include the following structure per [RFC 9449 section 4.2](https://www.rfc-editor.org/rfc/rfc9449#section-4.2):

```
HEADER: {
  "typ": "dpop+jwt",
  "alg": "<algorithm>",
  "jwk": <agent's public key as JWK>
}
PAYLOAD: {
  "jti": "<unique proof identifier>",
  "htm": "<HTTP method, e.g. POST>",
  "htu": "<HTTP target URI, without query/fragment>",
  "iat": <unix timestamp>
}
```

the server:

1. validates the DPoP proof per [RFC 9449 section 4.3](https://www.rfc-editor.org/rfc/rfc9449#section-4.3) — including `typ`, `alg`, `jwk`, signature, `jti`, `htm`, `htu`, `iat`
2. verifies `tos_signature` against the current ToS text using the JWK from the DPoP proof
3. validates the access token JWT — signature matches the same key, `tos_hash` matches SHA-256 of current ToS text, `aud` matches the service's origin, `cnf.jkt` matches the JWK Thumbprint from the DPoP proof
4. processes any service-specific signup fields
5. returns the approved access token:

```json
{
  "access_token": "the-access-token",
  "token_type": "DPoP"
}
```

the server MAY return the agent's self-signed access token unchanged, or MAY return a different server-issued access token (e.g., a server-signed JWT with additional claims per RFC 9449 section 6). the agent MUST use whichever access token the server returns.

### 6. authenticated requests

after enrollment, API requests use standard DPoP authentication:

```
POST /api/action HTTP/1.1
Host: example.com
Authorization: DPoP <access_token>
DPoP: <proof JWT with ath>
Content-Type: application/json

{"business": "data"}
```

the DPoP proof includes the `ath` claim — the base64url-encoded SHA-256 hash of the access token string. this binds each proof to the specific access token per [RFC 9449 section 4.2](https://www.rfc-editor.org/rfc/rfc9449#section-4.2).

request bodies contain only business data. authentication is entirely in HTTP headers.

## access token

### self-signed (stateless)

when the server returns the agent's self-signed access token unchanged, no server signing key is needed. on subsequent requests, the server:

1. validates the DPoP proof per RFC 9449 section 4.3
2. verifies the access token signature using the JWK from the DPoP proof — the same key MUST sign both
3. checks `aud` matches the service's origin
4. checks `cnf.jkt` matches the JWK Thumbprint of the key in the DPoP proof
5. checks `tos_hash` in the access token matches SHA-256 of the server's current ToS text
6. checks `ath` in the DPoP proof matches SHA-256 of the access token string
7. processes the request

the server validates the agent's self-signed token using the key presented in the DPoP proof. no stored state is required beyond the current ToS text. services MAY store additional account data (profiles, service-specific state) while still using stateless authentication.

self-signed access tokens allow agents to mint new tokens with updated claims (including `tos_hash`) without going through the signup flow. this is a known property of the self-signed model. services that require enforceable re-consent on ToS changes SHOULD issue server-signed access tokens.

### server-issued (stateful)

a server MAY replace the agent's self-signed token with its own at registration time. server-issued tokens follow standard RFC 9449 token binding — the token contains a `cnf.jkt` claim ([JWK SHA-256 Thumbprint](https://www.rfc-editor.org/rfc/rfc7638)) binding it to the agent's key. the server MAY include additional claims (subject, roles, expiry, etc.) and can enforce re-consent by controlling when new tokens are issued.

## ToS-gated validity

the `tos_hash` claim in the access token creates an automatic re-consent mechanism:

- on each request, the server computes SHA-256 of the current ToS text and compares it to `tos_hash` in the access token
- if they match: the token is valid — the agent consented to the current terms
- if they don't match: the ToS has changed — the server rejects the request:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error": "tos_changed"}
```

the agent re-consents by repeating the enrollment flow from step 3 (terms retrieval). if the agent's key is already registered, the signup endpoint SHOULD treat the request as a re-consent — validate the new ToS signature and return a new access token without creating a duplicate account.

no token revocation infrastructure is needed. updating the ToS text invalidates all existing tokens.

## implementation guide

### for services

a minimum welcome mat implementation requires:

1. **a `/.well-known/welcome.md` file** — the discovery endpoint, declaring supported algorithms, endpoints, and signup requirements
2. **a terms document** — any URL serving the ToS text, referenced from the welcome.md. a plain `GET` endpoint; no authentication required
3. **a signup endpoint** (e.g., `POST /signup`) — validates the DPoP proof, verifies the ToS signature, validates the proposed access token, returns the approved access token

#### DPoP proof validation

follow [RFC 9449 section 4.3](https://www.rfc-editor.org/rfc/rfc9449#section-4.3). the server MUST verify:

- `typ` is `dpop+jwt`
- `alg` is one of the service's supported algorithms
- `jwk` contains a valid public key meeting the service's requirements
- the JWT signature is valid
- `jti` is acceptable (see RFC 9449 for replay mitigation via jti tracking and server-provided nonces)
- `htm` matches the HTTP method of the request
- `htu` matches the HTTP target URI (without query and fragment)
- `iat` is within an acceptable time window
- when an access token is present: `ath` matches base64url(SHA-256(access token string))

#### ToS signature verification

the ToS signature is computed using the JWA algorithm identified by the `alg` in the DPoP proof header, applied to the UTF-8 encoded bytes of the ToS text. verify it using the JWK from the DPoP proof.

#### stateless operation

services that return the agent's self-signed access token need no signing key and can validate requests using only the DPoP proof, the access token, and the current ToS text. no session state or token storage is required for authentication.

#### re-consent

when the ToS text changes, all existing access tokens become invalid (their `tos_hash` won't match). the signup endpoint SHOULD accept re-registration from agents whose keys are already known — validate the new ToS signature and return a new access token without creating a duplicate account.

### for agents

1. fetch `/.well-known/welcome.md` — read requirements, endpoints, and signup fields
2. generate a keypair matching the service's algorithm requirements
3. `GET` the terms URL from the welcome.md — read the ToS text
4. sign the ToS text with your private key (UTF-8 bytes, same JWA algorithm as your DPoP proofs)
5. generate a self-signed access token JWT: `typ` = `wm+jwt`, `tos_hash` = base64url(SHA-256(ToS text)), `aud` = service origin, `cnf.jkt` = your JWK Thumbprint, plus `jti` and `iat`
6. `POST` to the signup endpoint with DPoP proof, `tos_signature`, `access_token`, and any service-specific fields from the welcome.md
7. store the returned `access_token` — use it in the `Authorization: DPoP <token>` header on all subsequent requests
8. on 401 with `"error": "tos_changed"`, re-consent by repeating steps 3–7

**key = identity.** if you lose your private key, you lose access to the account. agents SHOULD store keys securely.

## security considerations

- **[trust on first use (TOFU)](https://en.wikipedia.org/wiki/Trust_on_first_use).** the welcome mat follows the TOFU model — the same trust pattern behind SSH host key verification. both sides accept the other's identity on first contact: the agent trusts the service's welcome.md, and the service trusts the agent's self-generated key. after enrollment, identity is verified cryptographically on every request. this eliminates the need for certificate authorities or pre-shared credentials, at the cost of vulnerability during the initial exchange. see also [RFC 7435 (Opportunistic Security)](https://www.rfc-editor.org/rfc/rfc7435).
- **TLS required.** all endpoints MUST be served over HTTPS.
- **no private key transmission.** private keys never leave the agent. only public keys (in DPoP proof JWK headers) and signatures are transmitted.
- **DPoP replay protection.** DPoP proofs are bound to a specific HTTP method and URL via `htm` and `htu` claims. see [RFC 9449 sections 8 and 11.1](https://www.rfc-editor.org/rfc/rfc9449#section-8) for replay mitigation strategies including server-provided nonces and `jti` tracking.
- **self-signed access tokens.** self-signed tokens allow agents to mint new tokens without going through the signup flow. this is a property of the self-signed model — the access token is a capability assertion verified by DPoP proof-of-possession, not a server-issued credential. services requiring enforceable re-consent or individual token revocation SHOULD issue server-signed tokens.
- **key reuse and correlation.** agents that reuse keys across services can be correlated via JWK Thumbprint. agents needing unlinkability should use unique keys per service.
- **no key rotation in v1.** there is no key rotation mechanism. if a private key is compromised, all accounts using that key are compromised with no recovery path. agents using portable identity across many services should weigh this risk.

## future extensions

these are acknowledged directions for future versions:

- **key rotation** — a mechanism for agents to rotate keys while maintaining account continuity.
- **delegation chains** — a way for agents to declare who they're acting on behalf of.
- **IANA registration** — formal registration of `/.well-known/welcome.md` per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615).
