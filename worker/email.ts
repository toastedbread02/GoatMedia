// Outgoing mail: ban notices, warning notices and appeal decisions.
//
// A Worker cannot deliver mail on its own, so this talks to whichever provider
// has a key configured. SendGrid, Brevo and Mailjet all allow a free account
// with a single verified sender address, which is the only option before the
// site has a domain of its own; Mailjet is the one that asks for the least
// information at signup. With no key the message is recorded as skipped and the
// in-app side of the same event still happens, so the moderation record stays
// truthful about what was actually delivered.
//
// The messages are built as email HTML, which is not web HTML: tables instead of
// flexbox, inline styles instead of a stylesheet, no SVG. The only stylesheet is
// a dark-mode override that Apple Mail honours and Gmail partly ignores, so the
// light version has to stand on its own.

import { Env, allowedOrigins, now, uid } from './lib';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  kind: 'ban' | 'warning' | 'appeal-decision';
  userId?: string | null;
  appealId?: string | null;
}

/**
 * The public address of the site, used for appeal links inside emails. This has
 * to be where people actually land, not merely an allowed API origin, so it is
 * set explicitly as SITE_ORIGIN and only guessed when that is absent.
 */
export function siteOrigin(env: Env): string {
  if (env.SITE_ORIGIN) return env.SITE_ORIGIN.replace(/\/+$/, '');
  const origins = allowedOrigins(env);
  return origins.find((origin) => origin.startsWith('https://')) ?? origins[0] ?? 'https://toastedbread02.github.io';
}

/**
 * The site's base address, including the subdirectory GitHub Pages serves a
 * project from. A custom domain serves from the root, so the prefix disappears
 * with it rather than being hard-coded.
 */
export function siteBase(env: Env): string {
  const base = siteOrigin(env);
  const prefix = env.SITE_BASE_PATH ?? (base.includes('github.io') ? '/GoatMedia' : '');
  return `${base}${prefix}`;
}

export function appealUrl(env: Env, token: string): string {
  return `${siteBase(env)}/appeal/${token}`;
}

/** Where the links and the logo in a message point. */
export interface MailSite {
  icon: string;
  home: string;
  guidelines: string;
  privacy: string;
  contact: string;
}

export function mailSite(env: Env): MailSite {
  const base = siteBase(env);
  return {
    // Lives in public/, so it ships with the site and needs no hosting of its
    // own. A PNG because no mail client renders SVG reliably.
    icon: `${base}/mail-icon.png`,
    home: `${base}/`,
    guidelines: `${base}/guidelines`,
    privacy: `${base}/privacy`,
    contact: `${base}/contact`,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sentDate(): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(now()));
}

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface LayoutOptions {
  heading: string;
  paragraphs: string[];
  details?: { label: string; value: string }[];
  button?: { label: string; url: string };
  footer: string;
  site: MailSite;
}

/**
 * One layout for every message: identity, a heading, the facts, and one action.
 * A moderation notice is not a marketing email, so there is no banner, no
 * imagery beyond the product mark, and nothing to click except the thing the
 * message is about.
 */
function layout(options: LayoutOptions): string {
  const { site } = options;
  const first = options.paragraphs[0] ?? '';
  const preheader = first.length > 110 ? `${first.slice(0, 107)}...` : first;

  const paragraphs = options.paragraphs
    .map(
      (paragraph, index) =>
        `<p class="gm-body" style="margin:${index === 0 ? '0' : '12px'} 0 0;font:400 15px/1.6 ${FONT};color:#3a352d">${escapeHtml(paragraph)}</p>`,
    )
    .join('');

  const details = options.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="gm-panel" style="margin-top:20px;background:#f7f2e7;border-radius:10px">
        <tr><td style="padding:16px 18px">
          ${options.details
            .map(
              (row, index) =>
                `<p class="gm-muted" style="margin:0 0 3px;font:400 12.5px/1.4 ${FONT};color:#6f6759">${escapeHtml(row.label)}</p>
                 <p class="gm-ink" style="margin:0 0 ${index === (options.details?.length ?? 0) - 1 ? 0 : 14}px;font:600 15px/1.5 ${FONT};color:#1c1915">${escapeHtml(row.value)}</p>`,
            )
            .join('')}
        </td></tr>
      </table>`
    : '';

  const button = options.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">
        <tr><td class="gm-button" style="background:#b24e22;border-radius:9px">
          <a class="gm-button" href="${escapeHtml(options.button.url)}" style="display:inline-block;padding:12px 20px;font:600 15px/1.2 ${FONT};color:#fff9f2;text-decoration:none;border-radius:9px">${escapeHtml(options.button.label)}</a>
        </td></tr>
      </table>
      <p class="gm-muted" style="margin:14px 0 0;font:400 12.5px/1.6 ${FONT};color:#6f6759">If the button does not work, paste this into your browser:<br><span style="color:#8a5a3d;word-break:break-all">${escapeHtml(options.button.url)}</span></p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(options.heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .gm-page { background: #141210 !important; }
    .gm-card { background: #1e1a16 !important; border-color: #322c25 !important; }
    .gm-heading, .gm-ink { color: #f4ecdf !important; }
    .gm-body { color: #cfc6b8 !important; }
    .gm-muted { color: #9d9486 !important; }
    .gm-panel { background: #262119 !important; }
    .gm-button { background: #d4713f !important; color: #17140f !important; }
  }
</style>
</head>
<body class="gm-page" style="margin:0;padding:0;background:#f5f0e5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="gm-page" style="background:#f5f0e5">
  <tr><td align="center" style="padding:28px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="gm-card" style="max-width:560px;background:#fffdf8;border:1px solid #e7dfce;border-radius:14px">
      <tr><td style="padding:24px 28px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="40" style="padding:0 12px 0 0">
              <img src="${escapeHtml(site.icon)}" width="40" height="40" alt="GoatMedia" style="display:block;width:40px;height:40px;border-radius:10px">
            </td>
            <td>
              <p class="gm-ink" style="margin:0;font:600 15px/1.2 ${FONT};color:#1c1915">GoatMedia</p>
              <p class="gm-muted" style="margin:2px 0 0;font:400 12.5px/1.4 ${FONT};color:#6f6759">Account notice</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <h1 class="gm-heading" style="margin:0;font:600 21px/1.3 ${FONT};color:#1c1915">${escapeHtml(options.heading)}</h1>
      </td></tr>
      <tr><td style="padding:12px 28px 0">${paragraphs}${details}${button}</td></tr>
      <tr><td style="padding:28px 28px 26px">
        <p class="gm-muted" style="margin:0;font:400 12.5px/1.6 ${FONT};color:#6f6759">${escapeHtml(options.footer)}</p>
        <p class="gm-muted" style="margin:12px 0 0;font:400 12.5px/1.6 ${FONT};color:#6f6759">
          <a href="${escapeHtml(site.guidelines)}" style="color:#8a5a3d;text-decoration:none">Community guidelines</a>
          &nbsp;&middot;&nbsp;
          <a href="${escapeHtml(site.privacy)}" style="color:#8a5a3d;text-decoration:none">Privacy</a>
          &nbsp;&middot;&nbsp;
          <a href="${escapeHtml(site.contact)}" style="color:#8a5a3d;text-decoration:none">Contact</a>
        </p>
        <p class="gm-muted" style="margin:10px 0 0;font:400 12px/1.6 ${FONT};color:#8a8275">GoatMedia &middot; ${escapeHtml(sentDate())} &middot; sent automatically, read by a person if you appeal</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendViaSendgrid(env: Env, mail: Mail) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: mail.to }] }],
      from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'GoatMedia' },
      ...(env.MAIL_REPLY_TO ? { reply_to: { email: env.MAIL_REPLY_TO } } : {}),
      subject: mail.subject,
      content: [
        { type: 'text/plain', value: mail.text },
        { type: 'text/html', value: mail.html },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`SendGrid ${response.status}: ${(await response.text()).slice(0, 180)}`);
  }
}

async function sendViaBrevo(env: Env, mail: Mail) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': String(env.BREVO_API_KEY),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'GoatMedia' },
      ...(env.MAIL_REPLY_TO ? { replyTo: { email: env.MAIL_REPLY_TO } } : {}),
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 180)}`);
  }
}

async function sendViaMailjet(env: Env, mail: Mail) {
  // Mailjet uses HTTP Basic auth with the public key as the username and the
  // private key as the password, not a bearer token.
  const credentials = btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`);
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: env.MAIL_FROM, Name: env.MAIL_FROM_NAME || 'GoatMedia' },
          ...(env.MAIL_REPLY_TO ? { ReplyTo: { Email: env.MAIL_REPLY_TO } } : {}),
          To: [{ Email: mail.to }],
          Subject: mail.subject,
          TextPart: mail.text,
          HTMLPart: mail.html,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Mailjet ${response.status}: ${(await response.text()).slice(0, 180)}`);
  }
  // Mailjet answers 200 even when the message itself is refused (unverified
  // sender, for instance), so the per-message verdict has to be read.
  const body = (await response.json().catch(() => null)) as
    | { Messages?: { Status?: string; Errors?: { ErrorMessage?: string }[] }[] }
    | null;
  const message = body?.Messages?.[0];
  if (message?.Status === 'error') {
    const detail = message.Errors?.map((entry) => entry.ErrorMessage).filter(Boolean).join('; ');
    throw new Error(`Mailjet: ${(detail || 'message rejected').slice(0, 180)}`);
  }
}

/**
 * Sends one message and records the outcome. Never throws: a failed email must
 * not undo a moderation decision that has already been written to the database.
 */
export async function sendMail(env: Env, mail: Mail): Promise<'sent' | 'failed' | 'skipped'> {
  const provider = env.SENDGRID_API_KEY
    ? 'sendgrid'
    : env.BREVO_API_KEY
      ? 'brevo'
      : env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY
        ? 'mailjet'
        : null;
  let status: 'sent' | 'failed' | 'skipped' = 'skipped';
  let error: string | null = null;

  if (provider && env.MAIL_FROM) {
    try {
      if (provider === 'sendgrid') await sendViaSendgrid(env, mail);
      else if (provider === 'brevo') await sendViaBrevo(env, mail);
      else await sendViaMailjet(env, mail);
      status = 'sent';
    } catch (caught) {
      status = 'failed';
      error = caught instanceof Error ? caught.message : 'Unknown delivery error';
    }
  } else {
    error = 'No email provider is configured, so this notice was only recorded.';
  }

  try {
    await env.DB.prepare(
      `INSERT INTO emails (id, user_id, to_email, kind, subject, status, error, appeal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(uid('eml'), mail.userId ?? null, mail.to, mail.kind, mail.subject, status, error, mail.appealId ?? null, now())
      .run();
  } catch {
    /* the log is useful, never essential */
  }

  return status;
}

export function banEmail(options: { reason: string; appealUrl: string; site: MailSite; until?: string | null }) {
  const until = options.until ? ` The suspension is in place until ${options.until}.` : '';
  const closing = 'The appeal is read by a person, not a filter, and they can reverse the decision.';
  return {
    subject: 'Your GoatMedia account has been suspended',
    text: [
      'Hello,',
      '',
      'Your GoatMedia account has been suspended.',
      '',
      `Reason: ${options.reason}`,
      '',
      `While an account is suspended, its posts and comments are hidden and signing in is not possible.${until}`,
      '',
      closing,
      '',
      `Appeal here: ${options.appealUrl}`,
      '',
      `Community guidelines: ${options.site.guidelines}`,
      `Questions: ${options.site.contact}`,
      '',
      'GoatMedia',
    ].join('\n'),
    html: layout({
      heading: 'Your account has been suspended',
      paragraphs: [
        'Hello,',
        'Your GoatMedia account has been suspended, so its posts and comments are hidden and signing in is not possible.',
        closing,
      ],
      details: [
        { label: 'Reason', value: options.reason },
        ...(options.until ? [{ label: 'Suspended until', value: options.until }] : []),
      ],
      button: { label: 'Appeal this suspension', url: options.appealUrl },
      footer: 'If you would rather not appeal, you can ignore this message. Nothing else changes.',
      site: options.site,
    }),
  };
}

export function warningEmail(options: {
  reason: string;
  count: number;
  limit: number;
  appealUrl: string;
  site: MailSite;
}) {
  const remaining = Math.max(0, options.limit - options.count);
  const tally =
    remaining === 0
      ? 'This is the last warning: one more would suspend the account.'
      : `This is warning ${options.count} of ${options.limit}. ${remaining} more would suspend the account.`;
  const closing =
    'Something automatic flagged this, and automatic checks get things wrong. If this was a goat and not what the filter thought, appeal and a person will look again.';
  return {
    subject: 'A warning on your GoatMedia account',
    text: [
      'Hello,',
      '',
      'A moderator has recorded a warning on your GoatMedia account.',
      '',
      `Reason: ${options.reason}`,
      tally,
      '',
      closing,
      '',
      `Appeal here: ${options.appealUrl}`,
      '',
      `Community guidelines: ${options.site.guidelines}`,
      `Questions: ${options.site.contact}`,
      '',
      'GoatMedia',
    ].join('\n'),
    html: layout({
      heading: 'A warning on your account',
      paragraphs: [
        'Hello,',
        'A moderator has recorded a warning on your GoatMedia account.',
        closing,
      ],
      details: [
        { label: 'Reason', value: options.reason },
        { label: 'Warning', value: tally },
      ],
      button: { label: 'Appeal this warning', url: options.appealUrl },
      footer: 'Warnings stay on record unless an appeal is accepted.',
      site: options.site,
    }),
  };
}

export function decisionEmail(options: {
  kind: 'ban' | 'warning';
  accepted: boolean;
  note?: string | null;
  site: MailSite;
}) {
  const what = options.kind === 'ban' ? 'suspension' : 'warning';
  const outcome = options.accepted
    ? `Your appeal against the ${what} was accepted. ${options.kind === 'ban' ? 'The account is active again and its posts are back.' : 'The warning no longer counts against your account.'}`
    : `Your appeal against the ${what} was declined, so the ${what} stays in place.`;
  return {
    subject: options.accepted ? `Your GoatMedia ${what} was reversed` : `Your GoatMedia ${what} appeal was declined`,
    text: [
      'Hello,',
      '',
      outcome,
      ...(options.note ? ['', `Note from the moderator: ${options.note}`] : []),
      '',
      `GoatMedia: ${options.site.home}`,
      '',
      'GoatMedia',
    ].join('\n'),
    html: layout({
      heading: options.accepted ? 'Your appeal was accepted' : 'Your appeal was declined',
      paragraphs: ['Hello,', outcome],
      details: options.note ? [{ label: 'Note from the moderator', value: options.note }] : undefined,
      button: options.accepted ? { label: 'Open GoatMedia', url: options.site.home } : undefined,
      footer: 'Thank you for taking the time to write it.',
      site: options.site,
    }),
  };
}
