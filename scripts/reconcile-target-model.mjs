import { createClient } from "@supabase/supabase-js";

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const { data, error } = await supabase
  .from("target_model_reconciliation_summary")
  .select("dataset, legacy_count, target_count, mismatch_count, null_unmapped_count")
  .order("dataset");

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.table(data ?? []);

const failures = (data ?? []).filter(
  (row) => Number(row.mismatch_count ?? 0) > 0 || Number(row.null_unmapped_count ?? 0) > 0,
);

if (failures.length > 0) {
  console.error("Target model reconciliation failed.");
  process.exit(2);
}
