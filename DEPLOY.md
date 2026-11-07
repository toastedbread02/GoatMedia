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
                                              └ D1: users, posts, videos, photos, audio
```

## Live deployment

| What | Where |
| --- | --- |
| Site | https://toastedbread02.github.io/GoatMedia/ |
| API | https://goatmedia-api.dominikkoba22.workers.dev |
| D1 database | `goatmedia` — `99f990ab-4246-4b49-9353-9269a5ccd115` |
| Repo variable | `API_ORIGIN` = the Worker URL (used by the Pages build) |
| Optional variable | `CUSTOM_DOMAIN` = a domain you control, e.g. `goatmedia.is-a.dev` |

The site uses normal paths (`/GoatMedia/v/<id>`); the build copies `index.html`
to `404.html`, so deep links and refreshes work on Pages without a server
rewrite.

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

## A better address, for free

`toastedbread02.github.io/GoatMedia` reads as a dev demo. Two zero-cost options,
and the build supports either without code changes.

**No registrar gives away a real domain.** What is free is a subdomain: a domain
someone else owns, with one name pointed at your site. Both options below keep
the Cloudflare Worker exactly as it is.

### Option A — free subdomain, still hosted on GitHub Pages

[is-a.dev](https://www.is-a.dev) and [js.org](https://js.org) hand out free
subdomains through a pull request to their own repository.

**js.org only accepts sites about the JavaScript ecosystem** — npm packages and
tools, not products that happen to be written in JavaScript. GoatMedia is a goat
video site, so that request is likely to be closed. The exact request is still
prepared in [domain/js-org-request](domain/js-org-request/README.md), with the
reasoning, if you want to try anyway. Steps for is-a.dev, which has no subject
rule:

1. Fork `is-a.dev/is-a.dev`, add a file under `domains/` for the name you want
   (for example `goatmedia.json`) with your GitHub username, email, and a `CNAME`
   record pointing at `toastedbread02.github.io`. Follow the schema and naming
   rules in that repo's README — it changes, so copy theirs rather than this page.
2. Open the pull request and wait for review. It usually takes a few days.
3. Once it is merged and the name resolves, set the repository variable:

   ```bash
   gh variable set CUSTOM_DOMAIN --body "goatmedia.is-a.dev"
   ```

4. Add the new origin to `ALLOWED_ORIGINS` in `wrangler.jsonc` and redeploy the
   Worker, otherwise the browser is refused by CORS:

   ```bash
   npx wrangler deploy
   ```

5. In the repository's **Settings → Pages**, confirm the custom domain is listed
   and tick **Enforce HTTPS**.

Push to `main` and the workflow rebuilds at the root path. Note that Pages
ignores a `CNAME` file when publishing from a workflow, so the domain itself has
to be entered in **Settings → Pages** — that step is what makes the new name
serve the site. The old `/GoatMedia/` address keeps working, so nothing breaks
while DNS settles.

### Option B — instant, but the site moves off GitHub Pages

Cloudflare Pages gives a free `*.pages.dev` address immediately: create a Pages
project from this repository, build command `npm run build`, output directory
`dist`, environment variable `VITE_API_ORIGIN` set to the Worker URL. The site
is then served from `/`, so set `VITE_BASE_PATH` to `/` and remember to add
`https://<project>.pages.dev` to `ALLOWED_ORIGINS`. This is faster than Option A
but it moves hosting away from GitHub, which is not what this project was set up
to do.

### If you want a real top-level domain

Cloudflare Registrar sells at cost, and short names like `.xyz` or `.top` often
come in under a few dollars for the first year. Point the domain's DNS at GitHub
Pages, set `CUSTOM_DOMAIN`, add the origin to `ALLOWED_ORIGINS`, and the same
build works unchanged.

## First moderator

1. Open the site and create your own account.
2. Go to `/admin` (for example
   https://toastedbread02.github.io/GoatMedia/admin).
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
- D1 free: 5 million rows read/day, 100,000 written/day, ~10 GB total. Photos,
  audio and 768 KB video chunks are blobs in D1 because R2 requires a card. That
  is fine for a small community; R2 is the upgrade when media volume grows.
- Cloudflare has no email sending here, so password resets surface the link on
  screen. Add an email provider before opening sign-ups to the public.
- GitHub Pages is free for public repositories.

## Operational checklist before opening up

- Replace the on-screen password reset with a real email provider.
- Add a custom domain if you want one (and its origin in `ALLOWED_ORIGINS`).
- Keep the moderation queue under a day old; the product promise is that a
  person looks at every post.
- Export the D1 database periodically: `npx wrangler d1 export goatmedia --remote --output backup.sql`
