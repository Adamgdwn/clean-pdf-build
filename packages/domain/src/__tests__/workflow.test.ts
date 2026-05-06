import { describe, expect, it } from "vitest";

import {
  areAllRequiredAssignedSigningFieldsComplete,
  deriveWorkflowState,
  getDocumentCompletionSummary,
  getDocumentSendReadiness,
  isDocumentSignable,
  isWorkflowOverdue,
  lockDocument,
  reopenDocument,
} from "../index";
import type { DocumentRecord } from "../schema";

const baseDocument: DocumentRecord = {
  id: "doc_1",
  name: "Demo agreement",
  fileName: "demo-agreement.pdf",
  storagePath: "user_owner/doc_1/demo-agreement.pdf",
  workspaceId: null,
  signaturePath: 1,
  status: "pending",
  deliveryMode: "self_managed",
  distributionTarget: null,
  lockPolicy: "document_admin_only",
  notifyOriginatorOnEachSignature: true,
  dueAt: null,
  retentionMode: "temporary",
  retentionDays: 30,
  purgeScheduledAt: null,
  purgedAt: null,
  purgedByUserId: null,
  purgeReason: null,
  workflowStatus: "active",
  workflowStatusReason: null,
  workflowStatusUpdatedAt: null,
  workflowStatusUpdatedByUserId: null,
  pageCount: 3,
  uploadedAt: "2026-03-30T18:00:00.000Z",
  uploadedByUserId: "user_owner",
  preparedAt: "2026-03-30T18:05:00.000Z",
  sentAt: "2026-03-30T18:10:00.000Z",
  completedAt: null,
  reopenedAt: null,
  reopenedByUserId: null,
  lockedAt: null,
  lockedByUserId: null,
  routingStrategy: "sequential",
  isScanned: true,
  isOcrComplete: true,
  isFieldDetectionComplete: true,
  sourceStorageBytes: 2048,
  exportStorageBytes: 0,
  exportSha256: null,
  latestChangeImpact: null,
  latestChangeImpactSummary: null,
  latestChangeImpactAt: null,
  access: [
    { userId: "user_owner", role: "document_admin" },
    { userId: "user_signer_1", role: "signer" },
    { userId: "user_signer_2", role: "signer" },
  ],
  signers: [
    {
      id: "signer_1",
      userId: "user_signer_1",
      name: "Signer One",
      email: "one@example.com",
      participantType: "external",
      required: true,
      routingStage: 1,
      signingOrder: 1,
    },
    {
      id: "signer_2",
      userId: "user_signer_2",
      name: "Signer Two",
      email: "two@example.com",
      participantType: "external",
      required: true,
      routingStage: 1,
      signingOrder: 2,
    },
  ],
  fields: [
    {
      id: "field_1",
      page: 1,
      kind: "signature",
      label: "Primary signature",
      required: true,
      assigneeSignerId: "signer_1",
      source: "manual",
      x: 120,
      y: 640,
      width: 180,
      height: 42,
      value: "completed",
      appliedSavedSignatureId: null,
      completedAt: "2026-03-30T18:11:00.000Z",
      completedBySignerId: "signer_1",
    },
    {
      id: "field_2",
      page: 2,
      kind: "signature",
      label: "Counter-signature",
      required: true,
      assigneeSignerId: "signer_2",
      source: "manual",
      x: 120,
      y: 540,
      width: 180,
      height: 42,
      value: null,
      appliedSavedSignatureId: null,
      completedAt: null,
      completedBySignerId: null,
    },
  ],
  versions: [],
  auditTrail: [],
  notifications: [],
};

describe("workflow rules", () => {
  it("keeps a document signable while required assigned signature fields remain", () => {
    expect(areAllRequiredAssignedSigningFieldsComplete(baseDocument)).toBe(false);
    expect(isDocumentSignable(baseDocument)).toBe(true);
    expect(deriveWorkflowState(baseDocument)).toBe("partially_signed");
  });

  it("marks a document complete only after all required assigned signing fields finish", () => {
    const fullySigned: DocumentRecord = {
      ...baseDocument,
      fields: baseDocument.fields.map((field) =>
        field.id === "field_2"
          ? {
              ...field,
              value: "completed",
              completedAt: "2026-03-30T18:12:00.000Z",
              completedBySignerId: "signer_2",
            }
          : field,
      ),
    };

    expect(areAllRequiredAssignedSigningFieldsComplete(fullySigned)).toBe(true);
    expect(isDocumentSignable(fullySigned)).toBe(false);
    expect(deriveWorkflowState(fullySigned)).toBe("completed");
    expect(getDocumentCompletionSummary(fullySigned)).toEqual({
      requiredAssignedFields: 2,
      completedRequiredAssignedFields: 2,
      remainingRequiredAssignedFields: 0,
    });
  });

  it("supports an explicit lock separate from completion", () => {
    const locked = lockDocument(baseDocument, "user_owner", "2026-03-30T18:15:00.000Z");

    expect(isDocumentSignable(locked)).toBe(false);
    expect(deriveWorkflowState(locked)).toBe("partially_signed");
    expect(locked.lockedByUserId).toBe("user_owner");
  });

  it("pauses signing when changes are requested", () => {
    const paused: DocumentRecord = {
      ...baseDocument,
      workflowStatus: "changes_requested",
      workflowStatusReason: "Please correct the rate section.",
      workflowStatusUpdatedAt: "2026-03-30T18:13:00.000Z",
      workflowStatusUpdatedByUserId: "user_signer_1",
    };

    expect(isDocumentSignable(paused)).toBe(false);
    expect(deriveWorkflowState(paused)).toBe("partially_signed");
  });

  it("flags an active sent workflow as overdue after the due date passes", () => {
    const overdue: DocumentRecord = {
      ...baseDocument,
      dueAt: "2026-03-30T18:09:00.000Z",
      workflowStatus: "active",
    };

    expect(isWorkflowOverdue(overdue, "2026-03-30T18:20:00.000Z")).toBe(true);
  });

  it("reopens a document and makes it signable again", () => {
    const reopened = reopenDocument(
      lockDocument(baseDocument, "user_owner", "2026-03-30T18:15:00.000Z"),
      "user_owner",
      "2026-03-30T18:20:00.000Z",
    );

    expect(isDocumentSignable(reopened)).toBe(true);
    expect(deriveWorkflowState(reopened)).toBe("reopened");
    expect(reopened.reopenedByUserId).toBe("user_owner");
  });

  it("requires signers and assigned required signing fields before send", () => {
    const notReady: DocumentRecord = {
      ...baseDocument,
      signers: [],
      fields: [
        {
          ...baseDocument.fields[0],
          completedAt: null,
          completedBySignerId: null,
          value: null,
          assigneeSignerId: null,
        },
      ],
      sentAt: null,
    };

    expect(getDocumentSendReadiness(notReady)).toEqual({
      ready: false,
      blockers: [
        "Add at least one participant before sending.",
        "Assign every required signature, initial, or approval field to a participant before sending.",
      ],
    });
  });

  it("requires signing order for sequential routing", () => {
    const notReady: DocumentRecord = {
      ...baseDocument,
      sentAt: null,
      fields: [
        {
          ...baseDocument.fields[0],
          completedAt: null,
          completedBySignerId: null,
          value: null,
        },
      ],
      signers: [
        {
          ...baseDocument.signers[0],
          signingOrder: null,
        },
      ],
    };

    expect(getDocumentSendReadiness(notReady)).toEqual({
      ready: false,
      blockers: [
        "Set an action order for each participant assigned to a required signature, initial, or approval field.",
      ],
    });
  });

  it("marks a prepared signing workflow ready to send", () => {
    const ready: DocumentRecord = {
      ...baseDocument,
      sentAt: null,
      fields: [
        {
          ...baseDocument.fields[0],
          completedAt: null,
          completedBySignerId: null,
          value: null,
        },
      ],
      signers: [baseDocument.signers[0]],
    };

    expect(getDocumentSendReadiness(ready)).toEqual({
      ready: true,
      blockers: [],
    });
  });

  it("treats internal-use-only workflows as standard in-app signing flows", () => {
    const ready: DocumentRecord = {
      ...baseDocument,
      deliveryMode: "internal_use_only",
      sentAt: null,
      fields: [
        {
          ...baseDocument.fields[0],
          completedAt: null,
          completedBySignerId: null,
          value: null,
        },
      ],
      signers: [baseDocument.signers[0]],
    };

    expect(getDocumentSendReadiness(ready)).toEqual({
      ready: true,
      blockers: [],
    });
    expect(deriveWorkflowState(ready)).toBe("prepared");
  });

  it("treats required approval fields as completion blockers", () => {
    const approvalDocument: DocumentRecord = {
      ...baseDocument,
      sentAt: null,
      fields: [
        {
          ...baseDocument.fields[0],
          id: "field_approval",
          kind: "approval",
          label: "Manager approval",
          value: null,
          completedAt: null,
          completedBySignerId: null,
        },
      ],
      signers: [
        {
          ...baseDocument.signers[0],
          signingOrder: 1,
        },
      ],
    };

    expect(getDocumentSendReadiness(approvalDocument)).toEqual({
      ready: true,
      blockers: [],
    });
    expect(isDocumentSignable(approvalDocument)).toBe(true);
    expect(deriveWorkflowState(approvalDocument)).toBe("prepared");

    const approved: DocumentRecord = {
      ...approvalDocument,
      fields: approvalDocument.fields.map((field) => ({
        ...field,
        value: "approved",
        completedAt: "2026-03-30T18:13:00.000Z",
        completedBySignerId: "signer_1",
      })),
    };

    expect(areAllRequiredAssignedSigningFieldsComplete(approved)).toBe(true);
    expect(deriveWorkflowState(approved)).toBe("completed");
  });
});
