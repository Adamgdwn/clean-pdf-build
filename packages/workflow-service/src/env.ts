import { z } from "zod";

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
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DOCUMENT_BUCKET: z.string().min(1).default("documents"),
  SUPABASE_SIGNATURE_BUCKET: z.string().min(1).default("signatures"),
  EASYDRAFT_ADMIN_EMAILS: z.string().optional(),
  EASYDRAFT_APP_ORIGIN: z.string().url().default("https://easydraftdocs.app"),
  EASYDRAFT_EMAIL_PROVIDER: z.enum(["smtp", "resend"]).optional(),
  EASYDRAFT_NOTIFICATION_FROM_EMAIL: z.string().email().optional(),
  EASYDRAFT_NOTIFICATION_FROM_NAME: z.string().min(1).optional(),
  EASYDRAFT_NOTIFICATION_REPLY_TO: z.string().email().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: optionalBooleanFromEnv,
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EASYDRAFT_DIGITAL_SIGNING_PROVIDER: z
    .enum(["qualified_remote", "organization_hsm", "easy_draft_remote"])
    .optional(),
  EASYDRAFT_DIGITAL_SIGNING_API_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function readServerEnv(source: Record<string, string | undefined> = process.env) {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(`Missing required server environment variables: ${parsed.error.message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
