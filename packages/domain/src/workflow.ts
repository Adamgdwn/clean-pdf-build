import type { DocumentRecord, Field, WorkflowState } from "./schema.js";

const signingFieldKinds = new Set(["signature", "initial"]);
const actionableFieldKinds = new Set(["signature", "initial", "approval"]);

function fieldAssigneeId(field: Field) {
  return field.assigneeParticipantId ?? field.assigneeSignerId;
}

function signerAssignmentId(signer: DocumentRecord["signers"][number]) {
  return signer.participantId ?? signer.id;
}

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
    (field) => field.required && isActionField(field) && fieldAssigneeId(field),
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

export function isWorkflowBlocked(document: DocumentRecord) {
  return (
    document.workflowStatus === "changes_requested" ||
    document.workflowStatus === "rejected" ||
    document.workflowStatus === "canceled"
  );
}

export function isWorkflowOverdue(document: DocumentRecord, now = new Date().toISOString()) {
  if (!document.sentAt || !document.dueAt || document.completedAt || isDocumentLocked(document)) {
    return false;
  }

  if (isWorkflowBlocked(document)) {
    return false;
  }

  return document.dueAt < now;
}

export function isDocumentSignable(document: DocumentRecord) {
  if (isDocumentLocked(document)) {
    return false;
  }

  if (isWorkflowBlocked(document)) {
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
  const signerIds = new Set(document.signers.map(signerAssignmentId));
  const signerOrderById = new Map(
    document.signers.map((signer) => [signerAssignmentId(signer), signer.signingOrder]),
  );
  const blockers: string[] = [];

  if (document.lockedAt) {
    blockers.push("Reopen the document before sending it again.");
  }

  if (document.completedAt) {
    blockers.push("This document is already complete. Reopen it only if more workflow actions are required.");
  }

  if (document.signers.length === 0) {
    blockers.push("Add at least one participant before sending.");
  }

  if (requiredActionFields.length === 0) {
    blockers.push("Add at least one required signature, initial, or approval field before sending.");
  }

  if (requiredActionFields.some((field) => !fieldAssigneeId(field))) {
    blockers.push(
      "Assign every required signature, initial, or approval field to a participant before sending.",
    );
  }

  if (
    requiredActionFields.some(
      (field) => {
        const assigneeId = fieldAssigneeId(field);
        return assigneeId && !signerIds.has(assigneeId);
      },
    )
  ) {
    blockers.push("Reassign any required action fields that point to a missing participant.");
  }

  if (
    document.routingStrategy === "sequential" &&
    requiredActionFields.some(
      (field) => {
        const assigneeId = fieldAssigneeId(field);
        return assigneeId && signerIds.has(assigneeId) && !signerOrderById.get(assigneeId);
      },
    )
  ) {
    blockers.push(
      "Set an action order for each participant assigned to a required signature, initial, or approval field.",
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function getEligibleSignerIdsForCurrentRouting(document: DocumentRecord) {
  const pendingFields = getRequiredAssignedActionFields(document).filter((field) => !field.completedAt);

  if (pendingFields.length === 0) {
    return [] as string[];
  }

  const signerByAssignmentId = new Map(
    document.signers.map((signer) => [signerAssignmentId(signer), signer]),
  );
  const pendingFieldsWithSigner = pendingFields
    .map((field) => ({
      field,
      signer: signerByAssignmentId.get(fieldAssigneeId(field) ?? ""),
    }))
    .filter((entry): entry is { field: Field; signer: DocumentRecord["signers"][number] } =>
      Boolean(entry.signer),
    );

  if (pendingFieldsWithSigner.length === 0) {
    return [] as string[];
  }

  const nextStage = Math.min(
    ...pendingFieldsWithSigner.map((entry) => entry.signer.routingStage ?? 1),
  );
  const stagePendingFields = pendingFieldsWithSigner.filter(
    (entry) => (entry.signer.routingStage ?? 1) === nextStage,
  );

  if (document.routingStrategy === "parallel") {
    return [
      ...new Set(stagePendingFields.map((entry) => fieldAssigneeId(entry.field)).filter(Boolean)),
    ] as string[];
  }

  const signerOrderById = new Map(
    document.signers.map((signer) => [
      signerAssignmentId(signer),
      signer.signingOrder ?? Number.MAX_SAFE_INTEGER,
    ]),
  );
  const nextOrder = Math.min(
    ...stagePendingFields.map(
      (entry) => signerOrderById.get(fieldAssigneeId(entry.field) ?? "") ?? Number.MAX_SAFE_INTEGER,
    ),
  );

  return [
    ...new Set(
      stagePendingFields
        .filter(
          (entry) =>
            (signerOrderById.get(fieldAssigneeId(entry.field) ?? "") ?? Number.MAX_SAFE_INTEGER) ===
            nextOrder,
        )
        .map((entry) => fieldAssigneeId(entry.field))
        .filter(Boolean),
    ),
  ] as string[];
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
