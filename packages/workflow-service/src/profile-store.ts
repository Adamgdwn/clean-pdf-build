import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "./errors.js";
import { type AccountType, type ProfileKind } from "./profile-identity.js";

export const PROFILE_COLUMNS =
  "user_id, email, display_name, username, avatar_url, company_name, account_type, workspace_name, job_title, locale, timezone, marketing_opt_in, product_updates_opt_in, last_seen_at, onboarding_completed_at" as const;

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  company_name: string | null;
  account_type: AccountType;
  workspace_name: string | null;
  job_title: string | null;
  locale: string | null;
  timezone: string | null;
  marketing_opt_in: boolean;
  product_updates_opt_in: boolean;
  last_seen_at: string | null;
  onboarding_completed_at: string | null;
  profile_kind: ProfileKind;
};

type SplitProfileRow = Omit<ProfileRow, "id" | "profile_kind"> & {
  user_id: string;
};

type ProfileUpsertPayload = {
  user_id: string;
  email: string;
  display_name: string;
  username: string | null;
  company_name: string | null;
  account_type: AccountType;
  workspace_name: string | null;
  avatar_url?: string | null;
  job_title?: string | null;
  locale?: string | null;
  timezone?: string | null;
  marketing_opt_in?: boolean;
  product_updates_opt_in?: boolean;
  last_seen_at?: string | null;
  onboarding_completed_at?: string | null;
};

type ProfileTableName = "easydraft_user_profiles" | "easydraft_staff_profiles";

const PROFILE_TABLES: Array<{ table: ProfileTableName; kind: ProfileKind }> = [
  { table: "easydraft_user_profiles", kind: "easydraft_user" },
  { table: "easydraft_staff_profiles", kind: "easydraft_staff" },
];

function tableForProfileKind(profileKind: ProfileKind): ProfileTableName {
  return profileKind === "easydraft_staff" ? "easydraft_staff_profiles" : "easydraft_user_profiles";
}

function oppositeProfileTable(profileKind: ProfileKind): ProfileTableName {
  return profileKind === "easydraft_staff" ? "easydraft_user_profiles" : "easydraft_staff_profiles";
}

function mapSplitProfileRow(row: SplitProfileRow, profileKind: ProfileKind): ProfileRow {
  return {
    id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    username: row.username,
    avatar_url: row.avatar_url,
    company_name: row.company_name,
    account_type: row.account_type,
    workspace_name: row.workspace_name,
    job_title: row.job_title,
    locale: row.locale,
    timezone: row.timezone,
    marketing_opt_in: row.marketing_opt_in,
    product_updates_opt_in: row.product_updates_opt_in,
    last_seen_at: row.last_seen_at,
    onboarding_completed_at: row.onboarding_completed_at,
    profile_kind: profileKind,
  };
}

async function selectProfilesFromTable(
  adminClient: SupabaseClient,
  table: ProfileTableName,
  profileKind: ProfileKind,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from(table)
    .select(PROFILE_COLUMNS)
    .in("user_id", userIds);

  if (error) {
    throw new AppError(500, error.message);
  }

  return ((data ?? []) as SplitProfileRow[]).map((row) => mapSplitProfileRow(row, profileKind));
}

export async function listProfilesByIds(adminClient: SupabaseClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  const rows = (
    await Promise.all(
      PROFILE_TABLES.map(({ table, kind }) =>
        selectProfilesFromTable(adminClient, table, kind, uniqueUserIds),
      ),
    )
  ).flat();

  const byId = new Map<string, ProfileRow>();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  return [...byId.values()];
}

export async function getProfileById(adminClient: SupabaseClient, userId: string) {
  const [profile] = await listProfilesByIds(adminClient, [userId]);
  return profile ?? null;
}

export async function findProfileByEmail(adminClient: SupabaseClient, email: string) {
  for (const { table, kind } of PROFILE_TABLES) {
    const { data, error } = await adminClient
      .from(table)
      .select(PROFILE_COLUMNS)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new AppError(500, error.message);
    }

    if (data) {
      return mapSplitProfileRow(data as SplitProfileRow, kind);
    }
  }

  return null;
}

export async function upsertProfile(
  adminClient: SupabaseClient,
  profileKind: ProfileKind,
  payload: ProfileUpsertPayload,
) {
  const table = tableForProfileKind(profileKind);
  const { error } = await adminClient
    .from(table)
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    throw new AppError(500, error.message);
  }

  const { error: deleteError } = await adminClient
    .from(oppositeProfileTable(profileKind))
    .delete()
    .eq("user_id", payload.user_id);

  if (deleteError) {
    throw new AppError(500, deleteError.message);
  }
}

export async function updateProfileById(
  adminClient: SupabaseClient,
  userId: string,
  payload: Record<string, string | boolean | null>,
) {
  const existingProfile = await getProfileById(adminClient, userId);
  if (!existingProfile) {
    throw new AppError(404, "Unable to load account profile.");
  }

  const table = tableForProfileKind(existingProfile.profile_kind);
  const { data, error } = await adminClient
    .from(table)
    .update(payload)
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to update account profile.");
  }

  return mapSplitProfileRow(data as SplitProfileRow, existingProfile.profile_kind);
}

export async function countProfiles(adminClient: SupabaseClient) {
  const [usersResponse, staffResponse] = await Promise.all(
    PROFILE_TABLES.map(({ table }) =>
      adminClient.from(table).select("*", { count: "exact", head: true }),
    ),
  );

  for (const response of [usersResponse, staffResponse]) {
    if (response.error) {
      throw new AppError(500, response.error.message);
    }
  }

  return (usersResponse.count ?? 0) + (staffResponse.count ?? 0);
}

export async function deleteProfileById(adminClient: SupabaseClient, userId: string) {
  const [userResponse, staffResponse] = await Promise.all(
    PROFILE_TABLES.map(({ table }) =>
      adminClient.from(table).delete().eq("user_id", userId),
    ),
  );

  for (const response of [userResponse, staffResponse]) {
    if (response.error) {
      throw new AppError(500, response.error.message);
    }
  }
}
