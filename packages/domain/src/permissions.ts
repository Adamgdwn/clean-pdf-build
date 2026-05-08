import { authorityFromLegacyAccessRole } from "./target-model.js";
import type { AccessRole } from "./schema.js";
import type { AuthorityLevel } from "./target-model.js";

export type DocumentAction =
  | "edit_document"
  | "manage_editor_history"
  | "manage_signers"
  | "manage_access"
  | "manage_workflow"
  | "send_document"
  | "complete_assigned_field"
  | "request_workflow_changes"
  | "reject_workflow"
  | "view_audit_trail"
  | "export_document"
  | "delete_document"
  | "lock_document"
  | "reopen_document";

const authorityPermissionMatrix: Record<AuthorityLevel, DocumentAction[]> = {
  document_admin: [
    "edit_document",
    "manage_editor_history",
    "manage_signers",
    "manage_access",
    "manage_workflow",
    "send_document",
    "view_audit_trail",
    "export_document",
    "delete_document",
    "lock_document",
    "reopen_document",
  ],
  org_admin_override: [
    "edit_document",
    "manage_editor_history",
    "manage_signers",
    "manage_access",
    "manage_workflow",
    "send_document",
    "view_audit_trail",
    "export_document",
    "delete_document",
    "lock_document",
    "reopen_document",
  ],
  signer: ["complete_assigned_field", "request_workflow_changes", "reject_workflow", "view_audit_trail"],
  viewer: ["view_audit_trail"],
};

export function canPerformDocumentAction(authority: AuthorityLevel, action: DocumentAction) {
  return authorityPermissionMatrix[authority].includes(action);
}

export function canPerformDocumentActionForLegacyRole(role: AccessRole, action: DocumentAction) {
  // TEMP_MIGRATION_BRIDGE
  const authority = authorityFromLegacyAccessRole(role);
  return authority ? canPerformDocumentAction(authority, action) : false;
}
