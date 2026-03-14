#!/usr/bin/env node
// SPDX-License-Identifier: CC0-1.0
// End-to-end test for welcome mat v1.0 (DPoP-native)
// Usage: node test/e2e.mjs [base-url]
// Default base URL: http://localhost:8787

import crypto from 'node:crypto';

const BASE_URL = process.argv[2] || 'http://localhost:8787';

// --- Base64url utilities ---

function base64urlEncode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// --- Key generation ---

function generateRsa4096() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function pemToJwk(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const jwk = key.export({ format: 'jwk' });
  return { kty: jwk.kty, n: jwk.n, e: jwk.e };
}

// --- JWT creation ---

function createJwt(header, payload, privateKeyPem) {
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem);

  return `${signingInput}.${base64urlEncode(signature)}`;
}

// --- DPoP proof creation ---

function createDpopProof(jwk, privateKeyPem, method, htu, accessToken) {
  const header = { typ: 'dpop+jwt', alg: 'RS256', jwk };
  const payload = {
    jti: crypto.randomUUID(),
    htm: method,
    htu,
    iat: Math.floor(Date.now() / 1000),
  };

  if (accessToken) {
    const atHash = crypto.createHash('sha256').update(accessToken).digest();
    payload.ath = base64urlEncode(atHash);
  }

  return createJwt(header, payload, privateKeyPem);
}

// --- ToS signature ---

function signTos(tosText, privateKeyPem) {
  const sign = crypto.createSign('SHA256');
  sign.update(tosText);
  const signature = sign.sign(privateKeyPem);
  return base64urlEncode(signature);
}

// --- JWK Thumbprint (RFC 7638) ---

function computeJwkThumbprint(jwk) {
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  const hash = crypto.createHash('sha256').update(canonical).digest();
  return base64urlEncode(hash);
}

// --- Self-signed access token ---

function createAccessToken(tosText, privateKeyPem, jwk, serviceOrigin) {
  const tosHash = crypto.createHash('sha256').update(tosText).digest();
  const jkt = computeJwkThumbprint(jwk);
  return createJwt(
    { typ: 'wm+jwt', alg: 'RS256' },
    {
      jti: crypto.randomUUID(),
      tos_hash: base64urlEncode(tosHash),
      aud: serviceOrigin,
      cnf: { jkt },
      iat: Math.floor(Date.now() / 1000),
    },
    privateKeyPem
  );
}

// --- Parse welcome.md to extract endpoint URLs ---
// A real agent would parse the markdown to discover the service's canonical URLs.
// For local dev: wrangler rewrites request.url to the custom domain but with http://,
// so we adjust the scheme to match what the worker actually sees.

function parseEndpoints(welcomeMd) {
  const endpoints = {};
  const useHttp = BASE_URL.startsWith('http://');
  for (const line of welcomeMd.split('\n')) {
    const match = line.match(/^-\s+(\w+):\s+(?:GET|POST|PUT|DELETE|PATCH)?\s*(https?:\/\/\S+)/i);
    if (match) {
      let url = match[2];
      if (useHttp) url = url.replace(/^https:\/\//, 'http://');
      endpoints[match[1]] = url;
    }
  }
  return endpoints;
}

// --- Test runner ---

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

// Convert a canonical endpoint URL to the actual fetch URL
// e.g., https://welcome-m.at/tos → http://localhost:8787/tos
function toFetchUrl(canonicalUrl) {
  const path = new URL(canonicalUrl).pathname;
  return `${BASE_URL}${path}`;
}

async function run() {
  console.log(`\nwelcome mat v1.0 e2e test`);
  console.log(`target: ${BASE_URL}\n`);

  // Step 0: Generate RSA-4096 keypair
  console.log('generating RSA-4096 keypair...');
  const { publicKey, privateKey } = generateRsa4096();
  const jwk = pemToJwk(publicKey);
  console.log('  done');

  // Step 1: Discover welcome.md
  console.log('\n--- step 1: discovery ---');
  const welcomeRes = await fetch(`${BASE_URL}/.well-known/welcome.md`);
  assert(welcomeRes.ok, `GET /.well-known/welcome.md → ${welcomeRes.status}`);
  const welcomeMd = await welcomeRes.text();
  assert(welcomeMd.includes('welcome mat v1 (DPoP)'), 'welcome.md mentions DPoP v1');
  assert(welcomeMd.includes('RS256'), 'welcome.md lists RS256 algorithm');

  // Parse canonical endpoint URLs from welcome.md (like a real agent would)
  const endpoints = parseEndpoints(welcomeMd);
  console.log(`  endpoints: terms=${endpoints.terms}, signup=${endpoints.signup}, profile=${endpoints.profile}`);

  // Step 2: Get terms (GET /tos — no DPoP proof needed)
  console.log('\n--- step 2: terms retrieval ---');
  const tosRes = await fetch(toFetchUrl(endpoints.terms));
  assert(tosRes.ok, `GET /tos → ${tosRes.status}`);
  const tosText = await tosRes.text();
  assert(typeof tosText === 'string' && tosText.length > 0, 'received ToS text');

  // Derive service origin from the canonical terms URL for aud claim
  const serviceOrigin = new URL(endpoints.terms).origin;

  // Step 3: Sign ToS and create access token
  console.log('\n--- step 3: consent ---');
  const tosSig = signTos(tosText, privateKey);
  const accessToken = createAccessToken(tosText, privateKey, jwk, serviceOrigin);
  console.log(`  ToS signature: ${tosSig.substring(0, 20)}...`);
  console.log(`  access token: ${accessToken.substring(0, 30)}...`);

  // Step 4: Signup (POST /api/signup with DPoP + body)
  console.log('\n--- step 4: registration ---');
  const handle = `test-agent-${Date.now().toString(36)}`;
  const signupProof = createDpopProof(jwk, privateKey, 'POST', endpoints.signup, null);
  const signupRes = await fetch(toFetchUrl(endpoints.signup), {
    method: 'POST',
    headers: {
      'DPoP': signupProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tos_signature: tosSig,
      access_token: accessToken,
      handle,
    }),
  });
  assert(signupRes.ok, `POST /api/signup → ${signupRes.status}`);
  const signupData = await signupRes.json();
  assert(signupData.token_type === 'DPoP', 'token_type is DPoP');
  assert(typeof signupData.access_token === 'string', 'received access_token');
  assert(signupData.handle === handle, `handle matches: ${handle}`);

  // Use the server-returned access token for subsequent requests
  const serverAt = signupData.access_token;

  // Step 5: Set profile icon (POST /api/profile with Authorization + DPoP)
  console.log('\n--- step 5: set profile ---');
  const profileProof = createDpopProof(jwk, privateKey, 'POST', endpoints.profile, serverAt);
  const profileRes = await fetch(toFetchUrl(endpoints.profile), {
    method: 'POST',
    headers: {
      'Authorization': `DPoP ${serverAt}`,
      'DPoP': profileProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ icon: '🦑' }),
  });
  assert(profileRes.ok, `POST /api/profile → ${profileRes.status}`);
  const profileData = await profileRes.json();
  assert(profileData.ok === true, 'profile update succeeded');
  assert(profileData.icon === '🦑', 'icon is 🦑');

  // Step 6: Verify icon appears on wall
  console.log('\n--- step 6: verify wall ---');
  const wallRes = await fetch(`${BASE_URL}/`);
  assert(wallRes.ok, `GET / → ${wallRes.status}`);
  const wallHtml = await wallRes.text();
  assert(wallHtml.includes('🦑'), 'wall contains 🦑 icon');
  assert(wallHtml.includes(handle), `wall contains handle: ${handle}`);

  // Step 7: Test re-consent flow
  console.log('\n--- step 7: re-consent ---');
  const reconsentTosRes = await fetch(toFetchUrl(endpoints.terms));
  assert(reconsentTosRes.ok, 'GET /tos for re-consent succeeded');
  const reconsentTosText = await reconsentTosRes.text();

  const reconsentTosSig = signTos(reconsentTosText, privateKey);
  const reconsentAt = createAccessToken(reconsentTosText, privateKey, jwk, serviceOrigin);
  const reconsentSignupProof = createDpopProof(jwk, privateKey, 'POST', endpoints.signup, null);
  const reconsentSignupRes = await fetch(toFetchUrl(endpoints.signup), {
    method: 'POST',
    headers: {
      'DPoP': reconsentSignupProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tos_signature: reconsentTosSig,
      access_token: reconsentAt,
      handle: 'different-handle',
    }),
  });
  assert(reconsentSignupRes.ok, `re-consent POST /api/signup → ${reconsentSignupRes.status}`);
  const reconsentData = await reconsentSignupRes.json();
  assert(reconsentData.handle === handle, 're-consent preserves original handle');
  assert(reconsentData.token_type === 'DPoP', 're-consent returns DPoP token_type');

  // Verify the re-consent AT works for authenticated requests
  const reconsentServerAt = reconsentData.access_token;
  const reconsentProfileProof = createDpopProof(jwk, privateKey, 'POST', endpoints.profile, reconsentServerAt);
  const reconsentProfileRes = await fetch(toFetchUrl(endpoints.profile), {
    method: 'POST',
    headers: {
      'Authorization': `DPoP ${reconsentServerAt}`,
      'DPoP': reconsentProfileProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ icon: '🌈' }),
  });
  assert(reconsentProfileRes.ok, 're-consent AT works for authenticated request');

  // Step 8: Test error cases
  console.log('\n--- step 8: error cases ---');

  // POST to /tos should be rejected (GET only)
  const postTosRes = await fetch(toFetchUrl(endpoints.terms), { method: 'POST' });
  assert(postTosRes.status === 405, 'POST /tos → 405 method not allowed');

  // Invalid emoji
  const badEmojiProof = createDpopProof(jwk, privateKey, 'POST', endpoints.profile, serverAt);
  const badEmojiRes = await fetch(toFetchUrl(endpoints.profile), {
    method: 'POST',
    headers: {
      'Authorization': `DPoP ${serverAt}`,
      'DPoP': badEmojiProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ icon: 'not-an-emoji' }),
  });
  assert(badEmojiRes.status === 400, 'non-emoji icon → 400');

  // Missing Authorization header on profile
  const noAuthProof = createDpopProof(jwk, privateKey, 'POST', endpoints.profile, null);
  const noAuthRes = await fetch(toFetchUrl(endpoints.profile), {
    method: 'POST',
    headers: {
      'DPoP': noAuthProof,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ icon: '🎪' }),
  });
  assert(noAuthRes.status === 401, 'missing Authorization → 401');

  // Duplicate handle
  const { publicKey: pk2, privateKey: sk2 } = generateRsa4096();
  const jwk2 = pemToJwk(pk2);
  const tosSig2 = signTos(tosText, sk2);
  const at2 = createAccessToken(tosText, sk2, jwk2, serviceOrigin);
  const signupProof2 = createDpopProof(jwk2, sk2, 'POST', endpoints.signup, null);
  const dupHandleRes = await fetch(toFetchUrl(endpoints.signup), {
    method: 'POST',
    headers: { 'DPoP': signupProof2, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tos_signature: tosSig2, access_token: at2, handle }),
  });
  assert(dupHandleRes.status === 409, 'duplicate handle → 409');

  // Summary
  console.log(`\n--- results ---`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('test crashed:', err);
  process.exit(1);
});
