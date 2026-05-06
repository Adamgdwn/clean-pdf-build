import type { AccessRole } from "./schema.js";

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

const permissionMatrix: Record<AccessRole, DocumentAction[]> = {
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
  editor: [
    "edit_document",
    "manage_editor_history",
    "manage_signers",
    "manage_workflow",
    "send_document",
    "view_audit_trail",
    "export_document",
  ],
  signer: ["complete_assigned_field", "request_workflow_changes", "reject_workflow", "view_audit_trail"],
  viewer: ["view_audit_trail"],
};

export function canPerformDocumentAction(role: AccessRole, action: DocumentAction) {
  return permissionMatrix[role].includes(action);
}
