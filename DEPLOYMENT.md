# Wayfinder Alpha 0.4.2 — Pre-D1 Cloudflare Pages Deployment

This guide intentionally stops before D1 deployment.

## 1. Cloudflare Pages build

Use:

```text
Framework preset: None
Build command: exit 0
Build output directory: public
```

Keep the repository-root `functions/` directory. Pages Functions provide the OAuth and API routes.

## 2. Twitch Developer Console

Register/use a Twitch application and set the OAuth redirect URL to exactly:

```text
https://YOUR-WAYFINDER-HOST/api/auth/callback
```

Use the final production hostname you actually intend to serve. The configured redirect must exactly match `TWITCH_REDIRECT_URI`.

Wayfinder 0.4.2 hardcodes the only login scope to:

```text
openid
```

Do not configure `TWITCH_SCOPES`.

## 3. Cloudflare secrets / variables

Required:

```text
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
SESSION_SECRET
TWITCH_REDIRECT_URI
```

`TWITCH_CLIENT_SECRET` and `SESSION_SECRET` should be Cloudflare encrypted secrets. `SESSION_SECRET` must contain at least 32 random characters.

Example:

```text
TWITCH_CLIENT_ID=...
TWITCH_REDIRECT_URI=https://wayfinder.example.com/api/auth/callback
```

Do not expose `TWITCH_CLIENT_SECRET` in frontend code.

## 4. D1

**Skip D1 for this release.**

Do not add a `WAYFINDER_DB` binding yet. Wayfinder will automatically operate in pre-D1 mode. Login, CSV analysis, Twitch Helix enrichment, and TwitchTracker context continue to work.

Persistent EventSub history / automatic retained raid events remain unavailable until D1 is intentionally deployed later.

## 5. Verify OAuth hardening

After deployment:

1. Open Wayfinder and choose Connect Twitch.
2. Confirm Twitch's authorization URL requests `scope=openid` only.
3. Complete login and confirm the correct Twitch identity is displayed.
4. Confirm `/api/auth/session` never contains `accessToken`, `refreshToken`, or `idToken`.
5. Confirm `/api/twitch/data` still returns supported Twitch channel/VOD/clip/schedule context.
6. Wait/reload after a normal session request and confirm the app remains usable.
7. Disconnect and confirm the local Wayfinder session clears.
8. Confirm a session older than 8 hours requires Twitch sign-in again.

## 6. Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in local values. Never commit `.dev.vars`.

For local OAuth, register the exact local callback URL with Twitch, for example:

```text
http://localhost:8788/api/auth/callback
```

Run:

```bash
npm install
npm test
npm run check
npm run dev
```

## 7. Recommended public-beta edge protection

The code contains best-effort per-isolate auth rate limiting. For public beta, also configure Cloudflare's account-level rate limiting/WAF for:

```text
/api/auth/login
/api/auth/callback
```

That gives distributed protection rather than relying only on isolate-local counters.
