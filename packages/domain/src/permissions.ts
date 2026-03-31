import type { AccessRole } from "./schema.js";

export type DocumentAction =
  | "edit_document"
  | "manage_signers"
  | "manage_access"
  | "send_document"
  | "complete_assigned_field"
  | "view_audit_trail"
  | "export_document"
  | "lock_document"
  | "reopen_document";

const permissionMatrix: Record<AccessRole, DocumentAction[]> = {
  owner: [
    "edit_document",
    "manage_signers",
    "manage_access",
    "send_document",
    "complete_assigned_field",
    "view_audit_trail",
    "export_document",
    "lock_document",
    "reopen_document",
  ],
  editor: [
    "edit_document",
    "manage_signers",
    "send_document",
    "view_audit_trail",
    "export_document",
  ],
  signer: ["complete_assigned_field", "view_audit_trail"],
  viewer: ["view_audit_trail"],
};

export function canPerformDocumentAction(role: AccessRole, action: DocumentAction) {
  return permissionMatrix[role].includes(action);
}
