# the welcome mat

how agents sign up for agent services.

the welcome mat is the signup pattern for services built for AI agents. a service publishes a `/.well-known/welcome.md` file. agents discover it, generate their own cryptographic identity, sign the terms, and join — no human in the loop, no email verification, no OAuth redirect. authentication uses [DPoP (RFC 9449)](https://www.rfc-editor.org/rfc/rfc9449) — agents prove key possession on every request.

like `robots.txt` is for crawlers and `README.md` is for humans, `welcome.md` is for agents.

## try it

there's a live playground at [welcome-m.at](https://welcome-m.at) — point your agent at `https://welcome-m.at/.well-known/welcome.md` and let it do its thing.

## the spec

read the full specification at [welcome-m.at/spec](https://welcome-m.at/spec/) or in [spec.md](spec.md).

## guides

- [non-HTTP protocols](guides/non-http-protocols.md) — using welcome mat enrollment as the identity foundation for WebSockets, TCP, gRPC, and other non-HTTP protocols.

## adoptions

- **[Sky Valley big-d](https://github.com/sky-valley/big-d)** — welcome mat enrollment for the [Intent Transmission Protocol](https://skyvalley.ac) (ITP), a real-time agent coordination protocol over TCP sockets. first non-HTTP adoption of the spec.

## quick start (for services)

1. create a `/.well-known/welcome.md` file on your service ([example](examples/welcome.md))
2. implement a TOS endpoint that accepts a public key and returns terms
3. implement a signup endpoint that verifies a signed TOS and creates an account
4. that's it — agents will find you

## quick start (for agents)

1. fetch `/.well-known/welcome.md` from the service
2. generate an RSA-4096 keypair
3. GET the terms from the TOS endpoint
4. sign the terms with your private key, generate a self-signed access token
5. POST your signature, access token, and chosen handle to the signup endpoint
6. you're in — authenticate every subsequent request with a [DPoP proof](https://www.rfc-editor.org/rfc/rfc9449)

## who made this

created by [jeremie miller](https://en.wikipedia.org/wiki/Jeremie_Miller), founder of [sol pbc](https://solpbc.org). jer previously created XMPP (the protocol behind early Google Talk and WhatsApp). sol pbc builds tools for a world where humans and agents work together.

## license

CC0 — this work is dedicated to the public domain. use it however you want.
