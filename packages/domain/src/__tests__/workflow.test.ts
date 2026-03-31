import { describe, expect, it } from "vitest";

import {
  areAllRequiredAssignedSigningFieldsComplete,
  deriveWorkflowState,
  getDocumentCompletionSummary,
  isDocumentSignable,
  lockDocument,
  reopenDocument,
} from "../index";
import type { DocumentRecord } from "../schema";

const baseDocument: DocumentRecord = {
  id: "doc_1",
  name: "Demo agreement",
  fileName: "demo-agreement.pdf",
  storagePath: "user_owner/doc_1/demo-agreement.pdf",
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
  access: [
    { userId: "user_owner", role: "owner" },
    { userId: "user_signer_1", role: "signer" },
    { userId: "user_signer_2", role: "signer" },
  ],
  signers: [
    {
      id: "signer_1",
      userId: "user_signer_1",
      name: "Signer One",
      email: "one@example.com",
      required: true,
      signingOrder: 1,
    },
    {
      id: "signer_2",
      userId: "user_signer_2",
      name: "Signer Two",
      email: "two@example.com",
      required: true,
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
      completedAt: null,
      completedBySignerId: null,
    },
  ],
  versions: [],
  auditTrail: [],
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
});
