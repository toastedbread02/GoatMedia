// Writes the is-a.dev record files that authenticate goatmedia.is-a.dev as a
// Mailjet sending domain, and checks whether they are live.
//
//   node scripts/mail-domain.mjs --dkim "k=rsa; p=MIIBIjAN..."
//   node scripts/mail-domain.mjs --token "abc123..." --token-name mailjet._abc123
//   node scripts/mail-domain.mjs --verify
//
// The values come from Mailjet: Senders & Domains -> goatmedia.is-a.dev -> the
// gear icon -> Setup SPF/DKIM Authentication. The DKIM key is a public key, so
// it is not a secret; the private half never leaves Mailjet.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
}
function has(name) {
  return args.includes(`--${name}`);
}

const domain = flag('domain') || 'goatmedia.is-a.dev';
const outDir = flag('out') || join('domain', 'is-a-dev', 'mail');

// goatmedia.is-a.dev -> goatmedia. The is-a.dev schema names the file after the
// part before .is-a.dev, and nested names use dots, so every record below
// becomes its own file.
const label = domain.replace(/\.is-a\.dev$/, '');
if (label === domain) {
  console.error(`Expected a *.is-a.dev domain, got ${domain}`);
  process.exit(1);
}

// is-a.dev names the file after the label only, but DNS needs the whole name,
// so keep both: `file` for the JSON path, `dns` for the lookup.
const dkimName = { file: `mailjet._domainkey.${label}`, dns: `mailjet._domainkey.${domain}` };
const dkim = flag('dkim');
const token = flag('token');
const tokenName = flag('token-name');

function usage() {
  console.log(`Mailjet domain authentication for ${domain}

Add the domain in Mailjet first (Senders & Domains -> Add domain). It shows two
TXT records, and both belong in is-a.dev as their own file:

  1. ownership:  ${tokenName || 'mailjet._<token>'}   value: the ownership token
  2. DKIM:       ${dkimName.dns}   value: k=rsa; p=...

Then:

  node scripts/mail-domain.mjs --dkim "<DKIM value>"
  node scripts/mail-domain.mjs --token "<token>" --token-name "<name Mailjet showed>"
  node scripts/mail-domain.mjs --verify

There is no SPF file. The apex of ${domain} is a CNAME to GitHub Pages, and DNS
forbids a TXT record beside a CNAME, so SPF can only be skipped here. DKIM is
what carries DMARC alignment for Mailjet anyway.
`);
}

async function readTxt(name) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DNS lookup failed with HTTP ${res.status}`);
  const body = await res.json();
  const answers = (body.Answer || []).filter((a) => a.type === 16);
  // Values arrive quoted, and long keys are split into several strings that
  // must be glued back together with no separator.
  return answers.map((a) =>
    (a.data.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1)).join(''),
  );
}

function recordFile(records) {
  return `${JSON.stringify(
    { owner: { username: 'toastedbread02' }, records: { TXT: records } },
    null,
    2,
  )}\n`;
}

async function writeRecord(name, value) {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${name.file}.json`);
  await writeFile(path, recordFile([value]), 'utf8');
  console.log(`wrote ${path}`);
}

if (dkim) {
  if (typeof dkim !== 'string' || !dkim.includes('p=')) {
    console.error('The DKIM value should look like "k=rsa; p=MIIBIjAN...". Copy it whole.');
    process.exit(1);
  }
  await writeRecord(dkimName, dkim);
}

// Mailjet shows the ownership name fully qualified, sometimes with a trailing
// dot; is-a.dev wants the label on its own.
function trimDomain(name) {
  return String(name)
    .replace(/\.$/, '')
    .replace(new RegExp(`\\.?${domain.replace(/\./g, '\\.')}$`), '');
}

if (token) {
  if (!tokenName || tokenName === true) {
    console.error('Pass --token-name exactly as Mailjet shows it, e.g. mailjet._a1b2c3d4');
    process.exit(1);
  }
  const short = trimDomain(tokenName);
  await writeRecord({ file: short, dns: `${short}.${domain}` }, token);
}

if (has('verify')) {
  const checks = [{ name: dkimName.dns, want: dkim }];
  if (tokenName && tokenName !== true) {
    const short = trimDomain(tokenName);
    checks.push({ name: `${short}.${domain}`, want: token });
  }
  let missing = 0;
  for (const check of checks) {
    const values = await readTxt(check.name);
    if (values.length === 0) {
      console.log(`${check.name}\n  not published yet`);
      missing += 1;
      continue;
    }
    const hit = check.want && typeof check.want === 'string' ? values.includes(check.want) : true;
    console.log(`${check.name}\n  ${hit ? 'published' : 'published, but not the value given'}: ${values[0].slice(0, 48)}${values[0].length > 48 ? '...' : ''}`);
    if (!hit) missing += 1;
  }
  const apex = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=CNAME`,
    { headers: { accept: 'application/dns-json' } },
  )
    .then((r) => r.json())
    .catch(() => ({}));
  if ((apex.Answer || []).some((a) => a.type === 5)) {
    console.log(`${domain} is a CNAME, so no apex SPF is possible. DKIM alone is expected.`);
  }
  process.exit(missing === 0 ? 0 : 1);
}

if (!dkim && !token) usage();
