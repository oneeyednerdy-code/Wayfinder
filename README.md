# Nerdspace Labs // Wayfinder

**Alpha 0.6.0 — Dual-Mode Evidence Engine**

Wayfinder turns Twitch data into transparent creator decisions without generative AI or mystery scoring.

## Analysis modes

### Last 30 Days
Requires a connected Twitch account. Wayfinder combines:
- TwitchTracker's supported rolling 30-day aggregate summary fields for aggregate performance context.
- Twitch Helix for official VOD, clip, current channel, and planned schedule context.
- Twitch EventSub/D1 history for verified events Wayfinder has observed, such as incoming raids and stream online/offline events.

This mode intentionally does **not** claim historical per-stream average viewers, best categories, or best streaming days unless a supported source actually provides the required evidence.

### CSV Period
Upload one or more Twitch Analytics CSV exports for a specific month or period. CSV files are parsed locally in the browser. Revenue, earnings, payout, proceeds, and income columns are discarded at the import boundary and never enter the intelligence model.

When Twitch is connected, supported official Twitch context and matching EventSub history can enrich the CSV analysis. TwitchTracker is supplemental and never overrides Twitch's exported analytics.

## Source hierarchy
1. Twitch Analytics CSV — authoritative performance data when supplied.
2. Twitch API / EventSub — official context and verified observed events.
3. TwitchTracker — aggregate 30-day input in automatic mode; supplemental corroboration in CSV mode.
4. Creator annotations — explicit human context for events APIs cannot reliably establish historically.

## Worker architecture
Wayfinder runs as one Cloudflare Worker with Static Assets and explicit `/api/*` routing. D1 binding: `WAYFINDER_DB`.

## Commands
```bash
npm install
npm test
npm run check
npm run dev
npm run deploy
```

See `DEPLOYMENT.md` and `SECURITY.md` for configuration details.
