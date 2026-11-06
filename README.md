# GoatMedia

A video community for goats. People upload clips, a human watches every one of them, and only approved videos appear in the feed.

This is a working application, not a prototype: real accounts, real uploads with server-side processing, a real moderation queue, and a feed ordered by an explainable recommendation model. There is no automatic approval anywhere in the codebase, by design.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Client | React 19 + TypeScript + Vite | Fast dev loop, no framework runtime needed for this size |
| API | Express 5 (TypeScript, run through `tsx`) | Small surface, easy to audit, streams media with range requests |
| Database | SQLite via `node:sqlite` | One file to back up, real transactions, no external service to babysit before 1,000 users |
| Media | `ffmpeg` / `ffprobe` | Duration + type validation, metadata stripping, poster frames, faststart remux |
| Sessions | HTTP-only cookies, hashed tokens in the DB | No tokens in `localStorage`, sessions revocable on suspension |
| Passwords | `scrypt` with per-user salt | Standard library, no dependency |

The original request suggested Supabase. This build keeps everything on one machine instead: the moderation rules ("pending media must not be reachable by guessed URL") are easier to guarantee when the API owns both the database and the private media directory. Everything is behind a clean HTTP API, so swapping in hosted Postgres/object storage later is a change to `server/db.ts` and `server/media.ts`, not a rewrite.

## Running it locally

Requirements: Node 22.5 or newer (for `node:sqlite`), and `ffmpeg` on your `PATH`.

```bash
npm install
cp .env.example .env      # defaults are fine for local work
npm run seed:dev          # optional: sample accounts and credited goat clips
npm run dev               # API on :3001, app on :5173
```

Open http://localhost:5173.

`npm run seed:dev` downloads a handful of Wikimedia Commons goat clips, re-encodes them through the same pipeline real uploads use, and creates four development accounts. Each seeded video is labelled in the UI with its author and licence. Seeded rows have no invented views, likes or comments — sample footage is not fake community activity.

Development sign-ins created by the seed (password `goats-like-clover` for all four):

| Account | Role |
| --- | --- |
| `barnnotes` | creator |
| `kidsofcapra` | creator |
| `sunnyvaleherd` | creator |
| `highcountry` | creator |

Seeded videos start out approved so the feed has something to show. Create your own moderator account with the steps below.

## Creating the first moderator

Moderator rights are never granted through the web UI. They come from a CLI that runs on the server:

```bash
npm run admin:create -- --email you@example.com --username keeper --display-name "Your Name"
```

The script prints a generated password once (or use `--password` with at least 12 characters). Store it in a password manager, sign in at `/login`, then open `/admin`.

To give an existing account moderator rights:

```bash
npm run admin:create -- --email you@example.com --username yourname --promote
```

That promotes the account and resets its password. There is no self-service path to `role = 'admin'`, and `/api/admin/*` checks the role in the session on the server for every request.

## Configuration

Everything lives in `.env` (see `.env.example`). All values have development defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API / production server port |
| `APP_ORIGIN` | `http://localhost:5173` | Public origin used in reset links and origin checks |
| `DATA_DIR` | `.data` | SQLite file, private media, posters, avatars, temp uploads |
| `MAX_UPLOAD_MB` | `200` | Upload size ceiling |
| `MAX_DURATION_SECONDS` | `180` | Longest accepted clip |
| `MIN_DURATION_SECONDS` | `2` | Shortest accepted clip |
| `MAX_AVATAR_MB` | `4` | Avatar size ceiling |
| `AUTO_APPROVE` | `false` | Present only to document that it does nothing; there is no auto-approval code path |
| `DEV_EXPOSE_RESET_LINK` | `1` in dev | Returns the reset link in the API response so you can test without email |
| `EMAIL_API_KEY` / `EMAIL_FROM` | unset | Enables real password-reset email delivery |
| `EMAIL_API_URL` | Resend endpoint | Override for a different provider |

Upload limits are also served to the browser through `/api/config`, so the form and the server always agree.

### Password reset email

Out of the box the reset link is printed to the server log (and returned in the API response in development). For a public deployment, set:

```bash
EMAIL_API_KEY=re_...
EMAIL_FROM="GoatMedia <no-reply@your-domain.example>"
```

Delivery is a single `POST` to a Resend-compatible `/emails` endpoint using `fetch`, so no SDK is involved and swapping providers means changing `EMAIL_API_URL`. If nothing is configured in production, the server logs a warning instead of silently pretending an email was sent.

## How moderation works

1. A signed-in user submits a video. The file lands in `.data/tmp`, outside anything the web server serves.
2. Server-side validation runs first: MIME type and extension, size, and — when `ffmpeg` is present — duration and codec. Rejections explain exactly what failed.
3. The video is re-encoded (location and other metadata stripped, `moov` moved to the front) into `.data/media`, a poster frame goes to `.data/posters`, and the row is created with status `pending`.
4. A moderator opens `/admin`, watches the clip inline, and approves or rejects it. Rejecting requires a reason the creator sees on their profile.
5. Only `approved` videos are returned by feed, search, profile, trending or media routes. Pending media is served through an authenticated route that allows the owner and the moderator only — there is no public path or predictable file URL to guess.
6. Editing the caption or category of a published video sends it back to `pending`. It disappears from public surfaces until it is re-approved.

Every decision is written to `moderation_events` and shown in the video's history panel. Reports from users land in the same dashboard, and resolving one can remove the video or dismiss the report.

Moderation stays manual regardless of user count. `moderation.mode` in `server/config.ts` is a constant, not a feature flag, and nothing in the upload or moderation path branches on registered-user totals.

## The recommendation system

`server/recommend.ts` is a scoring model, not a black box. Each candidate video gets a score built from:

- **Interest match** — the user's category and hashtag weights, learned from interactions and decayed with a 30-day half-life.
- **Watch quality** — completion ratio and rewatch count, which separate "watched it twice" from "swiped past".
- **Creator affinity** — follows and past completions on that creator's videos.
- **Freshness** — newer approved videos get a modest lift.
- **Recent popularity** — engagement over the last week, not lifetime views.
- **Negative signals** — explicit "not interested" is a hard block; fast swipes and repeated exposure push a video down.

Interaction weights and feed composition are plain numbers at the top of `server/config.ts`:

```ts
interactionWeights = { complete: 5, rewatch: 6, like: 3, comment: 2, follow: 4, skip: -4, notInterested: -15 }
feedMix = { personalized: 0.8, discovery: 0.15, trending: 0.05 }
```

The feed is assembled in that proportion, so roughly one in six videos comes from a creator or category outside the user's usual orbit, and 5% comes from trending. Repeated events are de-duplicated per video and per day so nobody can inflate their own interests by hammering a like button.

Signed-out visitors get trending with freshness weighting; no personalisation is invented for them.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # 60 end-to-end API checks
npm run build       # production client bundle
```

`npm run smoke` starts a server against a throwaway database in a temp directory, never touches `.data`, and covers registration, sign-in, upload validation, pending-video privacy (including guessed media URLs), approval and rejection, feed visibility, likes, comments, follows, watch tracking, not-interested, search, re-review after edits, reports, removals, suspensions, password reset, config leakage and cross-origin protection.

## Production

```bash
npm run build
npm start           # NODE_ENV=production, serves dist/ and the API from one process
```

Put it behind a TLS-terminating reverse proxy and set `APP_ORIGIN` to the public origin — cookies are `SameSite=Lax` and marked `Secure` in production, and state-changing requests are checked against the origin.

Back up `.data/` (database plus private media). SQLite runs in WAL mode; copy the database with `sqlite3 .data/goatmedia.db ".backup backup.db"` or stop the server first.

## Repository layout

```
server/          API, auth, moderation, recommendation, media pipeline
  routes/        auth, videos, social, users, admin
shared/          types and policy text shared by client and server
src/             React app (pages, components, styles)
scripts/         dev runner, seed, moderator CLI, smoke suite
.data/           runtime data, never committed
```

## Known limitations

- **Single node.** SQLite and a local media directory mean one server process. Scale-out needs Postgres and object storage.
- **Email needs configuration.** Reset links only appear in the log until `EMAIL_API_KEY` and `EMAIL_FROM` are set.
- **No automated moderation, ever, by request.** At 1,000 users the queue will need your attention; the code makes no attempt to shortcut it.
- **Uploads need `ffmpeg`.** Without it, uploads are stored as-is and duration limits cannot be enforced, so install it in any real deployment.
- **No direct messages.** Out of scope for this version, as requested.
- **Sample footage is Wikimedia Commons material**, credited in the UI. Replace it with your own clips before showing the site to anyone.
- **Adult supervision, hosting accounts, and privacy/legal review are not code.** The app ships community guidelines, privacy notes and terms, but someone still has to own them before the site is public.
