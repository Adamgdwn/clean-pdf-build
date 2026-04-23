import { z } from "zod";

const trimmedOptionalString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const trimmedRequiredString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string());

const trimmedNonEmptyString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string().min(1));

const optionalBooleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean().optional());

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  SUPABASE_URL: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().url()),
  SUPABASE_ANON_KEY: trimmedNonEmptyString,
  SUPABASE_SERVICE_ROLE_KEY: trimmedNonEmptyString,
  SUPABASE_DOCUMENT_BUCKET: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().min(1)).default("documents"),
  SUPABASE_UNSIGNED_DOCUMENT_BUCKET: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().min(1),
  ).default("documents-unsigned"),
  SUPABASE_SIGNED_DOCUMENT_BUCKET: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().min(1),
  ).default("documents-signed"),
  SUPABASE_SIGNATURE_BUCKET: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().min(1)).default("signatures"),
  EASYDRAFT_ADMIN_EMAILS: trimmedOptionalString,
  EASYDRAFT_APP_ORIGIN: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().url()).default("https://easydraftdocs.app"),
  EASYDRAFT_EMAIL_PROVIDER: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.enum(["smtp", "resend"])).optional(),
  EASYDRAFT_NOTIFICATION_FROM_EMAIL: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().email()).optional(),
  EASYDRAFT_NOTIFICATION_FROM_NAME: trimmedOptionalString,
  EASYDRAFT_NOTIFICATION_REPLY_TO: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().email()).optional(),
  RESEND_API_KEY: trimmedOptionalString,
  SMTP_HOST: trimmedOptionalString,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: optionalBooleanFromEnv,
  SMTP_USER: trimmedOptionalString,
  SMTP_PASSWORD: trimmedOptionalString,
  P12_CERT_BASE64: trimmedOptionalString,
  P12_CERT_PASSPHRASE: trimmedOptionalString,
  DOCUMENSO_API_BASE_URL: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().url(),
  ).default("https://app.documenso.com/api/v2"),
  DOCUMENSO_API_KEY: trimmedOptionalString,
  DOCUMENSO_WEBHOOK_SECRET: trimmedOptionalString,
  EASYDRAFT_ENABLE_CERTIFICATE_SIGNING: optionalBooleanFromEnv,
  EASYDRAFT_DIGITAL_SIGNING_PROVIDER: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.enum(["qualified_remote", "organization_hsm", "easy_draft_remote"]),
  ).optional(),
  EASYDRAFT_DIGITAL_SIGNING_API_KEY: trimmedOptionalString,
  EASYDRAFT_REQUIRE_STRIPE: optionalBooleanFromEnv,
  EASYDRAFT_REQUIRE_EMAIL_DELIVERY: optionalBooleanFromEnv,
  EASYDRAFT_PROCESSOR_SECRET: trimmedOptionalString,
  STRIPE_SECRET_KEY: trimmedOptionalString,
  STRIPE_WEBHOOK_SECRET: trimmedOptionalString,
  UPSTASH_REDIS_REST_URL: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().url()).optional(),
  UPSTASH_REDIS_REST_TOKEN: trimmedOptionalString,
  SENTRY_DSN: trimmedOptionalString,
  VITE_EASYDRAFT_ENABLE_CERTIFICATE_SIGNING: optionalBooleanFromEnv,
  VITE_SENTRY_DSN: trimmedOptionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function readServerEnv(source: Record<string, string | undefined> = process.env) {
  if (source === process.env && cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(`Missing required server environment variables: ${parsed.error.message}`);
  }

  if (source === process.env) {
    cachedEnv = parsed.data;
    return cachedEnv;
  }

  return parsed.data;
}

export function getCanonicalAppOrigin(env: ServerEnv = readServerEnv()) {
  return env.EASYDRAFT_APP_ORIGIN.replace(/\/+$/, "");
}

export function shouldRequireStripe(env: ServerEnv = readServerEnv()) {
  return env.EASYDRAFT_REQUIRE_STRIPE ?? env.NODE_ENV === "production";
}

export function shouldRequireEmailDelivery(env: ServerEnv = readServerEnv()) {
  return env.EASYDRAFT_REQUIRE_EMAIL_DELIVERY ?? env.NODE_ENV === "production";
}

export function shouldRequireProcessorSecret(env: ServerEnv = readServerEnv()) {
  return env.NODE_ENV === "production";
}

export function isCertificateSigningEnabled(env: ServerEnv = readServerEnv()) {
  return env.EASYDRAFT_ENABLE_CERTIFICATE_SIGNING ?? false;
}

export function hasRedisRateLimitConfig(env: ServerEnv = readServerEnv()) {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}
