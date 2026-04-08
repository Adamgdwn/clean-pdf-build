import nodemailer from "nodemailer";

import type { ServerEnv } from "./env.js";
import { AppError } from "./errors.js";

type NotificationProvider = "smtp" | "resend";

type NotificationEmailContent = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

type NotificationDeliveryResult = {
  provider: NotificationProvider;
  messageId: string | null;
};

type NotificationProviderConfig =
  | {
      provider: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      password?: string;
      from: string;
      fromName?: string;
      replyTo?: string;
    }
  | {
      provider: "resend";
      apiKey: string;
      from: string;
      fromName?: string;
      replyTo?: string;
    };

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedTransporterKey: string | null = null;

function formatFromAddress(from: string, fromName?: string) {
  if (!fromName?.trim()) {
    return from;
  }

  return `${fromName.trim()} <${from}>`;
}

function resolveSmtpSecure(env: ServerEnv) {
  if (typeof env.SMTP_SECURE === "boolean") {
    return env.SMTP_SECURE;
  }

  return env.SMTP_PORT === 465;
}

export function getConfiguredNotificationEmailProvider(env: ServerEnv): NotificationProvider | null {
  const requestedProvider = env.EASYDRAFT_EMAIL_PROVIDER;
  const hasSmtpConfig = Boolean(
    env.SMTP_HOST && env.SMTP_PORT && env.EASYDRAFT_NOTIFICATION_FROM_EMAIL,
  );
  const hasResendConfig = Boolean(env.RESEND_API_KEY && env.EASYDRAFT_NOTIFICATION_FROM_EMAIL);

  if (requestedProvider === "smtp") {
    return hasSmtpConfig ? "smtp" : null;
  }

  if (requestedProvider === "resend") {
    return hasResendConfig ? "resend" : null;
  }

  if (hasSmtpConfig) {
    return "smtp";
  }

  if (hasResendConfig) {
    return "resend";
  }

  return null;
}

function getNotificationProviderConfig(env: ServerEnv): NotificationProviderConfig | null {
  const provider = getConfiguredNotificationEmailProvider(env);

  if (provider === "smtp") {
    if ((env.SMTP_USER && !env.SMTP_PASSWORD) || (!env.SMTP_USER && env.SMTP_PASSWORD)) {
      throw new AppError(500, "SMTP_USER and SMTP_PASSWORD must be configured together.");
    }

    return {
      provider,
      host: env.SMTP_HOST!,
      port: env.SMTP_PORT!,
      secure: resolveSmtpSecure(env),
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.EASYDRAFT_NOTIFICATION_FROM_EMAIL!,
      fromName: env.EASYDRAFT_NOTIFICATION_FROM_NAME,
      replyTo: env.EASYDRAFT_NOTIFICATION_REPLY_TO,
    };
  }

  if (provider === "resend") {
    return {
      provider,
      apiKey: env.RESEND_API_KEY!,
      from: env.EASYDRAFT_NOTIFICATION_FROM_EMAIL!,
      fromName: env.EASYDRAFT_NOTIFICATION_FROM_NAME,
      replyTo: env.EASYDRAFT_NOTIFICATION_REPLY_TO,
    };
  }

  return null;
}

function getSmtpTransporter(config: Extract<NotificationProviderConfig, { provider: "smtp" }>) {
  const cacheKey = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user ?? "",
  });

  if (cachedTransporter && cachedTransporterKey === cacheKey) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
  });
  cachedTransporterKey = cacheKey;
  return cachedTransporter;
}

async function deliverViaSmtp(
  config: Extract<NotificationProviderConfig, { provider: "smtp" }>,
  content: NotificationEmailContent,
): Promise<NotificationDeliveryResult> {
  const transporter = getSmtpTransporter(config);
  const info = await transporter.sendMail({
    from: formatFromAddress(config.from, config.fromName),
    to: content.to,
    subject: content.subject,
    html: content.html,
    replyTo: content.replyTo ?? config.replyTo,
  });

  return {
    provider: "smtp",
    messageId: info.messageId ?? null,
  };
}

async function deliverViaResend(
  config: Extract<NotificationProviderConfig, { provider: "resend" }>,
  content: NotificationEmailContent,
): Promise<NotificationDeliveryResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatFromAddress(config.from, config.fromName),
      to: [content.to],
      subject: content.subject,
      html: content.html,
      ...(content.replyTo ?? config.replyTo ? { reply_to: content.replyTo ?? config.replyTo } : {}),
    }),
  });
  const responseBody = (await response.json().catch(() => ({}))) as { id?: string; message?: string };

  if (!response.ok) {
    throw new AppError(502, responseBody.message ?? "Notification delivery failed.");
  }

  return {
    provider: "resend",
    messageId: responseBody.id ?? null,
  };
}

export async function deliverNotificationEmail(
  env: ServerEnv,
  content: NotificationEmailContent,
): Promise<NotificationDeliveryResult | null> {
  const config = getNotificationProviderConfig(env);

  if (!config) {
    return null;
  }

  if (config.provider === "smtp") {
    return deliverViaSmtp(config, content);
  }

  return deliverViaResend(config, content);
}

export function buildWelcomeEmail(fullName: string, appOrigin: string): string {
  const firstName = fullName.split(" ")[0] ?? fullName;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to EasyDraftDocs</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1d7a5c;padding:28px 40px;">
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">EasyDraftDocs</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 16px;font-size:24px;font-weight:700;color:#18241d;">Welcome, ${firstName}.</p>
          <p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">
            You're all set. Here's how to get the most out of EasyDraftDocs in your first session:
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="width:32px;height:32px;background:#1d7a5c;border-radius:50%;text-align:center;vertical-align:middle;color:#fff;font-size:14px;font-weight:700;">1</td>
                  <td style="padding-left:14px;vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#18241d;">Upload a PDF and send for signature</p>
                    <p style="margin:0;font-size:14px;color:#666;line-height:1.5;">Assign signers, place signature fields, and send — EasyDraftDocs routes the workflow and notifies each participant automatically.</p>
                  </td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="width:32px;height:32px;background:#1d7a5c;border-radius:50%;text-align:center;vertical-align:middle;color:#fff;font-size:14px;font-weight:700;">2</td>
                  <td style="padding-left:14px;vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#18241d;">Save your signature for reuse</p>
                    <p style="margin:0;font-size:14px;color:#666;line-height:1.5;">Create a typed or uploaded signature in the Signature Library — select it on any future document without redrawing.</p>
                  </td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 0;vertical-align:top;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="width:32px;height:32px;background:#1d7a5c;border-radius:50%;text-align:center;vertical-align:middle;color:#fff;font-size:14px;font-weight:700;">3</td>
                  <td style="padding-left:14px;vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#18241d;">Invite a teammate</p>
                    <p style="margin:0;font-size:14px;color:#666;line-height:1.5;">Add editors, co-signers, or viewers to share your workspace and collaborate on documents together.</p>
                  </td>
                </tr></table>
              </td>
            </tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="background:#1d7a5c;border-radius:8px;">
              <a href="${appOrigin}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">Open EasyDraftDocs →</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:14px;color:#888;line-height:1.6;">
            Questions? Reply to this email or visit <a href="${appOrigin}/guide.html" style="color:#1d7a5c;">the user guide</a>.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#aaa;">EasyDraftDocs · Private document workflows</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
