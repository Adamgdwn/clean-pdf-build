import type { DocumentRecord, Field, WorkflowState } from "./schema.js";

const signingFieldKinds = new Set(["signature", "initial"]);

export function isSigningField(field: Field) {
  return signingFieldKinds.has(field.kind);
}

export function getRequiredAssignedSigningFields(document: DocumentRecord) {
  return document.fields.filter(
    (field) => field.required && isSigningField(field) && field.assigneeSignerId,
  );
}

export function areAllRequiredAssignedSigningFieldsComplete(document: DocumentRecord) {
  const requiredFields = getRequiredAssignedSigningFields(document);

  if (requiredFields.length === 0) {
    return false;
  }

  return requiredFields.every((field) => Boolean(field.completedAt));
}

export function hasStartedSigning(document: DocumentRecord) {
  return document.fields.some(
    (field) => isSigningField(field) && field.required && Boolean(field.completedAt),
  );
}

export function isDocumentLocked(document: DocumentRecord) {
  return Boolean(document.lockedAt);
}

export function isDocumentSignable(document: DocumentRecord) {
  if (isDocumentLocked(document)) {
    return false;
  }

  return !areAllRequiredAssignedSigningFieldsComplete(document);
}

export function deriveWorkflowState(document: DocumentRecord): WorkflowState {
  if (areAllRequiredAssignedSigningFieldsComplete(document)) {
    return "completed";
  }

  if (document.reopenedAt) {
    return "reopened";
  }

  if (hasStartedSigning(document)) {
    return "partially_signed";
  }

  if (document.sentAt) {
    return "sent";
  }

  if (document.preparedAt || document.fields.length > 0) {
    return "prepared";
  }

  return "draft";
}

export function getDocumentCompletionSummary(document: DocumentRecord) {
  const requiredFields = getRequiredAssignedSigningFields(document);
  const completedFields = requiredFields.filter((field) => Boolean(field.completedAt));

  return {
    requiredAssignedFields: requiredFields.length,
    completedRequiredAssignedFields: completedFields.length,
    remainingRequiredAssignedFields: requiredFields.length - completedFields.length,
  };
}

export function completeField(
  document: DocumentRecord,
  fieldId: string,
  signerId: string,
  completedAt: string,
) {
  return {
    ...document,
    completedAt: areAllRequiredAssignedSigningFieldsComplete(document)
      ? document.completedAt
      : null,
    fields: document.fields.map((field) =>
      field.id === fieldId
        ? {
            ...field,
            value: field.value ?? "completed",
            completedAt,
            completedBySignerId: signerId,
          }
        : field,
    ),
  };
}

export function lockDocument(document: DocumentRecord, userId: string, lockedAt: string) {
  return {
    ...document,
    lockedAt,
    lockedByUserId: userId,
  };
}

export function reopenDocument(document: DocumentRecord, userId: string, reopenedAt: string) {
  return {
    ...document,
    lockedAt: null,
    lockedByUserId: null,
    reopenedAt,
    reopenedByUserId: userId,
  };
}
