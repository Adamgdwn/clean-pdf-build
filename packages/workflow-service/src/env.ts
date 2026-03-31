import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DOCUMENT_BUCKET: z.string().min(1).default("documents"),
  SUPABASE_SIGNATURE_BUCKET: z.string().min(1).default("signatures"),
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
