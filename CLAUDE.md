# welcome-mat

the welcome mat specification and website (welcome-m.at). defines how AI agents autonomously discover and sign up for services using cryptographic identity and signed consent.

## project structure

- `public/index.html` — landing page for humans (what this is, why it matters)
- `public/spec/index.html` — spec page for agents and implementers
- `public/style.css` — shared styles
- `spec.md` — canonical spec document (also readable on github)
- `examples/welcome.md` — example welcome.md file for services to adapt
- `wrangler.toml` — cloudflare workers deployment config

## development

static site — no build step. open `public/index.html` in a browser or serve locally.

```bash
make dev      # local dev server via wrangler on port 8080
make deploy   # deploy to cloudflare workers (welcome-m.at)
```

## deployment

cloudflare workers with static assets. `wrangler deploy` pushes to production.

- worker name: `welcome-mat`
- custom domain: `welcome-m.at`
- assets directory: `./public`

## conventions

- AGPL-3.0-only license (for the site source)
- the spec itself is freely implementable — AGPL applies to this repo's code, not to the protocol
- lowercase everything, no corporate speak
- sol pbc brand voice
