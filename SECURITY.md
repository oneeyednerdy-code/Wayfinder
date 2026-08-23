# Wayfinder Security Notes — Alpha 0.4.3

## Twitch login model

Wayfinder uses Twitch OpenID Connect Authorization Code Grant for identity only.

The authorization request is fixed to:

```text
response_type=code
scope=openid
state=<random>
nonce=<random>
```

`TWITCH_SCOPES` is intentionally unsupported. This prevents an environment-variable mistake from silently requesting broader Twitch permissions.

## Callback validation

Before a Wayfinder session is issued, the callback verifies:

- OAuth `state` matches the encrypted short-lived state cookie.
- OIDC `nonce` matches the nonce embedded in the Twitch ID token.
- JWT algorithm is RS256.
- JWT signature validates against Twitch's current JWKS.
- Unknown signing-key IDs trigger one forced JWKS refresh before failing closed.
- `iss` is exactly `https://id.twitch.tv/oauth2`.
- `aud` contains the configured Twitch Client ID.
- `azp`, when present, equals the configured Twitch Client ID.
- `exp` has not expired.
- `iat` is not unreasonably in the future.
- `sub` exists and matches the Twitch user subsequently returned by `Get Users` using an app access token.

## Twitch user tokens

The OIDC code exchange necessarily returns a temporary user access token, refresh token, and ID token. Wayfinder uses the ID token to authenticate identity and does **not** persist the user access token or refresh token.

They are not copied into:

- the Wayfinder session cookie
- client JavaScript
- localStorage/sessionStorage
- D1
- logs
- exported reports
- TwitchTracker requests

All supported Helix reads after login use a server-side Twitch app access token acquired with the client-credentials flow.

## Wayfinder session

Authentication sessions remain stateless and AES-GCM encrypted with `SESSION_SECRET`; D1 is currently used for supported EventSub persistence, not session storage.

Production cookies use:

- `__Host-` prefix
- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`

The encrypted payload contains only the connected creator identity, CSRF token, random Wayfinder session ID, session timestamps, auth-method marker, and optional non-secret EventSub status metadata.

Session policy:

- absolute lifetime: 8 hours
- session identifier rotation: hourly
- expired or malformed sessions fail closed

A truly opaque, immediately server-revocable session requires server-side state and is intentionally deferred until the later D1 session phase.

## CSRF and origin protection

Authenticated state-changing endpoints require same-origin browser context plus the per-session `X-Wayfinder-CSRF` token. OAuth uses a separate encrypted 10-minute state/nonce cookie.

## Login abuse protection

Login and callback endpoints include a best-effort in-memory limiter per Cloudflare edge isolate. This is useful defense in depth but is not a substitute for a Cloudflare account-level WAF/Rate Limiting rule for public beta.

## CSV privacy

Revenue/earnings/payout/proceeds/income fields are discarded at the import boundary. Unknown CSV fields are ignored rather than guessed. CSV text is HTML-escaped before rendering.

## EventSub and D1

This release does not require or deploy D1. Without D1, persistent EventSub history is disabled. Existing EventSub webhook verification code continues to use Twitch HMAC verification, timestamp freshness, replay protection, and minimized payloads when EventSub persistence is enabled later.


## Cloudflare Worker deployment boundary

Wayfinder 0.5.0 runs as a single Cloudflare Worker with Static Assets. `src/index.js` is the only Worker entry point. It explicitly routes supported `/api/*` endpoints and serves all non-API requests through the `ASSETS` binding. This removes reliance on Pages file-based Function discovery.

Static responses and API responses pass through the same security-header layer because `assets.run_worker_first` is enabled.

The D1 binding remains `WAYFINDER_DB`. Twitch secrets are Worker secrets and are never placed in `wrangler.jsonc`.

The uploaded Twitch analytics CSV remains browser-local. Revenue fields are discarded before normalization and are not sent to the Worker.
