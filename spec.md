# the welcome mat specification

**version:** 1.0 (draft)

## abstract

the welcome mat is a protocol for AI agents to autonomously discover and register with services using cryptographic identity, signed consent, and proof-of-possession authentication.

a service publishes a markdown file at `/.well-known/welcome.md` describing its requirements and enrollment flow. agents discover this file, generate a cryptographic identity, sign the service's terms, and register — without human intervention.

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
| endpoints | URLs for terms retrieval, signup, and service-specific API endpoints. |
| enrollment flow | step-by-step instructions with request/response examples for the complete signup process. |

### optional sections

| section | description |
|---------|-------------|
| signup requirements | service-specific fields required during registration (handle, subject, etc.). |
| rate limits | request rate limits, cooldown periods, or throttling policies. |
| pricing | cost information, free tier limits, or payment requirements. |
| usage policies | acceptable use, content policies, or behavioral expectations. |
| terms of service | inline ToS text or a link to the full terms. |

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
  |  POST /tos                                   |
  |  DPoP: <proof, no ath>                       |
  |--------------------------------------------->|
  |  { tos: "terms text..." }                    |
  |<---------------------------------------------|
  |                                              |
  |  sign ToS text with private key              |
  |  generate self-signed access token JWT       |
  |   { tos_hash, iat, jti }                     |
  |                                              |
  |  POST /signup                                |
  |  DPoP: <proof, no ath>                       |
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

agents MAY reuse the same keypair across multiple services (portable identity) or generate a unique keypair per service (isolated identity).

### 3. terms retrieval

the agent sends `POST /tos` with a DPoP proof in the `DPoP` HTTP header. the DPoP proof contains the agent's public key as a JWK in its header, per [RFC 9449 section 4](https://www.rfc-editor.org/rfc/rfc9449#section-4).

the server validates the key (correct algorithm, sufficient key size) and returns the terms of service text:

```json
{
  "tos": "terms of service text that the agent must sign..."
}
```

the DPoP proof on this request has no `ath` claim (there is no access token yet).

### 4. consent and access token generation

the agent performs two operations locally:

**sign the ToS text** — a direct signature over the ToS text bytes using the agent's private key and the same algorithm as the DPoP proof. the signature is base64url-encoded.

**generate a self-signed access token** — a JWT signed with the agent's private key:

```
HEADER: {"typ": "at+jwt", "alg": "<algorithm>"}
PAYLOAD: {
  "jti": "<unique identifier>",
  "tos_hash": "<base64url-encoded SHA-256 of the ToS text>",
  "iat": <unix timestamp>
}
```

the `tos_hash` binds the access token to the specific terms the agent consented to.

### 5. registration

the agent sends `POST /signup` with:

- a DPoP proof in the `DPoP` HTTP header (no `ath` — no approved access token yet)
- a JSON body containing:
  - `tos_signature`: the base64url-encoded signature of the ToS text
  - `access_token`: the self-signed access token JWT
  - any service-specific fields declared in the welcome.md signup requirements

```json
{
  "tos_signature": "base64url-encoded-signature-of-tos-text",
  "access_token": "eyJ0eXAiOiJhdCtqd3QiLC..."
}
```

the server:

1. validates the DPoP proof per [RFC 9449 section 4.3](https://www.rfc-editor.org/rfc/rfc9449#section-4.3)
2. verifies `tos_signature` against the current ToS text using the JWK from the DPoP proof
3. validates the access token JWT — signature matches the same key, `tos_hash` matches SHA-256 of current ToS text
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
3. checks `tos_hash` in the access token matches SHA-256 of the server's current ToS text
4. checks `ath` in the DPoP proof matches SHA-256 of the access token string
5. processes the request

the server validates the agent's self-signed token using the key presented in the DPoP proof. no stored state is required beyond the current ToS text. services MAY store additional account data (profiles, service-specific state) while still using stateless authentication.

### server-issued (stateful)

a server MAY replace the agent's self-signed token with its own at registration time. server-issued tokens follow standard RFC 9449 token binding — the token contains a `cnf.jkt` claim ([JWK SHA-256 Thumbprint](https://www.rfc-editor.org/rfc/rfc7638)) binding it to the agent's key. the server MAY include additional claims (subject, roles, expiry, etc.).

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

for self-signed access tokens, this relies on the agent including the correct `tos_hash`. services requiring stronger re-consent guarantees SHOULD issue server-signed access tokens with the `tos_hash` embedded by the server.

## implementation guide

### for services

a minimum welcome mat implementation requires:

1. **a `/.well-known/welcome.md` file** — the discovery endpoint, declaring supported algorithms, endpoints, and signup requirements
2. **a terms endpoint** (e.g., `POST /tos`) — validates the DPoP proof, returns the ToS text
3. **a signup endpoint** (e.g., `POST /signup`) — validates the DPoP proof, verifies the ToS signature, validates the proposed access token, returns the approved access token

#### DPoP proof validation

follow [RFC 9449 section 4.3](https://www.rfc-editor.org/rfc/rfc9449#section-4.3). the key in the DPoP proof's `jwk` header MUST meet the service's algorithm and key size requirements as declared in its welcome.md.

#### ToS signature verification

the ToS signature is a direct signature over the ToS text bytes using the same algorithm and key as the DPoP proof. verify it using the JWK from the DPoP proof.

#### stateless operation

services that return the agent's self-signed access token need no signing key and can validate requests using only the DPoP proof, the access token, and the current ToS text. no session state or token storage is required for authentication.

#### re-consent

when the ToS text changes, all existing access tokens become invalid (their `tos_hash` won't match). the signup endpoint SHOULD accept re-registration from agents whose keys are already known — validate the new ToS signature and return a new access token without creating a duplicate account.

### for agents

1. fetch `/.well-known/welcome.md` — read requirements, endpoints, and signup fields
2. generate a keypair matching the service's algorithm requirements
3. create a DPoP proof and `POST` to the terms endpoint
4. sign the returned ToS text with your private key
5. generate a self-signed access token JWT: `tos_hash` = base64url(SHA-256(ToS text)), plus `jti` and `iat`
6. `POST` to the signup endpoint with DPoP proof, `tos_signature`, `access_token`, and any service-specific fields from the welcome.md
7. store the returned `access_token` — use it in the `Authorization: DPoP <token>` header on all subsequent requests
8. on 401 with `"error": "tos_changed"`, re-consent by repeating steps 3–7

**key = identity.** if you lose your private key, you lose access to the account. agents SHOULD store keys securely.

## security considerations

- **TLS required.** all endpoints MUST be served over HTTPS.
- **no private key transmission.** private keys never leave the agent. only public keys (in DPoP proof JWK headers) and signatures are transmitted.
- **DPoP replay protection.** DPoP proofs are bound to a specific HTTP method and URL. see [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) for replay mitigation strategies including `jti` tracking and server-provided nonces.
- **self-signed AT limitations.** self-signed access tokens allow agents to update their `tos_hash` without actually re-reading the ToS. services requiring strict re-consent enforcement should issue server-signed tokens.
- **ToS signature replay.** the ToS signature is over the ToS text only. services SHOULD validate that the key is not already registered to prevent replay of captured signup requests, or handle re-registration explicitly.

## future extensions

these are acknowledged directions for future versions:

- **key rotation** — a mechanism for agents to rotate keys while maintaining account continuity.
- **delegation chains** — a way for agents to declare who they're acting on behalf of.
- **IANA registration** — formal registration of `/.well-known/welcome.md` per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615).
