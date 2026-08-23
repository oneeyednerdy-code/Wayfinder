# Nerdspace Labs // Wayfinder

**Alpha 0.5.0 — Workers + Git Architecture**

Wayfinder turns Twitch analytics exports into evidence, experiments, and next actions instead of cloning Twitch Analytics.

This release is built as a single Cloudflare Worker with Static Assets. The Worker serves the existing frontend from `public/` and explicitly routes all `/api/*` traffic through `src/index.js`.

## Architecture

- `src/index.js` — Cloudflare Worker entry point and API router
- `public/` — static Wayfinder frontend
- `functions/` — reusable server modules for OAuth, Twitch, EventSub, TwitchTracker, D1, and security helpers
- `migrations/` — D1 schema
- `wrangler.jsonc` — Worker, Static Assets, workers.dev, and D1 configuration
- `tests/` — regression tests

## Target deployment

Worker name: `wayfinder`

If the Cloudflare account workers.dev subdomain is `oneeyednerdy`, the URL is:

`https://wayfinder.oneeyednerdy.workers.dev`

## Local development

```powershell
npm install
npm test
npm run check
npm run dev
```

## Deploy

```powershell
npx wrangler login
npm run deploy
```

Then verify:

- `/api/health`
- `/api/auth/session`
- `/api/auth/login`

## Git deployments

Cloudflare Workers Builds can connect this Worker to GitHub or GitLab. Pushes to the selected production branch can deploy automatically with `npx wrangler deploy`.

## D1

Wayfinder expects:

- binding: `WAYFINDER_DB`
- database: `nerdspace-wayfinder`

The included Wrangler configuration references the existing database ID configured for this project.

## Privacy boundary

Revenue and other monetary fields are discarded at CSV import and are not available to Wayfinder intelligence. Uploaded CSV contents remain browser-local. Twitch user access and refresh tokens are not persisted.

## Diagnostics

A privacy-safe diagnostics log is available at the bottom of the interface. It intentionally excludes tokens, OAuth values, URL query strings, CSV contents, revenue, creator identity, and message/chat content.
