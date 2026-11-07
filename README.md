# GoatMedia

A small social network for goat videos and photo albums. Videos autoplay in a
vertical reel; multiple photos in one post become a sideways carousel; sounds
are shared and reusable; every post waits for a human moderator before it
appears anywhere public.

- **Site:** https://toastedbread02.github.io/GoatMedia/ — static React build on GitHub Pages
- **API:** https://goatmedia-api.dominikkoba22.workers.dev — Cloudflare Worker + D1

## What is in here

| Path | What it is |
| --- | --- |
| `src/` | The browser app (React, TypeScript, Vite, BrowserRouter) |
| `worker/` | The API: routing, auth, posts, feeds, moderation, media |
| `migrations/` | D1 schema (users, posts, videos, photos, sounds, moderation, reports…) |
| `scripts/api-check.ts` | Runs the real Worker code against a `node:sqlite` D1 shim (171 checks) |
| `scripts/live-check.mjs` | End-to-end checks against the deployed Worker (31 checks) |
| `wrangler.jsonc` | Worker config, D1 binding, allowed site origins |

Photos and audio are stored as blobs in D1 rather than R2, because R2 requires a
payment method on Cloudflare and this deployment is deliberately card-free.
Videos take a different route: they are uploaded in 768 KB chunks, and the API
reads back only the chunks a byte range touches, so clips stream with normal
seeking. Each blob is capped well under D1's 2 MB row limit, and the browser
re-encodes photos before upload (which also strips EXIF/GPS).

## Features

**Feeds** — For You (personalized), Trending, Following, category pages, search
for captions/hashtags/sounds/creators. A vertical reel snaps from one post to
the next and plays exactly one video at a time. Photos lazy-load, feeds paginate,
and a post is only in a feed when its status is `approved` and its owner is
active.

**Posts** — Videos (MP4/MOV/WEBM/M4V) play full-screen in the reel with sound and
playback controls; photo albums hold 1–6 photos in a swipeable carousel with
dots, arrows, counter and keyboard support. Caption with hashtags; one category;
optional shared sound on photo albums. Likes, comments, follows, sharing,
not-interested, reporting, blocking.

**Sounds** — Upload an MP3/M4A/AAC/OGG/WAV with a post, or borrow any sound from
the shared library. Sound credits stay with the original creator and reuse is
counted. Posts can also have no audio at all.

**Moderation** — Nothing is published automatically. Uploads are `pending` and
visible only to their author and the moderator. The dashboard reviews pending,
approved, rejected and removed posts with video playback and photo preview,
creator details, moderation history and reports. Editing the caption of a live
post puts it back in the queue. The moderator can remove live posts, suspend
accounts, and handle video/comment/account reports. A report center also holds
contact requests from the public, including the sender's device and page, and a
control center can suspend, remove and restore accounts without a second tool. A
moderator can share the role from the control center, so several trusted people
can work the review queue, report center and account controls; access changes
take effect on the next request, and nobody can edit their own role.

**Recommendations** — An explainable scoring model, no machine learning. Signals
are weighted (complete +5, rewatch +6, like +3, comment +2, follow +4, skip −4,
not interested −15), decayed over 30 days, and clamped. Pages are assembled from
configurable quotas (80% personalized / 15% discovery / 5% trending) with a
two-posts-per-creator cap, freshness decay and an exposure penalty. Users can see
and reset what the model has learned under Settings → Feed.

**Accounts** — Sign-up records a date of birth to enforce a 13+ minimum, server
side. Settings covers profile, appearance (light, dark or follow the system),
reduced motion, privacy (private follower lists, opt out of people search),date of birth and account security. Pages render layout-matched skeletons while data
loads. A contact button on every page opens a report form for problems, people and
account recovery; guests can use it, and every message notifies the moderator.

Manual moderation is the default at every size. Passing 1,000 accounts does not
change it; that remains an explicit decision.

## Running the site locally

```bash
npm install
VITE_API_ORIGIN=https://goatmedia-api.dominikkoba22.workers.dev npm run dev
```

`npm run build` produces `dist/`. Locally, point `VITE_API_ORIGIN` at a deployed
Worker: the API is a Cloudflare Worker, and `wrangler dev` needs workerd, which
does not run on macOS below 13.5.

## Deploying

**Site (GitHub Pages).** Every push to `main` runs
`.github/workflows/pages.yml`, which builds with `VITE_BASE_PATH=/GoatMedia/` and
the repository variable `API_ORIGIN`. Set it with:

```bash
gh variable set API_ORIGIN --body "https://goatmedia-api.dominikkoba22.workers.dev"
```

**API (Cloudflare Workers).**

```bash
npx wrangler d1 migrations apply goatmedia --remote   # schema
npx wrangler deploy                                    # the Worker
```

Worker secrets: `PASSWORD_PEPPER` (server-side pepper for password hashes) and
`ADMIN_SETUP_TOKEN` (one-time moderator claim). Both are already set on the live
deployment.

**First moderator.** Sign up on the site with your own account, open `/admin`,
and paste the setup token from `.secrets/admin-code.txt` (git-ignored, mode 600).
The claim endpoint only works while no moderator exists, and the token never
ships in the site bundle. Alternative, if you have Wrangler access:

```bash
npx wrangler d1 execute goatmedia --remote \
  --command "UPDATE users SET role='admin' WHERE username='yourname'"
```

**More moderators.** Open `/admin?tab=accounts`, find the account, and choose
Make moderator. The role is checked against D1 on every privileged request, so
the new moderator sees the moderation link immediately after their next page
load. Remove moderator access works the same way; the last moderator and your
own account are protected.

## Limits and configuration

- 6 photos per post, 1.8 MB each after browser resizing
- 25 MB video, 1–180 s (three minutes), MP4/MOV/WEBM/M4V
- 1.5 MB audio, 60 s name field, 400-character comments, 300-character captions
- 0.4 MB avatars
- 8 posts/hour, 12 comments/minute, 12 sign-in attempts per 10 minutes per IP
- Feed quotas and interest weights live in `worker/config.ts`

## Testing

```bash
npm run typecheck     # app + Worker
npm run api:check     # 183 checks: auth, age gate, privacy, moderation, shared roles, feeds, media, streaming, CORS
API_ORIGIN=https://goatmedia-api.dominikkoba22.workers.dev node scripts/live-check.mjs
```

`live-check.mjs` needs `.secrets/admin-code.txt` and creates throwaway accounts
and posts. It is a smoke test, not a load test.

## Known limitations

- **No email provider connected.** Password reset links are shown on screen
  instead of being emailed. Wire an email service into
  `worker/routes/auth.ts` before opening the site widely.
- **Manual moderation is a human queue.** Roles can be shared, but a backlog is
  still a feature of the design, not a bug, and it has no SLA.
- **D1 blob storage** is a pragmatic answer to a card-free requirement, not the
  cheapest way to serve media at scale. Videos are read chunk-by-chunk on demand,
  but a popular clip still costs D1 reads. R2 with a payment method is the upgrade
  path; media URLs are stable, so only `worker/routes/media.ts` and the upload
  path change.
- **Free-plan CPU.** Password hashing uses PBKDF2 with 6,000 iterations plus a
  server-side pepper so it fits the 10 ms CPU budget. On Workers Paid, raise
  `PASSWORD_ITERATIONS`.
- **Local workerd** cannot run on this machine (macOS 12.6); the API harness in
  `scripts/api-check.ts` exists for that reason.
- No direct messages, no self-service account deletion yet (ask the moderator),
  media is immutable after posting (edit the caption or repost).
