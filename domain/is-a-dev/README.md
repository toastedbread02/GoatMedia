# goatmedia.is-a.dev — the pull request to send

Everything that can be written is written. Submitting it has to come from your own
GitHub account: is-a.dev's [`AGENTS.md`](https://github.com/is-a-dev/register/blob/main/AGENTS.md)
says an AI agent must not open the PR or push the branch for one, so this folder
stops at ready files.

Two of them can go in one request: the domain, and the mail records that let the
Worker send its own notices.

| File | Adds | Needed now? |
| --- | --- | --- |
| [goatmedia.json](goatmedia.json) | the domain, `CNAME` to GitHub Pages | yes |
| `mailjet._domainkey.goatmedia.json` | DKIM key, generated in step 1 | yes, if you have the value |
| `mailjet._<token>.goatmedia.json` | Mailjet ownership token, generated in step 1 | same |

The nested mail names are allowed — their own repository already holds files like
`domains/zmail._domainkey.fred-blaise.json` and `domains/_vercel.example.json`.
The "no underscore in the root label" rule is about `_something.is-a.dev`, not
about a label further down.

## 1. Put your email in the domain file

Open [goatmedia.json](goatmedia.json) and replace `REPLACE_WITH_YOUR_EMAIL` with
an address you actually read. Their template requires real contact information,
and an email that bounces is a reason to close the request. If you would rather
not publish an address, delete the `email` line and add
`"discord": "<your Discord user id>"` instead.

## 2. Generate the mail files (skip only if you want to send the domain alone)

In the Mailjet dashboard, **Senders & Domains → Add domain**, enter
`goatmedia.is-a.dev`. It accepts a domain before any DNS exists, and shows two
values straight away:

- an ownership token, plus the name it belongs at (`mailjet._a1b2c3d4` and similar)
- a DKIM key starting `k=rsa; p=MIIBIjAN...`

Both are public values — a verification token and a public key — so they are safe
to paste into a pull request. Generate the two files:

```bash
node scripts/mail-domain.mjs --dkim "k=rsa; p=MIIBIjAN..."
node scripts/mail-domain.mjs --token "<token>" --token-name "mailjet._a1b2c3d4"
```

They land in [mail/](mail). Nothing else in this repository needs editing.

If you would rather not wait on the Mailjet dashboard, send `goatmedia.json` by
itself now and open a second, tiny request for the mail records later. It costs a
second review, and the domain is the part that unblocks the site.

## 3. Open the pull request

1. Fork [is-a-dev/register](https://github.com/is-a-dev/register/fork).
2. In your fork, add the files to `domains/` — the JSON files themselves, not the
   folders they sit in. `goatmedia.json` must be at `domains/goatmedia.json`.
3. Open the pull request against `is-a-dev/register:main`.
4. Paste [pull-request.md](pull-request.md) as the description, whole, comments
   included. Their CI parses the checkbox markers and the two `WEBSITE_*`
   sections; a body with those removed fails validation.
5. Title it something plain, e.g. `Add goatmedia.is-a.dev`.

Watch the PR for a day or two. Requests for changes are normal and a silent PR
eventually gets closed.

### The one checkbox worth thinking about

`SOFTWARE_RELATED` is ticked because the thing you are submitting is a from-scratch
TypeScript application and the repository is public. The purpose text says plainly
that the subject is goats and that closing on those grounds is fair, so a reviewer
sees the whole picture rather than a checkbox. Do not add arguments to that text to
make it sound like a developer tool; it is not one.

## 4. Once it is merged

Nothing in this repository needs editing — one variable moves the site.

```bash
gh variable set CUSTOM_DOMAIN --body "goatmedia.is-a.dev"
git commit --allow-empty -m "Point Pages at the custom domain" && git push
```

That build sets `VITE_BASE_PATH=/` (a custom domain serves from the root, not from
`/GoatMedia/`), sets the Pages custom domain, and keeps the API working because
`https://goatmedia.is-a.dev` is already in `ALLOWED_ORIGINS` in `wrangler.jsonc`.

DNS usually publishes within minutes of the merge. Then:

1. **Settings → Pages** — wait for the certificate to finish issuing, then tick
   **Enforce HTTPS**. Until it does, the `github.io` address keeps working.
2. If GitHub asks you to verify the domain, it shows a `TXT` value for
   `_github-pages-challenge-toastedbread02.goatmedia.is-a.dev`. That needs a small
   follow-up file, `domains/_github-pages-challenge-toastedbread02.goatmedia.json`:

   ```json
   {
     "owner": { "username": "toastedbread02", "email": "you@example.com" },
     "records": { "TXT": ["_github-pages-challenge-toastedbread02=<value GitHub showed>"] }
   }
   ```

3. Confirm the site answers on the new name before telling anyone about it:

   ```bash
   curl -sI https://goatmedia.is-a.dev/ | head -3
   ```

   A redirect to `https://is-a.dev/available?d=goatmedia` means the name is still
   unclaimed and the PR has not been merged.

## 5. Then, and only then, switch the sender

```bash
node scripts/mail-domain.mjs --verify        # both TXT names must be published
npx wrangler secret put MAIL_FROM            # notices@goatmedia.is-a.dev
npx wrangler secret put MAIL_FROM_NAME       # GoatMedia
```

The order matters. `is-a.dev` publishes `v=DMARC1; p=reject` and sets no `sp`
tag, so subdomains inherit it: mail claiming to be from `@goatmedia.is-a.dev`
with no aligned DKIM signature is rejected outright, not filed as spam. Sending
before the DKIM record is live turns "sometimes lands in spam" into "silently
disappears", and the `emails` table still says `sent` because Mailjet accepted it.

There is no SPF record on this domain, and there cannot be one: the apex is a
`CNAME` to GitHub Pages, and DNS forbids any other record beside a CNAME. DKIM
alone satisfies DMARC, so the missing SPF is expected rather than broken.

Full mail detail, including how to read the `Authentication-Results` header that
actually proves this worked: [mail/README.md](mail/README.md).

## If it is closed

The narrow requirement is a TXT record at `mailjet._domainkey.<something you
control>`. Free services that only let you set a TXT on the name itself cannot do
it; FreeDNS in particular blocks every label starting with `_`, which is why that
attempt failed. A domain you own — even a cheap one — ends the problem permanently
and lets the site answer on its own name at the same time.
