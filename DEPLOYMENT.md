# Nerdspace Labs Wayfinder Alpha 0.5.0 — Cloudflare Worker + Git Deployment

This release is built for a single Cloudflare Worker with Static Assets, API routing, D1, Twitch OIDC, EventSub, Twitch enrichment, TwitchTracker context, and the Wayfinder frontend.

## Target URL

With Worker name `wayfinder` and account workers.dev subdomain `oneeyednerdy`, Cloudflare will use:

`https://wayfinder.oneeyednerdy.workers.dev`

If your Cloudflare account subdomain differs, use the hostname Cloudflare assigns.

## Repository root

The Git repository root must directly contain:

- `src/index.js`
- `public/`
- `functions/`
- `migrations/`
- `wrangler.jsonc`
- `package.json`

The old `functions/` modules remain as reusable server modules, but `src/index.js` is now the Worker entry point and explicitly routes `/api/*` requests.

## 1. Install and verify locally

```powershell
npm install
npm test
npm run check
npm run dev
```

Open the local Wrangler URL and verify:

- `/`
- `/api/health`
- `/api/auth/session`

## 2. D1

The included `wrangler.jsonc` already binds:

- binding: `WAYFINDER_DB`
- database: `nerdspace-wayfinder`

If the database tables are not already initialized:

```powershell
npx wrangler d1 execute nerdspace-wayfinder --remote --file=migrations/0001_wayfinder_eventsub.sql
```

## 3. Required Worker secrets

Set these on the Worker:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `SESSION_SECRET`
- `TWITCH_REDIRECT_URI`
- `TWITCH_EVENTSUB_CALLBACK`
- `TWITCH_EVENTSUB_SECRET`

For the requested hostname:

`TWITCH_REDIRECT_URI=https://wayfinder.oneeyednerdy.workers.dev/api/auth/callback`

`TWITCH_EVENTSUB_CALLBACK=https://wayfinder.oneeyednerdy.workers.dev/api/eventsub`

Use the exact deployed hostname if Cloudflare assigns a different account subdomain.

Bulk import from JSON:

```powershell
npx wrangler secret bulk .\wayfinder-worker-secrets.json
```

## 4. Twitch Developer Console

Add this exact OAuth redirect URL:

`https://wayfinder.oneeyednerdy.workers.dev/api/auth/callback`

Wayfinder requests only the OIDC `openid` scope.

## 5. First manual deployment

```powershell
npx wrangler login
npm run deploy
```

Then test:

- `https://wayfinder.oneeyednerdy.workers.dev/api/health`
- `https://wayfinder.oneeyednerdy.workers.dev/api/auth/session`
- `https://wayfinder.oneeyednerdy.workers.dev/api/auth/login`

## 6. Connect the Worker to GitHub

Cloudflare dashboard:

1. Workers & Pages
2. Select the `wayfinder` Worker (or Create application → Import a repository)
3. Settings → Builds
4. Connect GitHub
5. Select the Wayfinder repository
6. Production branch: `main`
7. Deploy command: `npx wrangler deploy`

Cloudflare Workers Builds can automatically deploy every push to the selected branch.

## 7. Production workflow

```powershell
git add .
git commit -m "Wayfinder update"
git push origin main
```

Cloudflare then builds and deploys the Worker from Git.

## Privacy

Revenue is discarded at the browser CSV import boundary. Uploaded CSV contents are not sent to the Worker. Twitch user access and refresh tokens are not persisted. D1 stores only the narrow EventSub/creator context defined by Wayfinder.
