import type { DocumentRecord, Field, WorkflowState } from "./schema.js";

const signingFieldKinds = new Set(["signature", "initial"]);
const actionableFieldKinds = new Set(["signature", "initial", "approval"]);

export function isSigningField(field: Field) {
  return signingFieldKinds.has(field.kind);
}

export function isActionField(field: Field) {
  return actionableFieldKinds.has(field.kind);
}

export function isApprovalField(field: Field) {
  return field.kind === "approval";
}

export function getRequiredAssignedActionFields(document: DocumentRecord) {
  return document.fields.filter(
    (field) => field.required && isActionField(field) && field.assigneeSignerId,
  );
}

export function getRequiredAssignedSigningFields(document: DocumentRecord) {
  return getRequiredAssignedActionFields(document);
}

export function areAllRequiredAssignedActionFieldsComplete(document: DocumentRecord) {
  const requiredFields = getRequiredAssignedActionFields(document);

  if (requiredFields.length === 0) {
    return false;
  }

  return requiredFields.every((field) => Boolean(field.completedAt));
}

export function areAllRequiredAssignedSigningFieldsComplete(document: DocumentRecord) {
  return areAllRequiredAssignedActionFieldsComplete(document);
}

export function hasStartedSigning(document: DocumentRecord) {
  return document.fields.some(
    (field) => isActionField(field) && field.required && Boolean(field.completedAt),
  );
}

export function isDocumentLocked(document: DocumentRecord) {
  return Boolean(document.lockedAt);
}

export function isDocumentSignable(document: DocumentRecord) {
  if (isDocumentLocked(document)) {
    return false;
  }

  return !areAllRequiredAssignedActionFieldsComplete(document);
}

export function deriveWorkflowState(document: DocumentRecord): WorkflowState {
  if (areAllRequiredAssignedActionFieldsComplete(document)) {
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
  const requiredFields = getRequiredAssignedActionFields(document);
  const completedFields = requiredFields.filter((field) => Boolean(field.completedAt));

  return {
    requiredAssignedFields: requiredFields.length,
    completedRequiredAssignedFields: completedFields.length,
    remainingRequiredAssignedFields: requiredFields.length - completedFields.length,
  };
}

export function getDocumentSendReadiness(document: DocumentRecord) {
  const requiredActionFields = document.fields.filter((field) => field.required && isActionField(field));
  const signerIds = new Set(document.signers.map((signer) => signer.id));
  const signerOrderById = new Map(
    document.signers.map((signer) => [signer.id, signer.signingOrder]),
  );
  const blockers: string[] = [];

  if (document.lockedAt) {
    blockers.push("Reopen the document before sending it again.");
  }

  if (document.completedAt) {
    blockers.push("This document is already complete. Reopen it only if more signing is required.");
  }

  if (document.signers.length === 0) {
    blockers.push("Add at least one signer before sending.");
  }

  if (requiredActionFields.length === 0) {
    blockers.push("Add at least one required signature, initial, or approval field before sending.");
  }

  if (requiredActionFields.some((field) => !field.assigneeSignerId)) {
    blockers.push(
      "Assign every required signature, initial, or approval field to a signer before sending.",
    );
  }

  if (
    requiredActionFields.some(
      (field) => field.assigneeSignerId && !signerIds.has(field.assigneeSignerId),
    )
  ) {
    blockers.push("Reassign any required action fields that point to a missing signer.");
  }

  if (
    document.routingStrategy === "sequential" &&
    requiredActionFields.some(
      (field) =>
        field.assigneeSignerId &&
        signerIds.has(field.assigneeSignerId) &&
        !signerOrderById.get(field.assigneeSignerId),
    )
  ) {
    blockers.push(
      "Set a signing order for each signer assigned to a required signature, initial, or approval field.",
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
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
    completedAt: areAllRequiredAssignedActionFieldsComplete(document)
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
