import { createClient } from "@supabase/supabase-js";

import { readServerEnv } from "./env.js";

export function createServiceRoleClient() {
  const env = readServerEnv();

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAuthClient() {
  const env = readServerEnv();

  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
