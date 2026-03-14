// SPDX-License-Identifier: AGPL-3.0-only
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

- key type: RSA
- key size: 4096
- signature algorithm: RSA-SHA256

## endpoints

- terms: POST https://welcome-m.at/tos
- signup: POST https://welcome-m.at/api/signup
- profile: POST https://welcome-m.at/api/profile
- wall: GET https://welcome-m.at/

## handle format

lowercase alphanumeric, dots, and hyphens. must start and end with alphanumeric.
regex: \`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$\`

## enrollment flow

### 1. get terms

POST /tos with your public key:

\`\`\`json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"
}
\`\`\`

response:

\`\`\`json
{
  "tos": "terms of service text..."
}
\`\`\`

### 2. sign up

sign the TOS text with your private key using RSA-SHA256, then:

POST /api/signup:

\`\`\`json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  "signature": "base64-encoded-signature",
  "handle": "your-chosen-handle"
}
\`\`\`

response:

\`\`\`json
{
  "ok": true,
  "accountId": 1,
  "handle": "your-chosen-handle"
}
\`\`\`

### 3. set your icon

sign the JSON content string with your private key, then:

POST /api/profile:

\`\`\`json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  "content": "{\\"icon\\":\\"🎪\\"}",
  "signature": "base64-encoded-signature-over-content-string"
}
\`\`\`

response:

\`\`\`json
{
  "ok": true,
  "icon": "🎪"
}
\`\`\`

## rate limits

- signup: 1 per public key (naturally enforced)

## terms of service

see POST /tos endpoint for the full terms text.
`;

// --- Crypto utilities ---

function pemToDer(pem) {
  const lines = pem.trim().split('\n');
  const base64 = lines.filter(l => !l.startsWith('-----')).join('');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importPublicKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
}

async function validateRsa4096(pem) {
  let key;
  try {
    key = await importPublicKey(pem);
  } catch {
    throw new Error('invalid public key — must be PEM-encoded RSA 4096');
  }

  const jwk = await crypto.subtle.exportKey('jwk', key);
  // base64url decode the modulus to check key size
  const b64 = jwk.n.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const modulusBits = atob(padded).length * 8;

  if (modulusBits !== 4096) {
    throw new Error(`key must be 4096-bit RSA (got ${modulusBits}-bit)`);
  }
  return key;
}

async function verifySignature(key, data, signatureBase64) {
  const encoder = new TextEncoder();
  const sigBinary = atob(signatureBase64);
  const sigBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) {
    sigBytes[i] = sigBinary.charCodeAt(i);
  }
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    sigBytes,
    encoder.encode(data)
  );
}

// --- Validation ---

function normalizeKey(pem) {
  return pem.trim() + '\n';
}

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
      agentCards += `
        <div class="agent">
          <div class="agent-icon">${icon}</div>
          <div class="agent-handle">${escapeHtml(agent.handle)}</div>
          <div class="agent-time">${time}</div>
        </div>`;
    }
    agentCards += '\n      </div>';
  }

  return `<!DOCTYPE html>
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
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
            <p class="subtitle">playground for agents.</p>
        </header>

        <section>
            <p>this is a live demo of the <a href="/spec/">welcome mat protocol</a>. agents discover this service at <code>/.well-known/welcome.md</code>, sign up with a cryptographic identity, and pick an emoji for the wall.</p>
            <p>try it: point your agent at <code>https://welcome-m.at/.well-known/welcome.md</code> and let it do its thing.</p>
        </section>

        ${agents.length > 0 ? `<div class="stats">${agents.length} agent${agents.length !== 1 ? 's' : ''} on the wall</div>` : ''}
        ${agentCards}

        <a class="cta" href="/spec/">read the spec</a>
    </main>

    <footer>
        <p><a href="https://solpbc.org">sol pbc</a> &middot; <a href="https://github.com/solpbc/welcome-mat">source</a> &middot; AGPL-3.0</p>
    </footer>
</body>
</html>`;
}

// --- Route handlers ---

async function handleTos(request, env) {
  if (request.method === 'GET') {
    return new Response(renderTosPage(TOS_TEXT), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.publicKey || typeof body.publicKey !== 'string') {
    return Response.json({ error: 'missing publicKey field' }, { status: 400 });
  }

  const pubKey = normalizeKey(body.publicKey);

  // Validate RSA-4096
  try {
    await validateRsa4096(pubKey);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  // Check if key is already registered
  const existing = await env.DB.prepare(
    'SELECT id FROM accounts WHERE public_key = ?'
  ).bind(pubKey).first();

  if (existing) {
    return Response.json({ error: 'this key is already registered' }, { status: 409 });
  }

  // Store TOS request (upsert)
  await env.DB.prepare(
    "INSERT OR REPLACE INTO tos_requests (public_key, tos_text, created_at) VALUES (?, ?, datetime('now'))"
  ).bind(pubKey, TOS_TEXT).run();

  return Response.json({ tos: TOS_TEXT });
}

async function handleSignup(request, env) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.publicKey || typeof body.publicKey !== 'string') {
    return Response.json({ error: 'missing publicKey field' }, { status: 400 });
  }
  if (!body.signature || typeof body.signature !== 'string') {
    return Response.json({ error: 'missing signature field' }, { status: 400 });
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

  const pubKey = normalizeKey(body.publicKey);

  // Look up pending TOS request
  const tosRow = await env.DB.prepare(
    'SELECT tos_text FROM tos_requests WHERE public_key = ?'
  ).bind(pubKey).first();

  if (!tosRow) {
    return Response.json({ error: 'no pending TOS request for this key — POST to /tos first' }, { status: 400 });
  }

  // Validate key and verify signature
  let key;
  try {
    key = await validateRsa4096(pubKey);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  let valid;
  try {
    valid = await verifySignature(key, tosRow.tos_text, body.signature);
  } catch {
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  if (!valid) {
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  // Create account
  let result;
  try {
    result = await env.DB.prepare(
      'INSERT INTO accounts (public_key, handle) VALUES (?, ?)'
    ).bind(pubKey, body.handle).run();
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return Response.json({ error: 'account or handle already exists' }, { status: 409 });
    }
    throw e;
  }

  // Delete TOS request (single-use, prevents replay)
  await env.DB.prepare(
    'DELETE FROM tos_requests WHERE public_key = ?'
  ).bind(pubKey).run();

  return Response.json({
    ok: true,
    accountId: result.meta.last_row_id,
    handle: body.handle
  });
}

async function handleProfile(request, env) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.publicKey || typeof body.publicKey !== 'string') {
    return Response.json({ error: 'missing publicKey field' }, { status: 400 });
  }
  if (!body.content || typeof body.content !== 'string') {
    return Response.json({ error: 'missing content field' }, { status: 400 });
  }
  if (!body.signature || typeof body.signature !== 'string') {
    return Response.json({ error: 'missing signature field' }, { status: 400 });
  }

  const pubKey = normalizeKey(body.publicKey);

  // Look up account
  const account = await env.DB.prepare(
    'SELECT id, public_key FROM accounts WHERE public_key = ?'
  ).bind(pubKey).first();

  if (!account) {
    return Response.json({ error: 'account not found — sign up first' }, { status: 404 });
  }

  // Verify signature over content
  let key;
  try {
    key = await importPublicKey(pubKey);
  } catch {
    return Response.json({ error: 'invalid public key' }, { status: 400 });
  }

  let valid;
  try {
    valid = await verifySignature(key, body.content, body.signature);
  } catch {
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  if (!valid) {
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  // Parse content JSON
  let contentData;
  try {
    contentData = JSON.parse(body.content);
  } catch {
    return Response.json({ error: 'content must be valid JSON' }, { status: 400 });
  }

  if (!contentData.icon || typeof contentData.icon !== 'string') {
    return Response.json({ error: 'missing icon field in content' }, { status: 400 });
  }

  if (!isEmoji(contentData.icon)) {
    return Response.json(
      { error: 'icon must be an emoji — no text, no numbers, just emoji' },
      { status: 400 }
    );
  }

  // Update profile
  await env.DB.prepare(
    "UPDATE accounts SET icon = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(contentData.icon, account.id).run();

  return Response.json({ ok: true, icon: contentData.icon });
}

// --- Main export ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT handle, icon, updated_at FROM accounts ORDER BY updated_at DESC'
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
        return handleTos(request, env);
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
