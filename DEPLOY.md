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
| Video shards | `goatmedia-media-1` … `-9`, bound as `MEDIA_1` … `MEDIA_9` |
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

A new video shard needs three things: the database itself, a `MEDIA_n` entry in
`wrangler.jsonc`, and this table inside it:

```bash
npx wrangler d1 create goatmedia-media-10
npx wrangler d1 execute goatmedia-media-10 --remote --command \
  "CREATE TABLE IF NOT EXISTS media_chunks (upload_id TEXT NOT NULL, idx INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (upload_id, idx));"
```

Shards are picked by least recorded size, so an added one starts filling
immediately; nothing has to be rebalanced by hand.

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

**Neither service is a general free-domain giveaway.** js.org only accepts sites
about the JavaScript ecosystem — npm packages and tools, not products that happen
to be written in JavaScript — so the prepared request in
[domain/js-org-request](domain/js-org-request/README.md) is likely to be closed.
is-a.dev now asks for websites that are "software development related" and
non-commercial, and [its repository forbids agent-written pull
requests](https://github.com/is-a-dev/register/blob/main/AGENTS.md), so the
correct record for `goatmedia.is-a.dev` is prepared in
[domain/is-a-dev](domain/is-a-dev/README.md) for you to submit yourself. That
folder also lists the free services with no subject rule, such as FreeDNS and
DuckDNS.

Whichever name you end up with, the switch is one command:

```bash
gh variable set CUSTOM_DOMAIN --body "goatmedia.is-a.dev"
```

Then add the new origin to `ALLOWED_ORIGINS` in `wrangler.jsonc` and redeploy,
or the browser is refused by CORS:

```bash
npx wrangler deploy
```

Push to `main` and the workflow rebuilds at the root path, then sets the Pages
custom domain from the same variable — no manual **Settings → Pages** edit is
needed, because `actions/configure-pages` applies the `cname` input. Tick
**Enforce HTTPS** once GitHub has issued the certificate. The old `/GoatMedia/`
address keeps working until the domain is set, so nothing breaks while DNS
settles.

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

## Automatic screening, warnings and appeals

Every upload is screened before it reaches the queue. A vision model on Workers
AI (`@cf/cloudflare/clef-flash`) looks at the poster frame or the first photos
and scores it for graphic gore; anything over `safety.goreThreshold` in
`worker/config.ts` is filed as `rejected` with the score kept on the post, and a
moderator can still approve it after watching. Workers AI is bound in
`wrangler.jsonc` (`"ai": { "binding": "AI" }`), so the first deploy after this
change attaches it. The free allowance is 10,000 neurons a day, roughly 2,000
screened images, and needs no payment method. With no binding or a failed call,
uploads simply queue for a person: the filter can never publish or delete
anything.

A flagged upload also records a warning. The first two email the reason and a
single-use appeal link; the third (`safety.warningLimit`) suspends the account
automatically. Moderators can warn by hand from the control center, and a
suspension always requires a written reason, because that sentence is what the
person reads and appeals against.

Mail is the one thing a Worker cannot do by itself. Either provider works, both
let you verify a single sender address without owning a domain:

| Provider | Free allowance | Variables |
| --- | --- | --- |
| Brevo | 300 messages/day | `BREVO_API_KEY`, `MAIL_FROM` |
| SendGrid | 100 messages/day | `SENDGRID_API_KEY`, `MAIL_FROM` |

```bash
npx wrangler secret put BREVO_API_KEY     # paste the key when prompted
npx wrangler secret put MAIL_FROM         # the verified sender address
npx wrangler secret put MAIL_FROM_NAME    # optional, defaults to GoatMedia
```

Until a key is set, notices are composed and logged as `skipped`, and the in-app
side of the event still happens, so moderation never silently depends on mail.
Check delivery after a test suspension:

```bash
npx wrangler d1 execute goatmedia --remote \
  --command "SELECT kind, status, error FROM emails ORDER BY created_at DESC LIMIT 5"
```

`SITE_ORIGIN` in `wrangler.jsonc` is where appeal links point. It is currently
the GitHub Pages address; change it to the custom domain in the same commit that
starts serving one. The `/GoatMedia/` path prefix is added automatically for a
`github.io` origin.

Appeals arrive under **Report center → Appeals** (`/admin?tab=reports&view=appeals`).
Accepting a suspension reinstates the account and puts back the posts that were
hidden with it; accepting a warning takes it off the tally. Both send a decision
email. A suspended account can still read the appeal page, because the link is
its own authorisation and does not need a session.

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
- D1 free: 5 million rows read/day, 100,000 written/day, 5 GB for the whole
  account and **500 MB per database**. Photos and audio are blobs in the main
  database; 768 KB video chunks are spread over the seven shard databases to
  get past that per-database cap. All of it is D1 because R2 requires a card.
  The daily row limits, not the storage, are what a viral clip hits first.
- Workers AI is free up to 10,000 neurons a day, which is about 2,000 screenshot
  checks on `clef-flash`; past that the filter stops answering and uploads queue
  for a person instead.
- Cloudflare cannot send mail from a Worker, so ban and warning notices need a
  free Brevo or SendGrid key (see above). Password resets still surface the link
  on screen, whatever provider is configured.
- GitHub Pages is free for public repositories.

## Operational checklist before opening up

- Set an email provider key so suspensions and warnings reach people by mail.
- Point `SITE_ORIGIN` at the address people actually open, then test one appeal
  link end to end from your inbox.
- Replace the on-screen password reset with the same email provider.
- Add a custom domain if you want one (and its origin in `ALLOWED_ORIGINS`).
- Keep the moderation queue under a day old; the product promise is that a
  person looks at every post.
- Export the D1 database periodically: `npx wrangler d1 export goatmedia --remote --output backup.sql`
