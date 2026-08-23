# Nerdspace Labs // Wayfinder

**Alpha 0.4.3 — Pages Native Deployment Fix**

Wayfinder turns Twitch analytics exports into evidence, experiments, and next actions rather than cloning Twitch Analytics. This release preserves the supported-data, revenue-privacy, OIDC, and timezone fixes from 0.4.x while making Cloudflare Pages deployment explicit and verifiable.

## Pages-native structure

- `public/` — static interface
- `functions/` — Pages Functions for Twitch OIDC, Helix enrichment, EventSub, TwitchTracker, and health checks
- `migrations/` — D1 event history schema
- `wrangler.jsonc` — authoritative Pages output + D1 binding configuration

No standalone Worker entrypoint and no `public/_worker.js` are used.

## Deployment verification

After deploying, visit `/api/health`. If that endpoint returns JSON, Pages Functions are active. Then `/api/auth/session` should return JSON and `/api/auth/login` should redirect to Twitch.

See `DEPLOYMENT.md` for the complete deployment sequence.

## Privacy

The Twitch CSV is parsed locally in the browser. Revenue/earnings/payout/income fields are discarded at import and are not available to Wayfinder intelligence, reports, Cloudflare Functions, D1, Twitch, or TwitchTracker.

## Authentication

Wayfinder uses Twitch OIDC Authorization Code login with hardcoded `openid`, cryptographic state and nonce validation, Twitch JWKS signature validation, and a short-lived encrypted Wayfinder session. Twitch user access/refresh tokens are not retained after authentication.

## Tests

```powershell
npm install
npm test
npm run check
npm run pages:build
```
