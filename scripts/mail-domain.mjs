// Writes the is-a.dev record files that authenticate a domain as a Mailjet
// sending domain, prints the same records for any other DNS host, and checks
// whether they are live.
//
//   node scripts/mail-domain.mjs --domain example.com --print \
//     --dkim "k=rsa; p=MIIBIjAN..." --token "abc123" --token-name "mailjet._abc123"
//
//   node scripts/mail-domain.mjs --domain example.com --verify
//
// The values come from Mailjet: Senders & Domains -> the domain -> the gear
// icon -> Setup SPF/DKIM Authentication. The DKIM key is a public key, so it is
// not a secret; the private half never leaves Mailjet.
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
const dkim = typeof flag('dkim') === 'string' ? flag('dkim') : null;
const token = typeof flag('token') === 'string' ? flag('token') : null;
const tokenNameRaw = typeof flag('token-name') === 'string' ? flag('token-name') : null;

// is-a.dev takes one JSON file per record name, and the name is the label on its
// own. Every other host wants name + type + value pasted into a panel, so the
// file mode only applies to is-a.dev and --print covers the rest.
const isADev = domain.endsWith('.is-a.dev');
const label = isADev ? domain.slice(0, -'.is-a.dev'.length) : null;

const dkimDns = `mailjet._domainkey.${domain}`;

/** Mailjet shows the ownership name fully qualified, sometimes with a dot. */
function trimDomain(name) {
  return String(name)
    .replace(/\.$/, '')
    .replace(new RegExp(`\\.?${domain.replace(/\./g, '\\.')}$`), '');
}

const tokenName = tokenNameRaw ? trimDomain(tokenNameRaw) : null;
const tokenDns = tokenName ? `${tokenName}.${domain}` : null;

function usage() {
  console.log(`Mailjet domain authentication for ${domain}

Add the domain in Mailjet first (Senders & Domains -> Add domain). It shows two
TXT records:

  1. ownership:  ${tokenName || 'mailjet._<token>'}
  2. DKIM:       ${dkimDns}
                 value: k=rsa; p=...

Then either write is-a.dev files:

  node scripts/mail-domain.mjs --dkim "<DKIM value>"
  node scripts/mail-domain.mjs --token "<token>" --token-name "<name Mailjet showed>"

or print the records for any other DNS host:

  node scripts/mail-domain.mjs --domain ${domain} --print \\
    --dkim "<DKIM value>" --token "<token>" --token-name "<name Mailjet showed>"

and check propagation afterwards:

  node scripts/mail-domain.mjs --domain ${domain} --verify
`);
}

function joinTxt(data) {
  // Values arrive quoted, and long keys are split into several strings that must
  // be glued back together with no separator.
  return (data.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1)).join('');
}

/**
 * Two resolvers, not one. A record added a minute ago can still be answered as
 * "no such name" from a negative cache, and believing that single answer sends
 * you hunting for a mistake that was never made.
 */
async function readTxt(name) {
  const urls = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
  ];
  const seen = new Map();
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
      if (!res.ok) continue;
      const body = await res.json();
      for (const answer of (body.Answer || []).filter((a) => a.type === 16)) {
        const value = joinTxt(answer.data);
        seen.set(value, (seen.get(value) ?? 0) + 1);
      }
    } catch {
      /* one resolver being unreachable is not a verdict */
    }
  }
  return [...seen.keys()];
}

function recordFile(records) {
  return `${JSON.stringify(
    { owner: { username: 'toastedbread02' }, records: { TXT: records } },
    null,
    2,
  )}\n`;
}

async function writeRecord(name, value) {
  if (!isADev) {
    console.error(`${domain} is not an is-a.dev domain, so there is no file to write. Use --print.`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${name}.json`);
  await writeFile(path, recordFile([value]), 'utf8');
  console.log(`wrote ${path}`);
}

if (has('print')) {
  const rows = [];
  if (token) rows.push({ purpose: 'Mailjet ownership check', name: tokenDns ?? 'mailjet._<token>.domain', type: 'TXT', value: token });
  if (dkim) rows.push({ purpose: 'DKIM signing key', name: dkimDns, type: 'TXT', value: dkim });
  // Only meaningful when the apex is not already a CNAME; the verify pass says
  // which case this is. DKIM alone satisfies DMARC either way.
  rows.push({
    purpose: 'SPF (optional, and impossible if the apex is a CNAME)',
    name: domain,
    type: 'TXT',
    value: 'v=spf1 include:spf.mailjet.com ~all',
  });
  for (const row of rows) {
    console.log(`\n${row.purpose}\n  name:  ${row.name}\n  type:  ${row.type}\n  value: ${row.value}`);
  }
  console.log('');
}

if (dkim) {
  if (!dkim.includes('p=')) {
    console.error('The DKIM value should look like "k=rsa; p=MIIBIjAN...". Copy it whole.');
    process.exit(1);
  }
  if (!has('print')) await writeRecord(`mailjet._domainkey.${label}`, dkim);
}

if (token && !has('print')) {
  if (!tokenName) {
    console.error('Pass --token-name exactly as Mailjet shows it, e.g. mailjet._a1b2c3d4');
    process.exit(1);
  }
  // The ownership name belongs under our subdomain, not at the is-a.dev root, so
  // the file name has to carry both labels: mailjet._<token>.goatmedia.json.
  await writeRecord(`${tokenName}.${label}`, token);
}

if (has('verify')) {
  const checks = [{ name: dkimDns, want: dkim }];
  if (tokenDns) checks.push({ name: tokenDns, want: token });
  let missing = 0;
  for (const check of checks) {
    const values = await readTxt(check.name);
    if (values.length === 0) {
      console.log(`${check.name}\n  not published yet`);
      missing += 1;
      continue;
    }
    const hit = check.want ? values.includes(check.want) : true;
    console.log(
      `${check.name}\n  ${hit ? 'published' : 'published, but not the value given'}: ${values[0].slice(0, 48)}${values[0].length > 48 ? '...' : ''}`,
    );
    if (!hit) missing += 1;
  }
  const apexTxt = await readTxt(domain).catch(() => []);
  const spf = apexTxt.find((value) => value.startsWith('v=spf1'));
  console.log(`${domain}\n  ${spf ? `SPF: ${spf}` : 'no apex SPF record (optional)'}`);
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

if (!dkim && !token && !has('print')) usage();
