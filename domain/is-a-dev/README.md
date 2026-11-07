# goatmedia.is-a.dev — request, ready to submit

The record file is written ([goatmedia.json](goatmedia.json)). Submitting it is
the one step that has to come from your own GitHub account, and the reason is
worth reading before you do it.

## Two things stand in the way

**Their repository does not accept agent-written pull requests.** The rules in
[`AGENTS.md`](https://github.com/is-a-dev/register/blob/main/AGENTS.md) say an AI
agent must not open a PR or push a branch for one, and that a human has to write
and submit the file themselves. That is a policy about the repository, not
something to work around, so this folder stops at a ready file.

**Their content rule probably excludes GoatMedia anyway.** The pull request
template has a box that reads:

> My website is **software development** related. We do not accept websites such
> as gaming, courses, AI agents/chatbots, etc.

The terms say subdomains are for "individuals, software developer groups and
non-commercial projects that are related to software development", and reserve
the right to deny any request. GoatMedia is a goat video platform built with
TypeScript; the software is real but the subject is goats, which is the same
shape as the requests they list as examples of what they turn down. An honest
submission would have to leave that box unticked, which fails their validation.

If you still want to try, the steps are below and the file is correct. The cost
of a closed PR is nothing, but the reviewers are volunteering their time, so
sending it with the purpose stated plainly is the least anyone can do.

## If you want to send it

1. Fork [is-a-dev/register](https://github.com/is-a-dev/register/fork).
2. In the fork, add `domains/goatmedia.json` with exactly the contents of
   [goatmedia.json](goatmedia.json). The owner is your username; add an `email`
   or a Discord handle if you would rather be reachable that way, since their
   template asks for real contact information.
3. Open a pull request. Their template needs every box filled in, a link to the
   site as it is today (`https://toastedbread02.github.io/GoatMedia/`), and a
   sentence on what the site is. Write that part yourself — say it is a
   community video site for goats, because that is what a reviewer will see when
   they click the link.
4. Watch the PR. Requests for changes are common and a silent PR gets closed.

## After it is merged

Nothing in this repository needs editing. The switch is one command:

```bash
gh variable set CUSTOM_DOMAIN --body "goatmedia.is-a.dev"
```

The next push to `main` then:

- builds with `VITE_BASE_PATH=/`, because the site now serves from the domain
  root instead of `/GoatMedia/`
- sets the Pages custom domain from that variable, so **Settings → Pages** needs
  no manual edit
- keeps the API working, because `https://goatmedia.is-a.dev` is already listed
  in `ALLOWED_ORIGINS` in `wrangler.jsonc`

DNS publishes within minutes of the merge, then GitHub issues the certificate.
Tick **Enforce HTTPS** in **Settings → Pages** once the certificate is ready.
Until then, `https://toastedbread02.github.io/GoatMedia/` keeps working.

If GitHub asks you to verify the domain, it gives you a `TXT` value for
`_github-pages-challenge-toastedbread02.goatmedia.is-a.dev`. That needs a second
file, `domains/_github-pages-challenge-toastedbread02.goatmedia.json`:

```json
{
  "owner": { "username": "toastedbread02" },
  "records": {
    "TXT": ["_github-pages-challenge-toastedbread02=<value GitHub showed you>"]
  }
}
```

## Free alternatives without the subject rule

All of these need an account, none of them care that the site is about goats, and
each one slots into the same one-command switch above by changing the name in
`CUSTOM_DOMAIN` and adding the new origin to `ALLOWED_ORIGINS`.

- **FreeDNS** ([freedns.afraid.org](https://freedns.afraid.org)) — free subdomains
  on shared domains such as `us.to` or `mooo.com`, activated immediately, and
  supports a `CNAME` to `toastedbread02.github.io`. Gives you something like
  `goatmedia.us.to`.
- **DuckDNS** ([duckdns.org](https://www.duckdns.org)) — sign in with GitHub, pick
  the name, get `goatmedia.duckdns.org`. It only does `A`/`TXT` records rather
  than `CNAME`, so point the four GitHub Pages addresses
  (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) at
  it instead.
- **eu.org** — free and permanent, no content rule, but approval is measured in
  weeks, so it is a slowly maturing option rather than a fix for today.
- A `.xyz` registration is around a dollar for the first year at cost from
  Cloudflare Registrar, which is the only way to get `goatmedia.<tld>` itself.
