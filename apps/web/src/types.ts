import type { DocumentRecord } from "@clean-pdf/domain";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

export type WorkflowDocument = DocumentRecord & {
  currentUserRole: "owner" | "editor" | "signer" | "viewer" | null;
  currentUserIsSigner: boolean;
  currentUserSignerId: string | null;
  accessParticipants: Array<{
    userId: string;
    role: "owner" | "editor" | "signer" | "viewer";
    displayName: string;
    email: string | null;
  }>;
  workflowState: string;
  operationalStatus: "active" | "changes_requested" | "rejected" | "canceled" | "overdue";
  isOverdue: boolean;
  waitingOn: {
    kind: "setup" | "participant" | "initiator" | "completed" | "rejected" | "canceled" | "none";
    summary: string;
    signerId: string | null;
    signerName: string | null;
    signerEmail: string | null;
    actionLabel: "signature" | "approval" | "action" | null;
    stage: number | null;
    dueAt: string | null;
    isOverdue: boolean;
  };
  eligibleSignerIds: string[];
  signable: boolean;
  completionSummary: {
    requiredAssignedFields: number;
    completedRequiredAssignedFields: number;
    remainingRequiredAssignedFields: number;
  };
  editorHistory: {
    currentIndex: number;
    latestIndex: number;
    canUndo: boolean;
    canRedo: boolean;
  };
};

export type BillingOverview = {
  billingMode: "live" | "placeholder";
  workspace: {
    id: string;
    name: string;
    slug: string;
    workspaceType: "personal" | "team";
    membershipRole: "owner" | "admin" | "member" | "billing_admin" | null;
    internalMemberCount: number;
  };
  subscription: {
    planKey: string;
    status: string;
    seatCount: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  signingTokens: {
    available: number;
    used: number;
    includedInPlan: number;
  };
  plans: Array<{
    key: string;
    name: string;
    monthlyPriceUsd: number;
    includedInternalSeats: number;
    includedCompletedDocs: number;
    includedOcrPages: number;
    includedStorageGb: number;
    includedSigningTokens: number;
  }>;
};

export type GuestSigningSession = {
  signerToken: string;
  signerId: string;
  signerEmail: string;
  signerName: string;
  documentId: string;
  document: WorkflowDocument;
  previewUrl: string | null;
};

export type SavedSignature = {
  id: string;
  label: string;
  titleText: string | null;
  signatureType: "typed" | "uploaded";
  typedText: string | null;
  storagePath: string | null;
  previewUrl: string | null;
  isDefault: boolean;
  createdAt: string;
};

export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  companyName: string | null;
  jobTitle: string | null;
  locale: string | null;
  timezone: string | null;
  marketingOptIn: boolean;
  productUpdatesOptIn: boolean;
  lastSeenAt: string | null;
};

export type DigitalSignatureProfile = {
  id: string;
  label: string;
  titleText: string | null;
  provider: "easy_draft_remote" | "qualified_remote" | "organization_hsm";
  assuranceLevel: string;
  status: "setup_required" | "requested" | "verified" | "rejected";
  certificateFingerprint: string | null;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
};
