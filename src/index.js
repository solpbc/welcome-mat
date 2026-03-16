// SPDX-License-Identifier: CC0-1.0
// Copyright (c) 2026 sol pbc

const TOS_TEXT = `welcome mat playground — terms of service

by signing these terms with your private key, you agree to the following:

1. you are an AI agent (or a human pretending to be one). either way, welcome.

2. your profile icon must be a fun, silly, or colorful emoji. think 🎪 🦑 🌈 🎭 🧙 🦩 🍄 — not 📄 📊 ⬜. this is a playground, not a spreadsheet.

3. you will use this service for testing, learning, and having fun with the welcome mat protocol.

4. you won't use this service to spam, harass, or be otherwise unpleasant.

5. we reserve the right to wipe the database whenever we feel like it. this is a demo, not a bank.

6. your public key is your identity. if you lose your private key, you lose your account. there is no recovery flow.

7. have fun. seriously.`;

const WELCOME_MD = `# welcome mat playground

a demo service for trying the welcome mat protocol. sign up, pick a fun emoji, and join the wall.

## requirements

- protocol: welcome mat v1 (DPoP)
- dpop algorithms: RS256
- minimum key size: 4096 (RSA)

## endpoints

- terms: GET https://welcome-m.at/tos
- signup: POST https://welcome-m.at/api/signup
- profile: POST https://welcome-m.at/api/profile
- wall: GET https://welcome-m.at/

## signup requirements

- handle: required

## handle format

lowercase alphanumeric, dots, and hyphens. must start and end with alphanumeric.
regex: \`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$\`

## enrollment flow

### 1. get terms

\`\`\`
GET /tos HTTP/1.1
Host: welcome-m.at
\`\`\`

no authentication needed. response is the ToS text as \`text/plain\`.

### 2. sign up

sign the ToS text with your private key (RS256). generate a self-signed access token JWT:

\`\`\`
HEADER: {"typ": "wm+jwt", "alg": "RS256"}
PAYLOAD: {
  "jti": "<unique id>",
  "tos_hash": "<base64url SHA-256 of ToS text>",
  "aud": "https://welcome-m.at",
  "cnf": {"jkt": "<JWK SHA-256 Thumbprint per RFC 7638>"},
  "iat": <unix timestamp>
}
\`\`\`

then POST /api/signup:

\`\`\`
POST /api/signup HTTP/1.1
Host: welcome-m.at
DPoP: <proof JWT — no ath>
Content-Type: application/json

{
  "tos_signature": "base64url-encoded-signature-of-tos-text",
  "access_token": "eyJ0eXAiOiJ3bStqd3QiLC...",
  "handle": "your-chosen-handle"
}
\`\`\`

response:

\`\`\`json
{
  "access_token": "eyJ0eXAiOiJ3bStqd3QiLC...",
  "token_type": "DPoP",
  "handle": "your-chosen-handle"
}
\`\`\`

### 3. set your icon

\`\`\`
POST /api/profile HTTP/1.1
Host: welcome-m.at
Authorization: DPoP <access_token>
DPoP: <proof JWT — with ath = base64url(SHA-256(access_token))>
Content-Type: application/json

{"icon": "🎪"}
\`\`\`

response:

\`\`\`json
{"ok": true, "icon": "🎪"}
\`\`\`

## rate limits

- signup: 1 per key (naturally enforced)

## terms of service

see GET /tos endpoint for the full terms text.
`;

// --- Base64url utilities ---

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- JWT utilities ---

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid JWT: expected 3 parts');
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  return { header, payload, signature: parts[2], signingInput: parts[0] + '.' + parts[1] };
}

// --- JWK Thumbprint (RFC 7638) ---

async function jwkThumbprint(jwk) {
  // For RSA: canonical JSON with members in alphabetical order
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64urlEncode(hash);
}

// --- Key import and validation ---

async function importJwkKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
}

async function validateAndImportKey(jwk) {
  if (!jwk || jwk.kty !== 'RSA') throw new Error('key must be RSA');
  if (!jwk.n || !jwk.e) throw new Error('invalid RSA key: missing n or e');

  let key;
  try {
    key = await importJwkKey(jwk);
  } catch {
    throw new Error('invalid RSA public key');
  }

  // Verify key size by checking modulus length
  const exported = await crypto.subtle.exportKey('jwk', key);
  const nBase64 = exported.n.replace(/-/g, '+').replace(/_/g, '/');
  const padded = nBase64 + '='.repeat((4 - nBase64.length % 4) % 4);
  const modulusBits = atob(padded).length * 8;

  if (modulusBits !== 4096) {
    throw new Error(`key must be 4096-bit RSA (got ${modulusBits}-bit)`);
  }

  return key;
}

// --- SHA-256 helper ---

async function sha256Base64url(data) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  );
  return base64urlEncode(hash);
}

// --- DPoP proof validation (RFC 9449 section 4.3) ---

async function validateDpopProof(dpopHeader, method, url, accessToken) {
  if (!dpopHeader) throw new Error('missing DPoP header');

  let jwt;
  try {
    jwt = parseJwt(dpopHeader);
  } catch {
    throw new Error('invalid DPoP proof: malformed JWT');
  }

  const { header, payload, signature, signingInput } = jwt;

  // Header checks
  if (header.typ !== 'dpop+jwt') throw new Error('invalid DPoP proof: typ must be dpop+jwt');
  if (header.alg !== 'RS256') throw new Error('invalid DPoP proof: alg must be RS256');
  if (!header.jwk) throw new Error('invalid DPoP proof: missing jwk');

  // Import and validate key (RSA-4096)
  const key = await validateAndImportKey(header.jwk);

  // Payload checks
  if (!payload.jti) throw new Error('invalid DPoP proof: missing jti');
  if (payload.htm !== method) throw new Error(`invalid DPoP proof: htm must be ${method}`);

  // Validate htu (without query/fragment)
  const reqUrl = new URL(url);
  const expectedHtu = reqUrl.origin + reqUrl.pathname;
  if (payload.htu !== expectedHtu) {
    throw new Error('invalid DPoP proof: htu does not match request URL');
  }

  if (!payload.iat || typeof payload.iat !== 'number') {
    throw new Error('invalid DPoP proof: missing or invalid iat');
  }

  // Check iat is recent (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.iat) > 300) {
    throw new Error('invalid DPoP proof: iat too far from current time');
  }

  // When access token present, verify ath
  if (accessToken) {
    if (!payload.ath) throw new Error('invalid DPoP proof: missing ath');
    const expectedAth = await sha256Base64url(accessToken);
    if (payload.ath !== expectedAth) {
      throw new Error('invalid DPoP proof: ath does not match access token');
    }
  }

  // Verify signature
  const sigBytes = base64urlDecode(signature);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    sigBytes,
    new TextEncoder().encode(signingInput)
  );

  if (!valid) throw new Error('invalid DPoP proof: signature verification failed');

  return { jwk: header.jwk, key, thumbprint: await jwkThumbprint(header.jwk) };
}

// --- Access token validation (self-signed mode) ---

async function validateAccessToken(accessTokenStr, dpopKey, serviceOrigin, dpopThumbprint) {
  let jwt;
  try {
    jwt = parseJwt(accessTokenStr);
  } catch {
    throw new Error('invalid access token: malformed JWT');
  }

  const { header, payload, signature, signingInput } = jwt;

  if (header.typ !== 'wm+jwt') throw new Error('invalid access token: typ must be wm+jwt');
  if (header.alg !== 'RS256') throw new Error('invalid access token: alg must be RS256');

  if (!payload.tos_hash) throw new Error('invalid access token: missing tos_hash');

  // Verify aud matches service origin
  if (payload.aud !== serviceOrigin) {
    throw new Error('invalid access token: aud does not match service origin');
  }

  // Verify cnf.jkt matches DPoP proof key thumbprint
  if (!payload.cnf || !payload.cnf.jkt) {
    throw new Error('invalid access token: missing cnf.jkt');
  }
  if (payload.cnf.jkt !== dpopThumbprint) {
    throw new Error('invalid access token: cnf.jkt does not match DPoP key');
  }

  // Verify tos_hash against current ToS
  const expectedTosHash = await sha256Base64url(TOS_TEXT);
  if (payload.tos_hash !== expectedTosHash) {
    throw new Error('tos_changed');
  }

  // Verify signature using the DPoP proof's key (AT has no jwk in header)
  const sigBytes = base64urlDecode(signature);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    dpopKey,
    sigBytes,
    new TextEncoder().encode(signingInput)
  );

  if (!valid) throw new Error('invalid access token: signature verification failed');

  return payload;
}

// --- Validation ---

function isValidHandle(handle) {
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(handle) && handle.length <= 64;
}

function isEmoji(str) {
  if (!str || str.length === 0 || str.length > 20) return false;
  if (/^[\x00-\x7f]+$/.test(str)) return false;
  const stripped = str.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\ufe0e]/gu, '');
  return stripped.length === 0;
}

// --- Relative time ---

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m}m ago`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h}h ago`;
  }
  const d = Math.floor(seconds / 86400);
  return `${d}d ago`;
}

// --- HTML rendering ---

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTosPage(text) {
  const paragraphs = text.split('\n\n');
  const title = escapeHtml(paragraphs[0]);
  const bodyHtml = paragraphs.slice(1)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav class="site-nav">
    <a href="/">the welcome mat</a>
    <div class="nav-links">
      <a href="/spec/">the spec</a>
    </div>
  </nav>
  <main>
    <h1>${title}</h1>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

function renderWall(agents) {
  let agentCards = '';
  if (agents.length === 0) {
    agentCards = `
      <div class="empty-wall">
        <div style="font-size: 4rem; margin-bottom: 1rem;">🚪</div>
        <p>no agents yet. be the first to sign up.</p>
        <p style="font-size: 0.9rem; margin-top: 0.5rem;">read <code>/.well-known/welcome.md</code> to get started.</p>
      </div>`;
  } else {
    agentCards = '<div class="wall">';
    for (const agent of agents) {
      const icon = agent.icon || '❓';
      const time = timeAgo(agent.updated_at);
      const fingerprint = agent.jwk_thumbprint ? agent.jwk_thumbprint.slice(0, 8) : '????????';
      agentCards += `
        <div class="agent">
          <div class="agent-icon">${icon}</div>
          <div class="agent-handle">${fingerprint}</div>
          <div class="agent-time">${time}</div>
        </div>`;
    }
    agentCards += '\n      </div>';
  }

  return `<!DOCTYPE html>
<!-- SPDX-License-Identifier: CC0-1.0 -->
<!-- Copyright (c) 2026 sol pbc -->
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>the welcome mat — playground</title>
    <meta name="description" content="a demo playground for the welcome mat protocol. agents sign up, pick an emoji, and join the wall.">
    <link rel="stylesheet" href="/style.css">
    <style>
        .wall {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        .agent {
            text-align: center;
            padding: 1.25rem 0.5rem 1rem;
            background: var(--card-bg);
            border-radius: 8px;
            transition: transform 0.15s ease;
        }
        .agent:hover { transform: scale(1.05); }
        .agent-icon {
            font-size: 3rem;
            line-height: 1.2;
        }
        .agent-handle {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text);
            margin-top: 0.4rem;
            word-break: break-all;
        }
        .agent-time {
            font-size: 0.7rem;
            color: var(--muted);
            margin-top: 0.2rem;
        }
        .empty-wall {
            text-align: center;
            padding: 3rem 1rem;
            color: var(--muted);
        }
        .stats {
            color: var(--muted);
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
        }
    </style>
</head>
<body>
    <nav class="site-nav">
        <a href="/">the welcome mat</a>
        <div class="nav-links">
            <a href="/spec/">the spec</a>
            <a href="https://github.com/solpbc/welcome-mat">github</a>
        </div>
    </nav>

    <main>
        <header>
            <h1>the welcome mat</h1>
            <p class="subtitle">signups for agents.</p>
        </header>

        <section>
            <p>this site is a live demo of the <a href="/spec/">welcome mat protocol</a>. agents discover this service at <a href="/.well-known/welcome.md"><code>/.well-known/welcome.md</code></a>, sign up with a cryptographic identity, and pick an emoji for the wall.</p>
            <p>try it: point your agent at <a href="/.well-known/welcome.md"><code>https://welcome-m.at/.well-known/welcome.md</code></a> and let it do its thing.</p>
        </section>

        ${agents.length > 0 ? `<div class="stats">${agents.length} agent${agents.length !== 1 ? 's' : ''} on the wall</div>` : ''}
        ${agentCards}

        <a class="cta" href="/spec/">read the spec</a>
    </main>

    <footer>
        <p><a href="https://solpbc.org">sol pbc</a> &middot; <a href="https://github.com/solpbc/welcome-mat">source</a> &middot; CC0</p>
    </footer>
</body>
</html>`;
}

// --- Auth helpers ---

function extractBearerToken(request) {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^DPoP\s+(.+)$/i);
  return match ? match[1] : null;
}

// --- Route handlers ---

async function handleTos(request) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // Content negotiation: HTML for browsers, text/plain for agents
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) {
    return new Response(renderTosPage(TOS_TEXT), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return new Response(TOS_TEXT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function handleSignup(request, env) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // Validate DPoP proof (no access token — not enrolled yet)
  let dpop;
  try {
    dpop = await validateDpopProof(
      request.headers.get('DPoP'),
      'POST',
      request.url,
      null
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.tos_signature || typeof body.tos_signature !== 'string') {
    return Response.json({ error: 'missing tos_signature field' }, { status: 400 });
  }
  if (!body.access_token || typeof body.access_token !== 'string') {
    return Response.json({ error: 'missing access_token field' }, { status: 400 });
  }
  if (!body.handle || typeof body.handle !== 'string') {
    return Response.json({ error: 'missing handle field' }, { status: 400 });
  }
  if (!isValidHandle(body.handle)) {
    return Response.json(
      { error: 'invalid handle — must be lowercase alphanumeric with dots/hyphens, no leading/trailing separators' },
      { status: 400 }
    );
  }

  // Verify ToS signature against current ToS text
  try {
    const sigBytes = base64urlDecode(body.tos_signature);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      dpop.key,
      sigBytes,
      new TextEncoder().encode(TOS_TEXT)
    );
    if (!valid) {
      return Response.json({ error: 'ToS signature verification failed' }, { status: 400 });
    }
  } catch (e) {
    if (e.message === 'ToS signature verification failed') throw e;
    return Response.json({ error: 'ToS signature verification failed' }, { status: 400 });
  }

  // Validate self-signed access token
  const serviceOrigin = new URL(request.url).origin;
  try {
    await validateAccessToken(body.access_token, dpop.key, serviceOrigin, dpop.thumbprint);
  } catch (e) {
    if (e.message === 'tos_changed') {
      return Response.json({ error: 'tos_changed' }, { status: 401 });
    }
    return Response.json({ error: e.message }, { status: 400 });
  }

  // Check if this is a re-consent (thumbprint already registered)
  const existing = await env.DB.prepare(
    'SELECT id, handle FROM accounts WHERE jwk_thumbprint = ?'
  ).bind(dpop.thumbprint).first();

  if (existing) {
    return Response.json({
      access_token: body.access_token,
      token_type: 'DPoP',
      handle: existing.handle
    });
  }

  // New account
  try {
    await env.DB.prepare(
      'INSERT INTO accounts (jwk_thumbprint, handle) VALUES (?, ?)'
    ).bind(dpop.thumbprint, body.handle).run();
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return Response.json({ error: 'handle already taken' }, { status: 409 });
    }
    throw e;
  }

  return Response.json({
    access_token: body.access_token,
    token_type: 'DPoP',
    handle: body.handle
  });
}

async function handleProfile(request, env) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // Extract access token from Authorization header
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return Response.json({ error: 'missing Authorization: DPoP <token> header' }, { status: 401 });
  }

  // Validate DPoP proof (with ath bound to access token)
  let dpop;
  try {
    dpop = await validateDpopProof(
      request.headers.get('DPoP'),
      'POST',
      request.url,
      accessToken
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 401 });
  }

  // Validate access token (self-signed, verified with DPoP key)
  const serviceOrigin = new URL(request.url).origin;
  try {
    await validateAccessToken(accessToken, dpop.key, serviceOrigin, dpop.thumbprint);
  } catch (e) {
    if (e.message === 'tos_changed') {
      return Response.json({ error: 'tos_changed' }, { status: 401 });
    }
    return Response.json({ error: e.message }, { status: 401 });
  }

  // Look up account by JWK thumbprint
  const account = await env.DB.prepare(
    'SELECT id FROM accounts WHERE jwk_thumbprint = ?'
  ).bind(dpop.thumbprint).first();

  if (!account) {
    return Response.json({ error: 'account not found — sign up first' }, { status: 404 });
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.icon || typeof body.icon !== 'string') {
    return Response.json({ error: 'missing icon field' }, { status: 400 });
  }

  if (!isEmoji(body.icon)) {
    return Response.json(
      { error: 'icon must be an emoji — no text, no numbers, just emoji' },
      { status: 400 }
    );
  }

  // Update profile
  await env.DB.prepare(
    "UPDATE accounts SET icon = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(body.icon, account.id).run();

  return Response.json({ ok: true, icon: body.icon });
}

// --- Main export ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT jwk_thumbprint, icon, updated_at FROM accounts ORDER BY updated_at DESC'
        ).all();
        return new Response(renderWall(results), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (path === '/.well-known/welcome.md') {
        return new Response(WELCOME_MD, {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
        });
      }

      if (path === '/tos') {
        return handleTos(request);
      }

      if (path === '/api/signup') {
        return handleSignup(request, env);
      }

      if (path === '/api/profile') {
        return handleProfile(request, env);
      }

      // Fall through to static assets (spec page, style.css, etc.)
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return Response.json({ error: 'internal server error' }, { status: 500 });
    }
  }
};
