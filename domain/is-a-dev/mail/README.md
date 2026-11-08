# Authenticating goatmedia.is-a.dev as a Mailjet sending domain

Mail notices currently go out From a verified Gmail address. They are accepted
and delivered, but Gmail's own DMARC record does not vouch for Mailjet's servers,
so From: `you@gmail.com` through Mailjet is unauthenticated mail, and Gmail
treats unauthenticated mail as a spam candidate.

The fix is DKIM under a domain we control. That domain does not exist yet.

## The current state

```bash
curl -sI https://goatmedia.is-a.dev/ | grep -i location
# location: https://is-a.dev/available?d=goatmedia
```

That redirect is is-a.dev's wildcard answering for an **unclaimed** name. There
are no records to add, and Mailjet cannot verify a domain whose DNS we do not
control — it will sit at "not validated" forever. So this folder is step two of
a two-step job, and step one is the registration PR in the parent directory:
[../README.md](../README.md). Nothing here can be finished before that merge.

There is no need to pay for two review cycles, though: Mailjet hands out both
values as soon as the domain is *added* in the dashboard, before any DNS exists.
Generate the two files first and put them in the same pull request as
`goatmedia.json`, so one merge registers the name and authenticates mail.

## Why there is no SPF file

`goatmedia.is-a.dev` is registered as a `CNAME` to `toastedbread02.github.io`
([../goatmedia.json](../goatmedia.json)), and DNS forbids any other record type
beside a CNAME. An apex SPF TXT record is therefore impossible on this domain.

That is survivable, because DKIM is what carries alignment: Mailjet sends with
its own envelope (bounce) domain by default, so SPF results are checked against
Mailjet's domain, not ours, while the DKIM signature is `d=goatmedia.is-a.dev`
and matches the From header exactly. DMARC passes on DKIM alone.

## The two records

Mailjet shows both under **Senders & Domains → goatmedia.is-a.dev → ⚙️ → Setup
SPF/DKIM Authentication**. Ignore the SPF line for the reason above.

| Purpose | TXT name | Value |
| --- | --- | --- |
| ownership, proves the domain is yours | `mailjet._<token>` | the ownership token |
| DKIM signing key | `mailjet._domainkey` | `k=rsa; p=MIIBIjAN...` |

Both are public values — a verification token and a *public* key — so they are
safe to paste into a pull request, this chat, or a commit. The private half never
leaves Mailjet.

is-a.dev takes one file per name, with the `is-a.dev` part stripped from the
filename, so these become `domains/mailjet._<token>.goatmedia.json` and
`domains/mailjet._domainkey.goatmedia.json`.

## Steps

1. **Add the domain in Mailjet** (it accepts the domain before DNS exists) and
   copy the two values it shows. Do not create the SPF record.
2. **Write the files.** The DKIM key is long enough that typing JSON by hand is
   how this goes wrong, so the generator writes it:

   ```bash
   node scripts/mail-domain.mjs --dkim "k=rsa; p=MIIBIjAN..."
   node scripts/mail-domain.mjs --token "<token value>" --token-name "mailjet._a1b2c3d4"
   ```

   Output lands in this folder. Each file is a complete, valid is-a.dev record.
3. **Open the PR** against [is-a-dev/register](https://github.com/is-a-dev/register)
   from your own account, adding both files to `domains/` — alongside
   `goatmedia.json` if the domain request has not been sent yet. Same rules as
   the parent request: a human submits it, the site link is the GitHub Pages
   address, and the description says what the site is. Reviewers have merged mail
   records before — their own guides cover Zoho Mail and ImprovMX — so the
   request is ordinary; it is the content rule in [../README.md](../README.md)
   that may still sink it.
4. **Wait for the merge, then prove the records are live.** This queries public
   DNS directly, so it works on Windows without `dig`:

   ```bash
   node scripts/mail-domain.mjs --verify
   ```

   It prints both names, whether each value is published, and whether the apex is
   a CNAME. Exit code 0 means everything Mailjet asked for is in place. Allow up
   to an hour after the merge; is-a.dev publishes quickly but caches are not
   instant.
5. **Confirm in Mailjet.** SPF will stay red or absent, which is expected. DKIM
   must go green. Mailjet's own check can lag behind DNS by a few minutes.
6. **Switch the sender**, and only now:

   ```bash
   npx wrangler secret put MAIL_FROM        # notices@goatmedia.is-a.dev
   npx wrangler secret put MAIL_FROM_NAME   # GoatMedia
   ```

   A secret takes effect immediately; no redeploy. Any address at an
   authenticated domain works without a second verification step.

## Do not switch the sender early

`is-a.dev` publishes `v=DMARC1; p=reject` and sets no `sp` tag, so subdomains
inherit **p=reject**. Mail that claims to be From `@goatmedia.is-a.dev` but
carries no aligned DKIM signature is not merely filed as spam — receiving servers
are told to reject it.

That means the order above is not a preference. Setting `MAIL_FROM` before step
4 passes turns "lands in spam sometimes" into "silently disappears", and the
`emails` table will still say `sent`, because Mailjet accepted it and the
rejection happens downstream.

## Checking it worked

Send one warning from the control center to a throwaway account with a mailbox
you can open, then:

```bash
npx wrangler d1 execute goatmedia --remote --command \
  "SELECT kind, to_email, status, error, created_at FROM emails ORDER BY created_at DESC LIMIT 5"
```

`sent` means Mailjet accepted the message. Whether it landed in the inbox is
only visible in that mailbox — check the message's "signed by" or
`Authentication-Results` header for `dkim=pass header.d=goatmedia.is-a.dev`. That
header is the actual proof, and no amount of dashboard green ticks replaces it.

## If is-a.dev says no

The requirement is narrow and worth stating precisely: somewhere you can publish
a TXT record at `mailjet._domainkey.<domain>` — a *nested* name, not the apex.
That rules out most free dynamic-DNS services, DuckDNS included, which only let
you set TXT on the name itself.

Services that host DNS for you can do it: is-a.dev does (it already holds files
like `domains/zmail._domainkey.fred-blaise.json`), and so does the free `eu.org`
registration, which gives full zone control but takes weeks to approve.

Services that only let you set a TXT on the name itself cannot, however generous
they look. FreeDNS at [afraid.org](https://freedns.afraid.org) answers
`Creation of records beginning with '_' are presently restricted to the domain
owner only` on its shared domains, which rules out both the DKIM name and the
Mailjet ownership name. Any provider that asks you to pick from existing records
rather than create a name of your choosing will fail for the same reason.

A domain you own — even a cheap one — avoids the question entirely, and is the
only version of this that also fixes the bounce on replies.

## Known limitation

`goatmedia.is-a.dev` has no MX record, so a recipient who *replies* to a
suspension notice bounces. The appeal button in the mail is the intended route
and does not need a mailbox; if replies matter, either add an MX record for the
subdomain or point a Reply-To at an inbox you actually read.
