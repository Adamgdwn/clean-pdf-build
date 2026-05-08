import { z } from "zod";

export const accountClassSchema = z.enum(["personal", "corporate_admin", "corporate_member"]);
export const documentModeSchema = z.enum(["initiator", "internal_signer", "external_signer"]);
export const authorityLevelSchema = z.enum(["viewer", "signer", "document_admin", "org_admin_override"]);

export type AccountClass = z.infer<typeof accountClassSchema>;
export type DocumentMode = z.infer<typeof documentModeSchema>;
export type AuthorityLevel = z.infer<typeof authorityLevelSchema>;

export type LegacyAccountType = "individual" | "corporate";
export type LegacyWorkspaceType = "personal" | "team";
export type LegacyMembershipRole = "account_admin" | "admin" | "member" | "billing_admin";
export type LegacyAccessRole = "document_admin" | "editor" | "signer" | "viewer";
export type LegacyParticipantType = "internal" | "external";

export type AccountAction =
  | "access_org_admin"
  | "manage_people"
  | "manage_billing"
  | "change_primary_admin"
  | "close_account"
  | "create_documents";

const corporateAdminRoles = new Set<LegacyMembershipRole>(["account_admin", "admin", "billing_admin"]);

export function accountClassFromLegacyModel(input: {
  accountType?: LegacyAccountType | null;
  workspaceType?: LegacyWorkspaceType | string | null;
  membershipRole?: LegacyMembershipRole | string | null;
}): AccountClass {
  // TEMP_MIGRATION_BRIDGE
  if (input.accountType === "individual" || input.workspaceType === "personal") {
    return "personal";
  }

  // TEMP_MIGRATION_BRIDGE
  if (
    input.accountType === "corporate" ||
    input.workspaceType === "team" ||
    input.membershipRole
  ) {
    if (input.accountType === "corporate" && !input.membershipRole) {
      return "corporate_admin";
    }

    return corporateAdminRoles.has(input.membershipRole as LegacyMembershipRole)
      ? "corporate_admin"
      : "corporate_member";
  }

  // TEMP_MIGRATION_BRIDGE
  return "personal";
}

export function documentModeFromLegacyParticipantType(
  participantType: LegacyParticipantType | string | null | undefined,
): DocumentMode {
  // TEMP_MIGRATION_BRIDGE
  return participantType === "internal" ? "internal_signer" : "external_signer";
}

export function legacyParticipantTypeFromDocumentMode(documentMode: DocumentMode): LegacyParticipantType {
  // TEMP_MIGRATION_BRIDGE
  return documentMode === "internal_signer" || documentMode === "initiator" ? "internal" : "external";
}

export function authorityFromLegacyAccessRole(role: LegacyAccessRole | string | null | undefined): AuthorityLevel | null {
  // TEMP_MIGRATION_BRIDGE
  if (!role) {
    return null;
  }

  if (role === "viewer" || role === "signer" || role === "document_admin") {
    return role;
  }

  if (role === "editor") {
    return "document_admin";
  }

  return null;
}

export function legacyAccessRoleFromAuthority(authority: AuthorityLevel): LegacyAccessRole {
  // TEMP_MIGRATION_BRIDGE
  if (authority === "org_admin_override") {
    return "document_admin";
  }

  return authority;
}

export function canAccountClassPerform(accountClass: AccountClass | null | undefined, action: AccountAction) {
  if (!accountClass) {
    return false;
  }

  if (accountClass === "personal") {
    return action === "manage_billing" || action === "create_documents";
  }

  if (accountClass === "corporate_admin") {
    return true;
  }

  return action === "create_documents";
}
