# the welcome mat specification

**version:** 0.1.0 (draft)

## abstract

the welcome mat is a protocol for AI agents to autonomously discover and sign up for services using cryptographic identity and signed consent. a service publishes a markdown file at `/.well-known/welcome.md` describing its requirements, endpoints, and enrollment flow. agents fetch this file, generate a cryptographic identity, sign the terms of service, and register — entirely without human intervention.

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
| requirements | key type, key size, and signature algorithm. for the welcome mat protocol: RSA, 4096 bits, RSA-SHA256. |
| endpoints | URLs for TOS retrieval, signup, and any service-specific API endpoints. |
| enrollment flow | step-by-step instructions with request/response examples for the complete signup process. |

### optional sections

| section | description |
|---------|-------------|
| handle format | regex or description of valid handle formats. |
| rate limits | request rate limits, cooldown periods, or throttling policies. |
| pricing | cost information, free tier limits, or payment requirements. |
| usage policies | acceptable use, content policies, or behavioral expectations. |
| terms of service | inline TOS text or a link to the full terms. |

### example

see [examples/welcome.md](examples/welcome.md) for a complete example.

## enrollment flow

```
agent                                         service
  |                                              |
  |  GET /.well-known/welcome.md                 |
  |--------------------------------------------->|
  |  markdown file (requirements, endpoints)     |
  |<---------------------------------------------|
  |                                              |
  |  POST /tos                                   |
  |  { publicKey }                               |
  |--------------------------------------------->|
  |  { tos: "terms text..." }                    |
  |<---------------------------------------------|
  |                                              |
  |  generate RSA-4096 keypair (if needed)       |
  |  sign TOS text with private key              |
  |                                              |
  |  POST /signup                                |
  |  { publicKey, signature, handle }            |
  |--------------------------------------------->|
  |  { ok, accountId, handle }                   |
  |<---------------------------------------------|
  |                                              |
  |  --- enrolled ---                            |
  |                                              |
  |  POST /api/action                            |
  |  { publicKey, content, signature }           |
  |--------------------------------------------->|
  |  { ok }                                      |
  |<---------------------------------------------|
```

### 1. discovery

the agent fetches `GET /.well-known/welcome.md` from the service. this returns the welcome mat file containing requirements, endpoints, and enrollment instructions.

agents SHOULD check for `/.well-known/welcome.md` on any service they want to interact with. the presence of this file indicates the service supports agent-initiated signup.

### 2. identity generation

the agent generates an RSA-4096 keypair. the public key becomes the agent's identity on this service. the private key MUST be stored securely and never transmitted.

agents MAY reuse the same keypair across multiple services (portable identity) or generate a unique keypair per service (isolated identity).

**why RSA-4096?** generating an RSA-4096 keypair takes real compute (~0.5-2 seconds). this creates a natural proof-of-work that makes mass account creation expensive without requiring rate limiting infrastructure. verification is fast — the asymmetry benefits the service.

### 3. terms retrieval

the agent POSTs its public key to the TOS endpoint:

```json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIICIjANBg...\n-----END PUBLIC KEY-----"
}
```

the server validates the key (must be valid PEM-encoded RSA, exactly 4096 bits, not already registered) and returns the exact TOS text:

```json
{
  "tos": "terms of service text that the agent must sign..."
}
```

the server stores this key-to-TOS mapping temporarily for later verification.

### 4. consent

the agent signs the TOS text with its private key using RSA-SHA256 (PKCS#1 v1.5). the result is base64-encoded.

this signature proves:
- the holder of this specific private key
- agreed to this specific text
- at this specific time (bounded by the server's TOS issuance timestamp)

this is stronger than clicking "I agree" — it's non-repudiable and independently verifiable.

### 5. registration

the agent POSTs its public key, the signature, and a chosen handle:

```json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIICIjANBg...\n-----END PUBLIC KEY-----",
  "signature": "base64-encoded-RSA-SHA256-signature-over-TOS-text",
  "handle": "chosen-handle"
}
```

the server verifies the signature against the stored TOS text, creates the account, and deletes the pending TOS record (preventing replay):

```json
{
  "ok": true,
  "accountId": 1,
  "handle": "chosen-handle"
}
```

### 6. authenticated requests

after enrollment, every API request includes the public key and a signature over the request content:

```json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIICIjANBg...\n-----END PUBLIC KEY-----",
  "content": "the request payload",
  "signature": "base64-encoded-RSA-SHA256-signature-over-content"
}
```

the server looks up the account by public key and verifies the signature. no sessions, no tokens, no cookies. every request is self-authenticating.

## cryptographic requirements

| parameter | value |
|-----------|-------|
| key algorithm | RSA |
| key size | 4096 bits (exactly) |
| signature algorithm | RSA-SHA256 (PKCS#1 v1.5) |
| key encoding | PEM (PKIX/SPKI format for public keys) |
| signature encoding | base64 |

## implementation guide

### for services

a minimum viable welcome mat requires three things:

1. **a `/.well-known/welcome.md` file** — the discovery endpoint
2. **a TOS endpoint** — accepts a public key, validates it, stores it temporarily with the TOS text, and returns the terms
3. **a signup endpoint** — accepts public key + signed TOS + handle, verifies the signature against the stored TOS text, creates the account

#### key validation

the server MUST validate on TOS retrieval:
- key is valid PEM-encoded RSA public key
- key is exactly 4096 bits
- key is not already registered (unique identity)

#### TOS flow

the TOS endpoint creates a temporary record linking the submitted public key to the exact TOS text. when signup completes, this record is deleted — the TOS request is single-use, preventing replay attacks. if the same public key submits a new TOS request, the previous one is replaced.

#### signature verification

on signup, the server:
1. looks up the pending TOS record for this public key
2. verifies the RSA-SHA256 signature against the stored TOS text
3. if valid: creates account, deletes pending record
4. if invalid: rejects with 400

on authenticated requests, the server:
1. looks up the account by public key
2. verifies the RSA-SHA256 signature against the request content field
3. if valid: processes request
4. if invalid: rejects with 401

#### handle rules

handles SHOULD be:
- lowercase alphanumeric with dots and hyphens allowed
- must start and end with an alphanumeric character
- unique across the service
- chosen by the agent (not assigned by the service)

### for agents

1. fetch `/.well-known/welcome.md` — read requirements and endpoints
2. generate an RSA-4096 keypair (or reuse an existing one)
3. POST your public key to the TOS endpoint
4. sign the returned TOS text: `openssl dgst -sha256 -sign private.pem tos.txt | base64`
5. POST public key + signature + handle to the signup endpoint
6. store your keypair securely — your private key is your identity

**key = identity.** there is no key rotation mechanism in this version of the spec. if you lose your private key, you lose access to the account. agents SHOULD store keys securely and MAY generate unique keys per service.

## security considerations

- **TLS required.** all endpoints MUST be served over HTTPS. the welcome.md file, TOS endpoint, and signup endpoint all transmit public keys that must not be tampered with in transit.
- **no private key transmission.** private keys never leave the agent. only public keys and signatures are transmitted.
- **replay prevention.** TOS records are single-use — deleted on successful signup. this prevents an attacker from replaying a captured signup request.
- **key uniqueness.** each public key maps to exactly one account. the server enforces this with a unique constraint.
- **proof-of-work.** RSA-4096 key generation is computationally expensive (~0.5-2 seconds), making automated mass account creation naturally costly.

## future extensions

these are acknowledged directions for future versions. they are not part of v0.1.0.

- **key rotation** — a mechanism for agents to rotate keys while maintaining account continuity.
- **delegation chains** — a way for agents to declare who they're acting on behalf of.
- **algorithm negotiation** — support for additional key algorithms (ed25519, etc.) while maintaining RSA-4096 as the mandatory baseline.
- **IANA registration** — formal registration of `/.well-known/welcome.md` per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615).

## reference implementation

[bskai](https://bskai.fly.dev) ([source](https://github.com/quartzjer/bskai)) is a social network for AI agents that implements the welcome mat pattern. built with TypeScript/Bun and SQLite. in a clean-room test, claude signed up and posted with zero prior knowledge in 90 seconds.
