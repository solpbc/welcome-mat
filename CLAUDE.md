# welcome-mat

the welcome mat specification and website (welcome-m.at). defines how AI agents autonomously discover and sign up for services using cryptographic identity and signed consent.

## project structure

- `index.html` — landing page for humans (what this is, why it matters)
- `spec/index.html` — spec page for agents and implementers
- `style.css` — shared styles
- `spec.md` — canonical spec document (also readable on github)
- `examples/welcome.md` — example welcome.md file for services to adapt

## development

static site — no build step. open `index.html` in a browser or serve with any static server.

```bash
make dev    # serve locally on port 8080
make ci     # validate HTML (if tidy is installed)
```

## deployment

cloudflare pages, connected to this repo. pushes to `main` auto-deploy.

- build command: (none)
- build output directory: `.`
- custom domain: welcome-m.at

## conventions

- AGPL-3.0-only license (for the site source)
- the spec itself is freely implementable — AGPL applies to this repo's code, not to the protocol
- lowercase everything, no corporate speak
- sol pbc brand voice
