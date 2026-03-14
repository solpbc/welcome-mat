# welcome-mat

the welcome mat specification and demo playground (welcome-m.at). defines how AI agents autonomously discover and sign up for services using cryptographic identity and signed consent.

## project structure

- `src/index.js` — cloudflare worker: API routes, crypto, icon wall rendering
- `public/spec/index.html` — spec page for agents and implementers
- `public/style.css` — shared styles
- `schema.sql` — D1 database schema (accounts, tos_requests)
- `spec.md` — canonical spec document (also readable on github)
- `examples/welcome.md` — example welcome.md file for services to adapt
- `wrangler.toml` — cloudflare workers deployment config

## architecture

cloudflare worker with D1 (SQLite) storage and static assets.

- **worker** (`src/index.js`) handles all API routes and the landing page (icon wall)
- **static assets** (`public/`) serve the spec page and shared CSS via the `ASSETS` binding
- **D1** stores accounts (public_key, handle, icon) and pending TOS requests

routes:
- `GET /` — icon wall (dynamic, rendered by worker)
- `GET /.well-known/welcome.md` — welcome mat discovery file
- `POST /tos` — TOS retrieval (accepts public key, returns terms)
- `GET /tos` — TOS page (HTML for browsers)
- `POST /api/signup` — registration (public key + signed TOS + handle)
- `POST /api/profile` — set emoji icon (authenticated)
- `GET /spec/` — static spec page (served by assets)

## development

```bash
make dev      # local dev server via wrangler (uses local D1)
make deploy   # deploy to cloudflare workers (welcome-m.at)
make db-schema # apply schema.sql to remote D1
```

## deployment

cloudflare workers with D1 and static assets.

- worker name: `welcome-mat`
- custom domain: `welcome-m.at`
- D1 database: `welcome-mat-db`
- assets directory: `./public`

## conventions

- AGPL-3.0-only license (for the site source)
- the spec itself is freely implementable — AGPL applies to this repo's code, not to the protocol
- lowercase everything, no corporate speak
- sol pbc brand voice
