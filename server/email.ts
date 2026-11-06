/**
 * Password-reset delivery.
 *
 * GoatMedia only needs one transactional email, so this talks to a plain HTTP
 * email API (Resend's endpoint, which most providers mirror closely) instead of
 * pulling in an SDK. Configure it with:
 *
 *   EMAIL_API_KEY=re_...
 *   EMAIL_FROM="GoatMedia <no-reply@your-domain.example>"
 *
 * Optional, for providers with a different endpoint or payload:
 *   EMAIL_API_URL=https://api.resend.com/emails
 *
 * With nothing configured the link is only written to the server log, which is
 * fine for local development and unacceptable in production — the server warns
 * about exactly that.
 */

interface ResetEmail {
  to: string;
  username: string;
  resetUrl: string;
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

function resetEmailBody({ username, resetUrl }: ResetEmail) {
  const text = [
    `Hi ${username},`,
    '',
    'Someone asked to reset the password for your GoatMedia account.',
    'Open this link within the next hour to choose a new one:',
    '',
    resetUrl,
    '',
    'If this was not you, you can ignore this message — your password stays the same.',
    '',
    '— GoatMedia',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#F5F0E6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#221E18;">
    <div style="max-width:480px;margin:0 auto;">
      <p style="font-size:20px;font-weight:700;margin:0 0 20px;">GoatMedia</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">Hi ${escapeHtml(username)},</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 18px;">
        Someone asked to reset the password for your account. This link works for one hour.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#B5471F;color:#FFFDF8;text-decoration:none;font-size:15px;font-weight:600;padding:11px 18px;border-radius:8px;">Choose a new password</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#5C5449;margin:0;">
        If this was not you, ignore this message. Your password stays the same.
      </p>
    </div>
  </body>
</html>`;

  return { text, html };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export async function sendPasswordResetEmail({ to, username, resetUrl }: ResetEmail): Promise<boolean> {
  if (!emailDeliveryConfigured()) return false;

  const endpoint = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
  const body = resetEmailBody({ to, username, resetUrl });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject: 'Reset your GoatMedia password',
        text: body.text,
        html: body.html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Log the status only; the reset token must never reach the logs.
      console.warn(`[GoatMedia] Password reset email was rejected (HTTP ${response.status}).`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[GoatMedia] Password reset email could not be sent:', (error as Error).message);
    return false;
  }
}
