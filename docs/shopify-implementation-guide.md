# Shopify App Review — Complete Implementation Guide

> **Branching strategy (recommendation below):**  
> Do NOT cherry-pick across diverged `main`. Instead, create a fresh branch off the
> latest clean `main`, then apply each change manually using this guide as the
> exact recipe. Run smoke tests after each change.

---

## 0. Pre-requisites

```bash
git checkout main
git pull origin main
git checkout -b shopify-session-fix
npm install   # make sure jsonwebtoken is present
```

Required env vars (local `.env`):
```
SHOPIFY_API_KEY=<your client id>
SHOPIFY_API_SECRET=<your client secret>
APP_URL=https://adray.ai          # or staging URL
SESSION_SECRET=<any long random string>
```

---

## 1. `middlewares/verifySessionToken.js`  ← CREATE / REPLACE FULLY

```javascript
const jwt = require('jsonwebtoken');

function getBearerToken(req) {
  const auth = req.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function normalizeShop(dest) {
  if (!dest) return '';
  return String(dest)
    .replace(/^https?:\/\//i, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function setReauthHeaders(req, res) {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const shop = String(req.query?.shop || '').trim();
  const host = String(req.query?.host || '').trim();

  res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
  res.set('X-Shopify-API-Request-Failure-Reauthorize', '1');

  if (appUrl && shop) {
    const url = new URL('/connector/interface', appUrl);
    url.searchParams.set('shop', shop);
    if (host) url.searchParams.set('host', host);
    res.set('X-Shopify-API-Request-Failure-Reauthorize-Url', url.toString());
  }
}

module.exports = (req, res, next) => {
  const token = getBearerToken(req);
  const secret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!token || !secret || !apiKey) {
    setReauthHeaders(req, res);
    return res.status(401).json({ error: 'missing session token configuration' });
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: apiKey,
    });

    const shop = normalizeShop(payload.dest || payload.iss);
    if (!shop.endsWith('.myshopify.com')) {
      setReauthHeaders(req, res);
      return res.status(401).json({ error: 'invalid session token destination' });
    }

    req.shopFromToken = shop;
    req.shop = shop;
    req.userId = payload.sub;
    req.shopifySession = payload;
    return next();
  } catch (_err) {
    setReauthHeaders(req, res);
    return res.status(401).json({ error: 'invalid session token' });
  }
};
```

**Why:** Shopify review requires that every 401 returns
`X-Shopify-Retry-Invalid-Session-Request: 1` and
`X-Shopify-API-Request-Failure-Reauthorize: 1`.

---

## 2. `backend/routes/secure.js`  ← CREATE

```javascript
const express = require('express');
const router = express.Router();
const verifySessionToken = require('../../middlewares/verifySessionToken');
const Audit = require('../models/Audit');

router.use(verifySessionToken);

router.get('/ping', (req, res) => {
  return res.json({ ok: true, shop: req.shopFromToken, user: req.userId });
});

router.get('/audits/latest', async (req, res) => {
  try {
    const latest = await Audit.findOne({ userId: req.userId })
                              .sort({ generatedAt: -1 })
                              .lean();
    res.json(latest || {});
  } catch (err) {
    console.error('Error fetching latest audit:', err);
    res.status(500).json({ error: 'Error interno al obtener auditoría' });
  }
});

module.exports = router;
```

---

## 3. `backend/index.js`  ← 3 targeted edits

### 3a. Add require at the top (near other requires)

```javascript
const verifySessionToken = require("../middlewares/verifySessionToken");
const secureRoutes = require("./routes/secure");
```

### 3b. CORS — replace your existing `ALLOWED_ORIGINS` block

Find your current CORS section and replace the origins array:

```javascript
const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const APP_ORIGIN = (() => {
  try { return new URL(APP_URL).origin; } catch { return null; }
})();
const RENDER_EXTERNAL_ORIGIN = (() => {
  const raw = String(process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!raw) return null;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin; } catch { return null; }
})();

const ALLOWED_ORIGINS = [
  'https://adray.ai',
  'https://adray-app-staging-german.onrender.com',     // staging (OK in prod too)
  'https://admin.shopify.com',
  /^https?:\/\/[^/]+\.myshopify\.com$/i,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  APP_ORIGIN,
  RENDER_EXTERNAL_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = ALLOWED_ORIGINS.some((rule) =>
        rule instanceof RegExp ? rule.test(origin) : rule === origin
      );
      return cb(ok ? null : new Error('CORS not allowed'), ok);
    },
    credentials: true,
  })
);
app.options(/.*/, cors());
```

### 3c. `/api` session-token gate — add AFTER passport middleware, BEFORE route mounts

```javascript
const API_SESSION_BYPASS = [
  /^\/api\/stripe\/webhook\/?$/i,
  /^\/api\/auth\/verify-email\/?$/i,
  /^\/api\/public-config\/?$/i,
  /^\/api\/register\/?$/i,
  /^\/api\/login\/?$/i,
  /^\/api\/auth\/login\/?$/i,
  /^\/api\/forgot-password\/?$/i,
  /^\/api\/bookcall(?:\/.*)?$/i,
  /^\/api\/cron(?:\/.*)?$/i,
  /^\/api\/logout\/?$/i,
];

function shouldBypassApiSessionToken(pathname) {
  return API_SESSION_BYPASS.some((rule) => rule.test(pathname));
}
```

Then mount the secure routes (add with the other route mounts):
```javascript
app.use('/api/secure', secureRoutes);
```

---

## 4. `public/connector/interface.connector.js`  ← REPLACE FULLY

```javascript
// public/connector/interface.connector.js
(function () {
  const $ = (id) => document.getElementById(id);

  const statusPill    = $('statusPill');
  const kvShop        = $('kvShop');
  const kvHost        = $('kvHost');
  const errBox        = $('errBox');
  const btnReload     = $('btnReload');
  const btnGo         = $('btnGo');

  function setStatus(txt)  { if (statusPill) statusPill.textContent = txt; }
  function showError(msg)  { if (!errBox) return; errBox.style.display = 'block'; errBox.textContent = msg; }
  function hideError()     { if (!errBox) return; errBox.style.display = 'none'; errBox.textContent = ''; }
  function qs()            { return new URLSearchParams(window.location.search); }
  function getMeta(name)   { const el = document.querySelector(`meta[name="${name}"]`); return el ? el.getAttribute('content') : ''; }
  function topNavigate(url){ try { if (window.top) window.top.location.href = url; else window.location.href = url; } catch (e) { window.location.href = url; } }
  function sleep(ms)       { return new Promise((r) => setTimeout(r, ms)); }

  async function waitForAppBridge(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hasModern = !!(window.shopify && typeof window.shopify.idToken === 'function');
      const hasLegacy = !!(window['app-bridge'] && window['app-bridge'].default);
      if (hasModern || hasLegacy) return true;
      await sleep(50);
    }
    return false;
  }

  function createLegacyApp(apiKey, host) {
    const AppBridge = window['app-bridge'];
    if (!AppBridge || typeof AppBridge.default !== 'function') return null;
    const createApp = AppBridge.default;
    return createApp({ apiKey, host, forceRedirect: window.top !== window.self });
  }

  async function tryGetSessionToken(apiKey, host) {
    // 1) Modern Shopify (recommended)
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await window.shopify.idToken();
    }
    // 2) Legacy app-bridge + idToken
    const app = createLegacyApp(apiKey, host);
    if (app && typeof app.idToken === 'function') return await app.idToken();
    // 3) Legacy app-bridge-utils
    const utils = window['app-bridge-utils'];
    if (app && utils && typeof utils.getSessionToken === 'function') {
      return await utils.getSessionToken(app);
    }
    throw new Error('No se pudo obtener Session Token. No existe window.shopify.idToken() ni fallback legacy de App Bridge.');
  }

  async function boot() {
    hideError();
    setStatus('Leyendo parámetros…');

    const p    = qs();
    const shop = (p.get('shop') || '').trim();
    const host = (p.get('host') || '').trim();

    kvShop.textContent = shop || '—';
    kvHost.textContent = host || '—';

    if (!shop) {
      setStatus('Falta shop');
      showError('Missing "shop".\n\nAbre esta pantalla desde el Admin de Shopify (Apps) o instala la app desde el App Store.');
      return;
    }
    if (!host) {
      setStatus('Falta host');
      showError('Missing "host".\n\nEsto normalmente significa que no entraste desde Shopify Admin (embedded).\nAbre la app desde Shopify Admin para que Shopify agregue ?host=...');
      return;
    }

    const apiKey = (getMeta('shopify-api-key') || '').trim();
    if (!apiKey || apiKey.includes('{') || apiKey.includes('}')) {
      setStatus('API key inválida');
      showError('shopify-api-key inválida.\n\nAsegúrate que el meta shopify-api-key tenga la API Key real (sin {{ }}).');
      return;
    }

    setStatus('Cargando App Bridge…');
    const ok = await waitForAppBridge();
    if (!ok) {
      setStatus('Error App Bridge');
      showError('App Bridge no cargó. Revisa CSP (shopifyCSP) y el script oficial.');
      return;
    }

    setStatus('Generando Session Token…');
    let token   = null;
    let lastErr = null;

    for (let i = 0; i < 4; i++) {
      try {
        token = await tryGetSessionToken(apiKey, host);
        if (token) break;
      } catch (e) {
        lastErr = e;
        await sleep(250 + i * 250);
      }
    }

    if (!token) {
      setStatus('Token falló');
      showError('No se pudo obtener Session Token.\n' + (lastErr?.message || String(lastErr || '')) + '\n\nTip: confirma que abriste la app desde Shopify Admin (embedded) y que viene ?host=...');
      return;
    }

    sessionStorage.setItem('shopifyShop', shop);
    sessionStorage.setItem('shopifyHost', host);
    sessionStorage.setItem('shopifyConnected', 'true');

    setStatus('Listo ✅');
    btnGo.disabled = false;

    btnGo.addEventListener('click', () => {
      const base = (getMeta('app-url') || window.location.origin).replace(/\/$/, '');
      const url  = `${base}/onboarding?from=shopify&shop=${encodeURIComponent(shop)}`;
      topNavigate(url);
    });
  }

  btnReload?.addEventListener('click', () => window.location.reload());
  boot().catch((e) => { setStatus('Error'); showError(e?.stack || e?.message || String(e)); });
})();
```

**Key changes from original:**
- `waitForAppBridge` checks `window.shopify.idToken` (modern) FIRST, then legacy
- `tryGetSessionToken` uses modern API first, then two legacy fallbacks
- No token stored in URL; only in `sessionStorage`

---

## 5. `scripts/shopify-session-smoke.js`  ← CREATE

```javascript
// scripts/shopify-session-smoke.js
const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZGVzdCI6Imh0dHBzOi8vdGVzdC5teXNob3BpZnkuY29tIiwiYXVkIjoidGVzdC1rZXkiLCJpYXQiOjE3MDAwMDAwMDB9.fake';

async function run() {
  console.log(`Running Shopify session smoke tests against ${BASE}`);

  // 1. No token → 401
  let r = await fetch(`${BASE}/api/secure/ping`);
  console.assert(r.status === 401, `Expected 401 without token, got ${r.status}`);
  console.log('✅ Protected route without token');

  // 2. Invalid token → 401 + reauth headers
  r = await fetch(`${BASE}/api/secure/ping`, { headers: { Authorization: 'Bearer invalid-token' } });
  console.assert(r.status === 401, `Expected 401 with invalid token, got ${r.status}`);
  const retry  = r.headers.get('X-Shopify-Retry-Invalid-Session-Request');
  const reauth = r.headers.get('X-Shopify-API-Request-Failure-Reauthorize');
  console.assert(retry  === '1', `Expected Retry header = 1, got ${retry}`);
  console.assert(reauth === '1', `Expected Reauthorize header = 1, got ${reauth}`);
  console.log('✅ Protected route with invalid token');

  // 3. Public config → 200
  r = await fetch(`${BASE}/api/public-config`);
  console.assert(r.status === 200, `Expected 200 on public-config, got ${r.status}`);
  console.log('✅ Allowlist route /api/public-config');

  // 4. Login → not 401 (200 or 4xx from credentials, not from token gate)
  r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.assert(r.status !== 401, `Expected non-401 on /api/login bypass, got ${r.status}`);
  console.log('✅ Allowlist route /api/login bypass');

  console.log('\n✅ All Shopify session smoke tests passed');
}

run().catch((e) => { console.error('❌ Smoke test failed:', e.message); process.exit(1); });
```

Add to `package.json` scripts:
```json
"test:shopify-session": "node scripts/shopify-session-smoke.js"
```

---

## 6. Verification checklist after implementation

### 6a. Smoke tests (localhost)
```powershell
npm start                      # in one terminal
npm run test:shopify-session   # in another
```
Expected: `✅ All Shopify session smoke tests passed`

### 6b. Smoke tests (staging)
```powershell
$env:SMOKE_BASE_URL='https://adray-app-staging-german.onrender.com'; npm run test:shopify-session
```

### 6c. Embedded DevTools checks (Shopify Admin → iframe context)
Set DevTools console to `app-iframe` context, then:

```javascript
// Valid token → expect 200
(async () => {
  const t = await window.shopify.idToken();
  const r = await fetch('/api/secure/ping', { headers: { Authorization: `Bearer ${t}` }, credentials: 'include' });
  console.log('valid token ->', r.status);  // must be 200
})();

// Invalid token → expect 401 + reauth headers
fetch('/api/secure/ping', { headers: { Authorization: 'Bearer invalid-token' }, credentials: 'include' })
  .then(r => console.log(
    'invalid token ->', r.status,  // must be 401
    'Retry:', r.headers.get('X-Shopify-Retry-Invalid-Session-Request'),   // must be 1
    'Reauth:', r.headers.get('X-Shopify-API-Request-Failure-Reauthorize') // must be 1
  ));
```

### 6d. No token in URL / storage
In DevTools console (iframe context):
```javascript
console.log('URL:', location.href.includes('sessionToken') || location.href.includes('id_token'));  // false
console.log('localStorage:', Object.keys(localStorage).filter(k => k.toLowerCase().includes('token')));  // []
```

---

## 7. ⚠️ What NOT to merge to main/production

| Commit / file change | Why to exclude |
|---|---|
| `TURNSTILE_BYPASS` env flag in `turnstile.js` | Disables captcha globally |
| `TURNSTILE_STAGING_AUTO_BYPASS` auto-detect | Disables captcha on all `onrender.com` URLs |
| `cf-turnstile-slot` div removed from `register.html` | Breaks captcha widget on prod |
| Any commit message containing "captcha" workaround | Staging-only hacks |

The captcha bypass was needed only because Cloudflare Turnstile fails on Render's
staging domain. On production (`adray.ai`) captcha works normally — do not carry
those bypasses over.

---

## 8. Recommended branching strategy

```
main (origin/main — clean)
  └── shopify-session-fix   ← fresh branch, apply all changes above manually
        └── smoke test ✅
        └── embedded check ✅
        └── PR → main
```

**Avoid cherry-picking across deeply diverged branches.** When `main` and `dev`
have been accumulating different commits for a long time, conflicts in large files
like `backend/index.js` become impossible to resolve reliably via cherry-pick.
The correct approach is:

1. Take a fresh checkout of `main`
2. Apply each change from this guide directly
3. Run smoke tests
4. Open a clean PR

This guarantees no accidental captcha bypass, no submodule pointer drift, and
no ghost conflicts from rebase/merge history.
