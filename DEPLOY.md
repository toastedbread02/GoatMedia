# Deploying GoatMedia

Two pieces:

1. **The site** — a static React build on GitHub Pages.
2. **The API** — a Cloudflare Worker with a D1 database, serving JSON and media.

They are on different origins on purpose (GitHub Pages cannot run a server), so
the API allows exactly the Pages origin via CORS and the browser authenticates
with a bearer token stored in local storage. No cookies, no cross-site cookie
problems.

```
GitHub Pages                         Cloudflare
toastedbread02.github.io/GoatMedia   goatmedia-api.<account>.workers.dev
        │                                     │
        └──── fetch + Bearer token ───────────┤ Worker (auth, feeds, moderation)
                                              └ D1: users, posts, photos, audio
```

## Live deployment

| What | Where |
| --- | --- |
| Site | https://toastedbread02.github.io/GoatMedia/ |
| API | https://goatmedia-api.dominikkoba22.workers.dev |
| D1 database | `goatmedia` — `99f990ab-4246-4b49-9353-9269a5ccd115` |
| Repo variable | `API_ORIGIN` = the Worker URL (used by the Pages build) |

Routing in the site is hash-based (`#/p/<id>`), so deep links and refreshes work
on Pages without a server rewrite.

## Pushing changes

Site: push to `main`. The workflow builds with `VITE_BASE_PATH=/GoatMedia/` and
`VITE_API_ORIGIN=${{ vars.API_ORIGIN }}`, then publishes `dist/`. If `API_ORIGIN`
is unset the job skips instead of shipping a site that cannot sign in.

API:

```bash
npx wrangler deploy          # after editing worker/
npx wrangler d1 migrations apply goatmedia --remote   # if migrations/ changed
```

Set or rotate secrets with `npx wrangler secret put <NAME>`:

- `PASSWORD_PEPPER` — mixed into every password hash. Rotating it invalidates
  all existing passwords, so do that only intentionally.
- `ADMIN_SETUP_TOKEN` — one-time claim code for the first moderator.

`ALLOWED_ORIGINS` lives in `wrangler.jsonc`; add any custom domain there before
using one, otherwise the browser will be refused by CORS.

## First moderator

1. Open the site and create your own account.
2. Go to `#/admin`.
3. Paste the code from `.secrets/admin-code.txt` (this file is git-ignored, mode
   600, created during setup).

The server promotes the signed-in account only if no moderator exists and the
token matches. Nothing about this check lives in the browser bundle.

If you lose the file, either set a new secret and re-run the claim (only possible
while no moderator exists), or promote directly:

```bash
npx wrangler d1 execute goatmedia --remote \
  --command "UPDATE users SET role='admin' WHERE username='yourname'"
```

## Configuring the site build

`VITE_API_ORIGIN` — absolute API origin, no trailing slash. Baked in at build
time. `VITE_BASE_PATH` — `/GoatMedia/` for a project site, `/` for a custom
domain.

For local development:

```bash
VITE_API_ORIGIN=https://goatmedia-api.dominikkoba22.workers.dev npm run dev
```

## Verification

```bash
npm run typecheck
npm run api:check
API_ORIGIN=https://goatmedia-api.dominikkoba22.workers.dev node scripts/live-check.mjs
```

`api:check` runs the Worker's own code against an in-memory D1 shim, so
moderation privacy, approvals, sound reuse and CORS are exercised without a
network. `live-check.mjs` does the same against the deployed Worker, including
real multipart uploads and media streaming.

## Free-tier notes

- Workers free: 100,000 requests/day, 10 ms CPU per request. Password hashing is
  tuned to fit; avoid expensive per-request work.
- D1 free: 5 million rows read/day, 100,000 written/day, ~10 GB total. Photos and
  audio are blobs in D1 because R2 requires a card. That is fine for a small
  community; R2 is the upgrade when media volume grows.
- Cloudflare has no email sending here, so password resets surface the link on
  screen. Add an email provider before opening sign-ups to the public.
- GitHub Pages is free for public repositories.

## Operational checklist before opening up

- Replace the on-screen password reset with a real email provider.
- Add a custom domain if you want one (and its origin in `ALLOWED_ORIGINS`).
- Keep the moderation queue under a day old; the product promise is that a
  person looks at every post.
- Export the D1 database periodically: `npx wrangler d1 export goatmedia --remote --output backup.sql`
