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
