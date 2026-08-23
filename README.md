# Nerdspace Labs Wayfinder

**Alpha 0.4.2 — Timezone + Ecosystem Branding Polish (Pre-D1)**

Wayfinder turns Twitch analytics exports into evidence, experiments, and next actions instead of duplicating Twitch's analytics dashboard. Alpha 0.4.2 fixes a timezone-dependent EventSub test regression and aligns Wayfinder's visual identity with the Nerdspace Labs tool ecosystem while keeping the hardened pre-D1 OAuth architecture from 0.4.1.

## What changed in 0.4.2

- Fixed the EventSub raid-window test fixture so it is timezone-explicit and passes consistently on Windows/CDT as well as UTC environments.
- Added a regression test for explicit non-UTC stream offsets matched against Twitch UTC EventSub timestamps.
- Replaced the orbital graphic brand mark with a text-only `NERDSPACE LABS // WAYFINDER` wordmark.
- Tightened the purple/black ecosystem styling and removed cyan as a primary interface accent.
- Removed decorative orbit/upload branding elements that made Wayfinder feel visually separate from Wormhole, Solstice, and NerdSync.
- Corrected connected-auth UI copy so it accurately states that Twitch user access/refresh tokens are not stored.

## OAuth hardening retained from 0.4.1

- Twitch sign-in now uses the OIDC Authorization Code Grant.
- Login scope is hardcoded to exactly `openid`; `TWITCH_SCOPES` is no longer configurable.
- Every login uses independent cryptographically random `state` and `nonce` values.
- The callback validates the Twitch ID token signature with Twitch JWKS and verifies RS256, issuer, audience, authorized party, expiry, issue time, subject, and nonce.
- The temporary Twitch user access/refresh tokens returned by the OIDC token exchange are never copied into a Wayfinder session, browser storage, D1, logs, or API responses.
- Twitch identity is confirmed with `Get Users` using a server-side app access token after the ID token is verified.
- All supported Helix enrichment after login uses Wayfinder's app access token, not the creator's user token.
- Wayfinder's encrypted session contains only creator identity, CSRF state, session metadata, and optional EventSub status metadata.
- Sessions have an 8-hour absolute lifetime and rotate their stateless session identifier hourly.
- Login and callback routes include best-effort per-edge-instance request limiting.

## Why no `/validate` loop anymore?

Twitch requires third-party apps that *maintain an OAuth user-token session* to validate that access token. Wayfinder 0.4.2 does not maintain the Twitch user access token after the OIDC callback. The user token is transient login material only; subsequent supported Twitch reads use an app access token.

## Supported data contract

The 0.4.0 supported-data rules remain in force:

1. **Twitch Analytics CSV** — authoritative creator performance data.
2. **Twitch Helix / EventSub** — official context and verification only.
3. **TwitchTracker** — supplemental 30-day corroboration only; never overrides Twitch data or drives a recommendation alone.
4. **Creator-entered context** — human context for facts APIs cannot prove.

Unknown fields fail closed: Wayfinder ignores them until a supported meaning is deliberately implemented.

## Revenue privacy

Revenue remains permanently out of scope. Headers containing revenue, earnings, payout, proceeds, or income are discarded at the CSV import boundary. Monetary values are not normalized, analyzed, displayed, exported, logged, stored, or transmitted.

## Pre-D1 behavior

D1 is **not required** for Alpha 0.4.2 OAuth or Helix enrichment. Without a `WAYFINDER_DB` binding:

- Twitch login works.
- CSV analysis works.
- App-token Helix enrichment works.
- TwitchTracker context works.
- Persistent EventSub history and automatic historical raid-event storage remain disabled.

The existing D1/EventSub code is left compatible for a later deployment, but this release does not add a D1-backed session store or require D1 setup.

## Development

```bash
npm test
npm run check
npm run dev
```

Cloudflare Pages:

```text
Framework preset: None
Build command: exit 0
Build output directory: public
```

See `DEPLOYMENT.md` for the pre-D1 setup.
