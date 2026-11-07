# goatmedia.js.org — request package

Everything needed to open the js.org pull request, plus an honest note about the
rule this request runs into.

Both candidate names are currently unclaimed (checked with DNS and against
`cnames_active.js` on 7 November 2026):

- `goatmedia.js.org` — matches this repository's name, which is what js.org asks
  for when you are not requesting your username
- `toastedbread02.js.org` — your username, also allowed

---

## Read this first

js.org is not a general free-domain service. Their
[content requirements](https://github.com/js-org/js.org#content-requirements) say:

> **Websites must be *directly* related to the JavaScript ecosystem/community
> (such as NPM packages / JS tools, not personal pages / portfolios)**
> Websites that merely use JavaScript, without otherwise being related to the
> ecosystem, are not eligible.

And their pull request template is blunt about it:

> Using JavaScript on your website is not justification by itself for requesting a
> subdomain from JS.ORG

GoatMedia is a goat video platform. It is written in TypeScript and React and
runs on a Cloudflare Worker, but its *content* is goats, not the JavaScript
ecosystem. Under that rule this request is likely to be closed, and no amount of
wording should try to disguise that. The package below is written truthfully so
a maintainer can judge it, not so a rejection can be argued around.

Three honest ways forward:

1. **Send it anyway and let them decide.** Costs nothing but a closed PR. The
   files are ready.
2. **Become eligible.** Publish something reusable from this project — the
   chunked-upload client, the interest-scoring engine, the D1 media range
   reader — as an open-source package with docs. A JS tool qualifies; a goat
   video site does not. `goatmedia.js.org` could then reasonably point at that
   project page.
3. **Use a service without a subject rule.** `is-a.dev` gives free subdomains to
   developers and projects with no requirement that the site be about
   JavaScript; the steps in [DEPLOY.md](../../DEPLOY.md) cover it. Or register a
   real `.org`, roughly $10–13/year at cost from Cloudflare Registrar.

---

## Step 1 — already done for you

This repository is published with the Pages **workflow**, not a branch. js.org
says a `CNAME` file is *not processed* in that case, so the custom domain has to
be set in the repository settings instead. Nothing needs to change in the build.

## Step 2 — add the line to `cnames_active.js`

Fork [js-org/js.org](https://github.com/js-org/js.org), then add one line to
`cnames_active.js`. It is alphabetical, and `goatmedia` sorts after `go` and
before `god`, so it goes here:

```js
  "go": "northwoodssoftware.github.io/go.js.org",
  "goatmedia": "toastedbread02.github.io/GoatMedia",
  "god": "godow.github.io",
```

The line itself is in [cnames-line.txt](cnames-line.txt). Notes that matter:

- Two-space indent, double quotes, a space after the colon, trailing comma.
- The value is the host *and* the project path, because this is a project site:
  `toastedbread02.github.io/GoatMedia`, not `toastedbread02.github.io`.
- Do not add `// noCF` — that is only for existing entries opting out.

Change nothing else in the repository. The template asks for exactly one new
line.

## Step 3 — open the pull request

Title: `Add goatmedia.js.org`

Body: copy [pull-request.md](pull-request.md). Both checkboxes need an `x`, and
the last line has to be filled in truthfully — the template will not be reviewed
if it is left as a placeholder.

Watch the PR for a naming conflict or a request for changes.

## Step 4 — after it is merged

1. **Settings → Pages → Custom domain**: enter `goatmedia.js.org` and save. This
   is the step that actually authorises you as the owner, and a `CNAME` file in
   the build will not do it for a workflow deployment.
2. Tick **Enforce HTTPS** once GitHub has issued the certificate.
3. Set the repository variable so the build stops using the `/GoatMedia/` path:

   ```bash
   gh variable set CUSTOM_DOMAIN --body "goatmedia.js.org"
   ```

4. Add the new origin to `ALLOWED_ORIGINS` in `wrangler.jsonc` and redeploy, or
   the API will refuse the browser:

   ```bash
   npx wrangler deploy
   ```

5. Push to `main`. The site rebuilds at `/`, and the old
   `toastedbread02.github.io/GoatMedia/` address keeps working meanwhile.

js.org says the name goes live within 24 hours of the merge.
