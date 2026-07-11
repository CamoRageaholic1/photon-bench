# Photon Bench deployment

Photon Bench is deployed from the `main` branch to the Cloudflare Pages project `photon-bench`. Production uses `https://photonbench.camozeroday.dev`.

## Release path

1. GitHub Actions runs the fourteen physics, geometry, preset, and release-safety tests.
2. `npm run build` copies only `index.html`, `src/`, and `_headers` into `dist/`.
3. `cloudflare/wrangler-action` publishes `dist/` to Cloudflare Pages.
4. Cloudflare retains immutable deployment history while the custom domain follows the current production deployment.

The repository needs these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN` — scoped for Cloudflare Pages write access.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account containing `camozeroday.dev`.

## Pre-deploy checks

- `npm test` passes.
- `npm run build` completes and contains `dist/index.html`, `dist/src/main.js`, and `dist/_headers`.
- No credential-shaped values are present in the repository.
- The nominal link, stress preset, cable drag, emitter slide, emitter pivot, splice alignment, and clean/dirty controls work in a browser.

## Rollback

Rollback triggers are a non-200 production response, blocked module/CSP errors, a failed core interaction, or a materially incorrect link budget.

For a code rollback, revert the offending commit and push `main`; the same tested workflow publishes the prior state. For an immediate infrastructure rollback, promote the previous successful deployment from the Cloudflare Pages deployment history, then investigate without changing DNS.
