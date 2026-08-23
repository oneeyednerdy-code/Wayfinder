# Wayfinder Alpha 0.4.3 — Cloudflare Pages Native Deployment

This release is structured specifically for Cloudflare Pages + Pages Functions. Do not create a standalone Worker for this package and do not use dashboard drag-and-drop if you need Twitch OAuth or API routes.

## Project layout

The repository root must directly contain:

- `public/` — static Wayfinder interface
- `functions/` — Cloudflare Pages Functions
- `migrations/` — D1 schema
- `wrangler.jsonc` — Pages + D1 configuration
- `package.json`

There must be no `_worker.js` inside `public/`; if one exists Cloudflare Pages ignores the `functions/` directory.

## D1 already configured in wrangler.jsonc

- Binding: `WAYFINDER_DB`
- Database: `nerdspace-wayfinder`
- Database ID: `10010498-356c-4a6b-8047-1fecf9dfa5e5`

Apply the schema once:

```powershell
npx wrangler d1 execute nerdspace-wayfinder --remote --file=migrations/0001_wayfinder_eventsub.sql
```

## Required Cloudflare variables/secrets

Normal variables:

- `TWITCH_CLIENT_ID`
- `TWITCH_REDIRECT_URI=https://YOUR_DOMAIN/api/auth/callback`
- `TWITCH_EVENTSUB_CALLBACK=https://YOUR_DOMAIN/api/eventsub`

Encrypted secrets:

- `TWITCH_CLIENT_SECRET`
- `SESSION_SECRET` (minimum 32 characters; use a strong random value)
- `TWITCH_EVENTSUB_SECRET` (10–100 characters; use a separate random value)

Wayfinder OIDC login requests only `openid`.

## Deploy with Wrangler — recommended for the current project

From the repository root:

```powershell
npm install
npx wrangler login
npm test
npm run check
npm run deploy
```

Because `wrangler.jsonc` includes `pages_build_output_dir`, `npm run deploy` knows to publish `./public`. Run this command from the directory containing `functions/` so Wrangler includes Pages Functions.

If Cloudflare asks which Pages project to use/create, choose `nerdspace-wayfinder` (or change the `name` in `wrangler.jsonc` to your actual Pages project name before deploying).

## Git-connected Pages deployment

Use a Cloudflare **Pages** project, not a Worker.

- Framework preset: None
- Build command: `exit 0`
- Build output directory: `public`
- Root directory: blank when `public/`, `functions/`, and `wrangler.jsonc` are at repository root

When a Pages Wrangler config with `pages_build_output_dir` is committed, treat it as the project configuration source of truth.

## Verify Pages Functions before Twitch login

Open:

`https://YOUR_DOMAIN/api/health`

Expected shape:

```json
{
  "ok": true,
  "app": "Nerdspace Labs Wayfinder",
  "version": "0.4.3",
  "runtime": "cloudflare-pages-functions",
  "d1": {
    "configured": true,
    "reachable": true
  }
}
```

Then test:

`https://YOUR_DOMAIN/api/auth/session`

It should return JSON such as `{"connected":false}` rather than 404.

Then open:

`https://YOUR_DOMAIN/api/auth/login`

It should redirect to Twitch.

## Twitch Developer Console

The OAuth redirect must exactly match `TWITCH_REDIRECT_URI`, for example:

`https://YOUR_DOMAIN/api/auth/callback`

Do not add `/` to one version but not the other. Protocol, host, path and port must match.

## Local development

Create `.dev.vars` from `.dev.vars.example`, then run:

```powershell
npm install
npm run dev
```

Wrangler uses the Pages config automatically. Local D1 uses Wrangler's local persistence; production D1 is not modified by normal local development.

## Important deployment warning

Dashboard drag-and-drop can serve the static files but does not compile a `functions/` directory. That produces exactly this failure pattern:

- `/` works
- `/api/auth/session` = 404
- Twitch authentication = 404

Deploy with Wrangler or Git-integrated Cloudflare Pages whenever Wayfinder Pages Functions are required.
