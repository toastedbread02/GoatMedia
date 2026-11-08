// Outgoing mail: ban notices, warning notices and appeal decisions.
//
// A Worker cannot deliver mail on its own, so this talks to whichever provider
// has a key configured. SendGrid, Brevo and Mailjet all allow a free account
// with a single verified sender address, which is the only option before the
// site has a domain of its own; Mailjet is the one that asks for the least
// information at signup. With no key the message is recorded as skipped and the
// in-app side of the same event still happens, so the moderation record stays
// truthful about what was actually delivered.

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

export function appealUrl(env: Env, token: string): string {
  const base = siteOrigin(env).replace(/\/+$/, '');
  // GitHub Pages serves the app from a subdirectory; a real domain serves it
  // from the root. BASE_PATH is set on the Pages build.
  const prefix = env.SITE_BASE_PATH ?? (base.includes('github.io') ? '/GoatMedia' : '');
  return `${base}${prefix}/appeal/${token}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One layout for every message: a heading, paragraphs, and one clear button.
 * Deliberately plain, because a moderation notice is not a marketing email.
 */
function layout(heading: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string) {
  const body = paragraphs.map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph)}</p>`).join('');
  const cta = button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#b24e22;color:#fff9f2;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#6f6759">If the button does not work, paste this link into your browser:<br>${escapeHtml(button.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f0e5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1915">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border-radius:12px;padding:26px">
    <p style="margin:0 0 18px;font-weight:700;font-size:15px;letter-spacing:0">GoatMedia</p>
    <h1 style="margin:0 0 16px;font-size:21px;line-height:1.25">${escapeHtml(heading)}</h1>
    ${body}${cta}
    <p style="margin:22px 0 0;font-size:12.5px;color:#6f6759">${escapeHtml(footer ?? 'You are reading this because it affects your GoatMedia account.')}</p>
  </div>
</body></html>`;
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

export function banEmail(options: { reason: string; appealUrl: string; until?: string | null }) {
  const until = options.until ? ` The suspension is in place until ${options.until}.` : '';
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
      'If you think this was a mistake, you can appeal. A person reads every appeal and can reverse the decision.',
      '',
      options.appealUrl,
    ].join('\n'),
    html: layout(
      'Your account has been suspended',
      [
        'Hello,',
        'Your GoatMedia account has been suspended.',
        `Reason: ${options.reason}`,
        `While an account is suspended, its posts and comments are hidden and signing in is not possible.${until}`,
        'If you think this was a mistake, you can appeal. A person reads every appeal and can reverse the decision.',
      ],
      { label: 'Appeal this suspension', url: options.appealUrl },
      'If you would rather not appeal, you can ignore this message.',
    ),
  };
}

export function warningEmail(options: {
  reason: string;
  count: number;
  limit: number;
  appealUrl: string;
}) {
  const remaining = Math.max(0, options.limit - options.count);
  return {
    subject: 'A warning on your GoatMedia account',
    text: [
      'Hello,',
      '',
      'A moderator has recorded a warning on your GoatMedia account.',
      '',
      `Reason: ${options.reason}`,
      '',
      `This is warning ${options.count} of ${options.limit}. ${remaining === 0 ? 'One more would suspend the account.' : `${remaining} more would suspend the account.`}`,
      '',
      'Something automatic flagged this, and automatic checks get things wrong. If this was a goat and not what the filter thought, you can appeal and a person will look again.',
      '',
      options.appealUrl,
    ].join('\n'),
    html: layout(
      'A warning on your account',
      [
        'Hello,',
        'A moderator has recorded a warning on your GoatMedia account.',
        `Reason: ${options.reason}`,
        `This is warning ${options.count} of ${options.limit}. ${remaining === 0 ? 'One more would suspend the account.' : `${remaining} more would suspend the account.`}`,
        'Something automatic flagged this, and automatic checks get things wrong. If this was a goat and not what the filter thought, you can appeal and a person will look again.',
      ],
      { label: 'Appeal this warning', url: options.appealUrl },
      'Warnings stay on record unless an appeal is accepted.',
    ),
  };
}

export function decisionEmail(options: { kind: 'ban' | 'warning'; accepted: boolean; note?: string | null }) {
  const what = options.kind === 'ban' ? 'suspension' : 'warning';
  const outcome = options.accepted
    ? `Your appeal against the ${what} was accepted. ${options.kind === 'ban' ? 'The account is active again and its posts are back.' : 'The warning no longer counts against your account.'}`
    : `Your appeal against the ${what} was declined, so the ${what} stays in place.`;
  return {
    subject: options.accepted ? `Your GoatMedia ${what} was reversed` : `Your GoatMedia ${what} appeal was declined`,
    text: ['Hello,', '', outcome, options.note ? `\nNote from the moderator: ${options.note}` : '', '', 'GoatMedia'].join('\n'),
    html: layout(
      options.accepted ? 'Your appeal was accepted' : 'Your appeal was declined',
      ['Hello,', outcome, ...(options.note ? [`Note from the moderator: ${options.note}`] : [])],
      undefined,
      'Thank you for taking the time to write it.',
    ),
  };
}
