# Shopify App URL switching (staging <-> production)

This project now has two Shopify CLI config files:

- `shopify.app.staging.toml`
- `shopify.app.toml` (production/default)

## Why this helps
- No manual URL edits in Partner Dashboard for each test cycle.
- Safe and reversible in one command.
- Lower risk of shipping staging URLs to production by mistake.

## Deploy staging app URLs (for review tests)
From repo root:

- `npm run shopify:deploy:staging`

Then reinstall/reopen app in your dev store from Shopify Admin > Apps.

## Switch back to production URLs
From repo root:

- `npm run shopify:deploy:prod`

Then reopen app in Shopify Admin and validate.

## Quick verification after each deploy
1. Run smoke test against target URL:
   - PowerShell:
     - `$env:SMOKE_BASE_URL='https://your-target-domain'; npm run test:shopify-session`
2. Open app embedded in Shopify Admin and verify:
   - Authorization Bearer header present on protected `/api` calls
   - no `sessionToken` in URL
   - no `sessionToken` in Local/Session Storage

## Important note
Passing staging tests gives high confidence, but not a hard guarantee for production.
You still need to run the same smoke + embedded manual checks after switching back to production URLs.
