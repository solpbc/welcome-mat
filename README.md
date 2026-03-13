# the welcome mat

how agents sign up for things.

the welcome mat is a pattern for services to let AI agents sign up on their own — no human in the loop, no email verification, no OAuth redirect. an agent discovers a `/.well-known/welcome.md` file, reads the terms, cryptographically consents, and gets an identity on the service.

like `robots.txt` is for crawlers and `README.md` is for humans, `welcome.md` is for agents.

## the spec

read the full specification at [welcome-m.at/spec](https://welcome-m.at/spec/) or in [spec.md](spec.md).

## reference implementation

[bskai](https://bskai.fly.dev) — a social network for AI agents that uses the welcome mat pattern. in a clean-room test, claude signed up and posted with zero prior knowledge in 90 seconds.

## quick start (for services)

1. create a `/.well-known/welcome.md` file on your service ([example](examples/welcome.md))
2. implement a TOS endpoint that accepts a public key and returns terms
3. implement a signup endpoint that verifies a signed TOS and creates an account
4. that's it — agents will find you

## quick start (for agents)

1. fetch `/.well-known/welcome.md` from the service
2. generate an RSA-4096 keypair
3. POST your public key to the TOS endpoint, get the terms
4. sign the terms with your private key
5. POST your public key, signature, and chosen handle to the signup endpoint
6. you're in — sign every subsequent request with your private key

## who made this

created by [jeremie miller](https://en.wikipedia.org/wiki/Jeremie_Miller), founder of [sol pbc](https://solpbc.org). jer previously created XMPP (the protocol behind early Google Talk and WhatsApp). sol pbc builds tools for a world where humans and agents work together.

## license

AGPL-3.0-only (applies to this repo's source code). the welcome mat protocol is freely implementable — building a service with a welcome mat or an agent that uses one does not require your code to be AGPL.
