# Deploying GoatMedia

GoatMedia is a website plus a server: the feed, sign-in, uploads, video processing, moderation and the recommendation model all run in the Node process. GitHub Pages can only serve files, so the server has to live somewhere with a disk.

There are two ways to put this online. Read both before you start; the first is the one I'd use.

---

## Option A — one server serves everything (recommended)

The server already serves the built site (`npm start` serves `dist/` and the API), so you point a domain at it and get the website and the API on the same origin. Sign-in works in every browser, there is no CORS to configure, and there is only one thing to deploy.

The website then lives at `https://your-domain.example`, not on `github.io`. GitHub keeps the code and, if you like, runs the tests.

## Option B — website on GitHub Pages, API on the server

This is the split you asked for: the Pages site is the front end, and it calls the server at a second URL.

It works, and the code supports it (`VITE_API_ORIGIN`, `API_ORIGIN`, `ALLOWED_ORIGINS`, `CROSS_SITE_COOKIES`). The catch is cookies: a site on `github.io` talking to a server on another domain makes the session cookie a third-party cookie. Chrome and Firefox currently accept it with `SameSite=None; Secure`, **Safari blocks it by default**, which means sign-in silently fails for iPhone and iPad visitors. That is why Option A is the recommendation.

If you still want the split, the sections below cover it.

---

## The free server

There is no free PaaS tier that can host this app. Checked against current pricing pages:

| Service | Why it does not work |
| --- | --- |
| Render Free | Free services have **no persistent disk**; SQLite and every uploaded video are wiped on each deploy, restart or spin-down. Also sleeps after 15 minutes. |
| Koyeb Free | Volumes cannot attach to the free instance, and it scales to zero after an hour. |
| Railway Free | $1 credit per month cannot hold an always-on service; ~125 MB upload ceiling. |
| Fly.io | No free tier any more (trial credit only). |
| Vercel / Netlify / Cloudflare | Serverless: no persistent filesystem, no ffmpeg for the upload pipeline. |
| Hugging Face Spaces | Docker/Gradio Spaces now require a paid plan; disk is not persistent. |
| AWS new accounts | Credit-based for 6 months, then the account closes. |

**Use Oracle Cloud Always Free.** As of late 2026 it gives you a real VM, free forever:

- **2 OCPU / 12 GB RAM** (Ampere A1, arm64) — the allowance was cut from 4/24 in mid-2026, so plan for 2/12.
- **200 GB** of block/boot storage in your home region — plenty for video.
- **10 TB/month** outbound transfer.
- Root access, so `apt install ffmpeg` and Node both just work.
- Requires a **credit card or credit-style debit card** for identity verification (not charged unless you upgrade) and a phone number.

Two honest caveats:

1. **Idle reclamation.** Oracle may reclaim an Always Free instance it considers idle over a rolling 7 days: CPU p95 below 20%, network below 20%, and memory below 20% (memory applies to A1). A quiet site can trip this. Keep backups, and if the instance disappears, rebuild from the snapshot and the repository.
2. **Capacity.** A1 instances in popular regions sometimes report "out of capacity"; try another availability domain or retry later.

**Fallback:** Google Cloud's always-free e2-micro (us-west1 / us-central1 / us-east1, 30 GB `pd-standard`). Always on, but the free tier includes only **1 GB/month of egress**, so serving video will cost money almost immediately. Oracle's 10 TB is why it wins for a video site.

---

## Step by step (Oracle Cloud Always Free)

### 1. Create the instance

1. Sign up at <https://www.oracle.com/cloud/free/> and pick a home region close to your viewers.
2. Compute → Instances → Create instance.
3. Image: **Ubuntu 24.04**. Shape: **VM.Standard.A1.Flex**, 2 OCPUs, 12 GB memory (stay at or under this — above it is billable).
4. Boot volume: 100 GB is fine (the free allowance is 200 GB total).
5. Add your SSH public key, create, and note the public IP.
6. Networking → the instance's subnet → Security list → add ingress rules for **TCP 80** and **TCP 443** from `0.0.0.0/0`. (Oracle's firewall blocks these by default; without this the site is unreachable even though it is running.)

Then point a DNS `A` record for your domain at that IP.

### 2. Install the runtime

```bash
ssh ubuntu@YOUR_SERVER_IP

sudo apt update
sudo apt install -y ffmpeg caddy git curl
# Node 24 (arm64 builds are official)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v24.x
ffmpeg -version | head -1
```

### 3. Put the code on the server

```bash
sudo useradd --system --create-home --home-dir /opt/goatmedia --shell /bin/bash goatmedia
sudo -u goatmedia git clone https://github.com/toastedbread02/GoatMedia.git /opt/goatmedia/app
cd /opt/goatmedia/app
sudo -u goatmedia npm ci
sudo -u goatmedia npm run build
```

`npm ci` and `npm run build` need the same user that will run the app, so the files are readable by the service.

### 4. Configure it

```bash
sudo -u goatmedia cp .env.example /opt/goatmedia/app/.env
sudo -u goatmedia nano /opt/goatmedia/app/.env
```

Set at least:

```bash
APP_ORIGIN=https://your-domain.example
PORT=3001
DATA_DIR=.data
```

Leave `API_ORIGIN`, `ALLOWED_ORIGINS` and `CROSS_SITE_COOKIES` unset for Option A.

Create the moderator account and, if you want sample content, the seed:

```bash
cd /opt/goatmedia/app
sudo -u goatmedia npm run admin:create -- --email you@example.com --username keeper
# prints a generated password once — save it now
```

### 5. Run it as a service

```bash
sudo tee /etc/systemd/system/goatmedia.service > /dev/null <<'EOF'
[Unit]
Description=GoatMedia
After=network.target

[Service]
Type=simple
User=goatmedia

WorkingDirectory=/opt/goatmedia/app
EnvironmentFile=/opt/goatmedia/app/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --import tsx server/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now goatmedia
sudo systemctl status goatmedia --no-pager
curl -s localhost:3001/api/health
```

### 6. HTTPS

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
your-domain.example {
	encode zstd gzip

	# Uploads are allowed up to 200 MB by the app; leave headroom for multipart.
	request_body {
		max_size 250MB
	}

	reverse_proxy 127.0.0.1:3001
}
EOF

sudo systemctl reload caddy
```

Caddy fetches a Let's Encrypt certificate automatically once DNS points at the server. Visit `https://your-domain.example`, sign in, and open `/admin`.

Because the app is now served over HTTPS, session cookies are `Secure` automatically (`APP_ORIGIN` starts with `https:`).

### 7. Backups

Everything that matters is in `/opt/goatmedia/app/.data` — the SQLite database plus every private upload, poster and avatar.

```bash
cd /opt/goatmedia/app
sudo -u goatmedia mkdir -p /opt/goatmedia/backups
sudo -u goatmedia sqlite3 .data/goatmedia.db ".backup /opt/goatmedia/backups/db-$(date +%F).db"
sudo -u goatmedia tar czf /opt/goatmedia/backups/media-$(date +%F).tar.gz .data/media .data/posters .data/avatars
```

Copy those off the machine (Oracle Object Storage free tier, or anywhere else). A backup that only lives on the instance is not a backup.

### Updating

```bash
cd /opt/goatmedia/app
sudo -u goatmedia git pull
sudo -u goatmedia npm ci
sudo -u goatmedia npm run build
sudo systemctl restart goatmedia
```

---

## Option B in detail (GitHub Pages + server)

The repo includes [.github/workflows/pages.yml](.github/workflows/pages.yml), which builds the site and publishes it to Pages.

1. **Server env** — the API must know the Pages origin and issue cross-site cookies:

   ```bash
   APP_ORIGIN=https://YOURNAME.github.io
   API_ORIGIN=https://goatmedia.example.com
   ALLOWED_ORIGINS=https://YOURNAME.github.io
   CROSS_SITE_COOKIES=1
   ```

   `API_ORIGIN` makes every poster, video and avatar URL absolute so the Pages site can load them. `ALLOWED_ORIGINS` opens credentialed CORS to exactly that origin and nothing else. `CROSS_SITE_COOKIES=1` switches the session cookie to `SameSite=None; Secure`, which **requires HTTPS** on the API.

2. **Repository variable** — Settings → Secrets and variables → Actions → Variables → New variable: `API_ORIGIN` = `https://goatmedia.example.com`. Until it is set, the Pages workflow skips publishing rather than shipping a site with no backend.

3. **Enable Pages** — Settings → Pages → Build and deployment → Source: **GitHub Actions**.

4. Push to `main`. The site lands at `https://YOURNAME.github.io/GoatMedia/`.

Cross-origin behaviour this relies on is already implemented and tested: credentialed CORS with a strict origin allowlist, `OPTIONS` preflight, absolute media URLs, and the API base baked into the build via `VITE_API_ORIGIN`. What cannot be tested from a laptop is third-party cookie behaviour in Safari — see the caveat at the top.

---

## What was verified, and what wasn't

Verified locally:

- `npm run typecheck`, `npm run smoke` (60 checks), `npm run build`.
- `npm start` serving the built site and the API from one process.
- A split setup: site on one local origin, API on another, with credentialed CORS, preflight rejected from unknown origins, an absolute media URL in the feed JSON, a successful sign-in through the real UI, and video playback streamed from the API origin.

Not verified, because it needs accounts and hardware I do not have:

- Creating an Oracle tenancy, the A1 capacity availability in your region, and Oracle's actual idle-reclamation behaviour.
- A real GitHub Pages deployment and Safari's third-party cookie policy.
- Caddy's certificate issuance for your domain.
