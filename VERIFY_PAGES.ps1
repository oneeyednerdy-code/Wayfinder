$ErrorActionPreference = "Stop"

Write-Host "WAYFINDER PAGES CHECK" -ForegroundColor Cyan

$required = @(
  "public/index.html",
  "functions/api/health.js",
  "functions/api/auth/session.js",
  "functions/api/auth/login.js",
  "functions/api/auth/callback.js",
  "wrangler.jsonc"
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Missing required Pages file: $path" }
}

if (Test-Path "public/_worker.js") {
  throw "public/_worker.js exists. Cloudflare Pages would ignore the functions/ directory."
}

$config = Get-Content "wrangler.jsonc" -Raw
if ($config -notmatch '"pages_build_output_dir"\s*:\s*"\./public"') { throw "wrangler.jsonc is not configured for ./public" }
if ($config -notmatch '"binding"\s*:\s*"WAYFINDER_DB"') { throw "WAYFINDER_DB binding is missing" }

npm test
npm run check

Write-Host "" 
Write-Host "Local structure and tests passed." -ForegroundColor Green
Write-Host "Next: npm run deploy" -ForegroundColor Green
Write-Host "After deploy, open /api/health then /api/auth/session." -ForegroundColor Green
