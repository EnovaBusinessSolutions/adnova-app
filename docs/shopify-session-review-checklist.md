# Shopify Session Tokens Review Checklist

## 1) Pre-flight (before running tests)
- Run build:
  - `npm run build`
- Start backend:
  - `npm start`
- Confirm app opens embedded from Shopify Admin (not external browser tab).

## 2) Automated smoke (local/staging)
- Run:
  - `npm run test:shopify-session`
- Expected result:
  - Protected endpoint without token => `401`
  - Protected endpoint with invalid token => `401`
  - Reauth headers present on `401`:
    - `X-Shopify-Retry-Invalid-Session-Request`
    - `X-Shopify-API-Request-Failure-Reauthorize`
  - Allowlist endpoints are not blocked by token gate:
    - `/api/public-config` returns `2xx`
    - `/api/login` does not return `401` from token gate

## 3) Manual embedded validation (required for review)
1. Open app from Shopify Admin.
2. In browser DevTools > Network, filter by `/api`.
3. Validate every protected `/api/*` request includes `Authorization: Bearer <JWT>`.
4. Confirm token is **not** sent in query params (`sessionToken` absent in URL).
5. Confirm token is **not** persisted in `localStorage/sessionStorage`.
6. Wait 70+ seconds and trigger API calls again.
7. Confirm API calls still succeed (fresh token per request).
8. Force invalid token scenario (tamper header in a replayed request) and confirm:
   - `401`
   - Reauth headers above

## 4) Evidence package before submit
- Export HAR of embedded session from Shopify Admin.
- Capture screenshots:
  - Request headers with `Authorization: Bearer ...`
  - 401 response showing reauth headers
  - Storage tab showing no persisted `sessionToken`
- Keep a short pass/fail log for each checklist item.

## 5) Go/No-Go criteria
- **GO** only if all automated smoke checks pass and manual steps 1-8 pass.
- **NO-GO** if any protected endpoint accepts missing/invalid token or if token appears in URL/storage.
