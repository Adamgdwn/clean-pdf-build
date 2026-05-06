import type { DocumentRecord } from "@clean-pdf/domain";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

export type WorkflowDocument = DocumentRecord & {
  currentUserRole: "document_admin" | "editor" | "signer" | "viewer" | null;
  currentUserIsSigner: boolean;
  currentUserSignerId: string | null;
  accessParticipants: Array<{
    userId: string;
    role: "document_admin" | "editor" | "signer" | "viewer";
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
  organization: {
    id: string;
    name: string;
    slug: string;
    accountType: "individual" | "corporate";
    membershipRole: "account_admin" | "admin" | "member" | "billing_admin" | null;
    memberCount: number;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    workspaceType: "personal" | "team";
    membershipRole: "account_admin" | "admin" | "member" | "billing_admin" | null;
    internalMemberCount: number;
  };
  subscription: {
    planKey: string;
    status: string;
    seatCount: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: string | null;
  } | null;
  /** Prepaid external signer token balance (all-time credits minus all-time usage). */
  externalTokens: {
    available: number;
    used: number;
    purchased: number;
  };
  storage: {
    usedBytes: number;
    activeDocumentCount: number;
    temporaryDocumentCount: number;
    retainedDocumentCount: number;
    purgeScheduledCount: number;
    purgedDocumentCount: number;
  };
  plans: Array<{
    key: string;
    name: string;
    /** Price in CAD whole dollars per seat for the selected billing interval. */
    priceCad: number;
    billingInterval: "month" | "year";
    /** Normalized monthly equivalent for admin metrics and comparisons. */
    monthlyEquivalentPriceCad: number;
    includedInternalSeats: number;
    includedCompletedDocs: number;
    includedOcrPages: number;
    includedStorageGb: number;
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
  verification: {
    required: boolean;
    verified: boolean;
    verifiedAt: string | null;
    codeSentAt: string | null;
    codeExpiresAt: string | null;
    retryAvailableAt: string | null;
    attemptsRemaining: number;
    emailHint: string;
  };
};

export type WorkspaceInviteDetails = {
  invitation: {
    email: string;
    role: string;
    expiresAt: string;
    acceptedAt: string | null;
    status: "pending" | "accepted" | "expired";
    workspace: {
      id: string;
      name: string;
      slug: string;
    } | null;
  };
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

export type SignatureEvent = {
  id: string;
  documentId: string;
  signerType: "internal" | "external";
  signerEmail: string | null;
  signerUserId: string | null;
  eventType: "sent" | "viewed" | "signed" | "rejected" | "verified";
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  companyName: string | null;
  accountType: "individual" | "corporate";
  workspaceName: string | null;
  jobTitle: string | null;
  locale: string | null;
  timezone: string | null;
  marketingOptIn: boolean;
  productUpdatesOptIn: boolean;
  lastSeenAt: string | null;
  onboardingCompletedAt: string | null;
  profileKind: "easydraft_user" | "easydraft_staff";
};

export type AdminOverview = {
  metrics: {
    totalUsers: number;
    totalWorkspaces: number;
    totalDocuments: number;
    sentDocuments: number;
    completedDocuments: number;
    pendingNotifications: number;
    failedNotifications: number;
    oldestPendingNotificationAt: string | null;
    queuedProcessingJobs: number;
    oldestQueuedProcessingAt: string | null;
    billingCustomers: number;
    estimatedMrrUsd: number;
  };
  recentSubscriptions: Array<{
    id: string;
    workspace_id: string;
    billing_plan_key: string;
    status: string;
    seat_count: number;
    current_period_end: string | null;
    updated_at: string;
  }>;
  recentWorkspaces: Array<{
    id: string;
    name: string;
    slug: string;
    workspace_type: string;
    owner_user_id: string;
    billing_email: string | null;
    created_at: string;
  }>;
};

export type AdminFeedbackRequest = {
  id: string;
  feedbackType: "bug_report" | "feature_request";
  title: string;
  details: string;
  requesterEmail: string;
  requesterUserId: string | null;
  source: string;
  requestedPath: string | null;
  status: "new" | "acknowledged" | "planned" | "in_progress" | "closed";
  priority: "low" | "medium" | "high";
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  updatedByUserId: string | null;
  updatedByDisplayName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceTeamMember = {
  userId: string;
  role: string;
  displayName: string;
  email: string | null;
  isCurrentUser: boolean;
  joinedAt: string;
};

export type WorkspaceTeamInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

export type WorkspaceTeam = {
  organization: {
    id: string;
    name: string;
    slug: string;
    accountType: "individual" | "corporate";
    membershipRole: "account_admin" | "admin" | "member" | "billing_admin" | null;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  };
  members: WorkspaceTeamMember[];
  pendingInvitations: WorkspaceTeamInvitation[];
};

export type WorkspaceOption = {
  id: string;
  name: string;
  slug: string;
  workspaceType: "personal" | "team";
  role: "account_admin" | "admin" | "member" | "billing_admin" | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    accountType: "individual" | "corporate";
    role: "account_admin" | "admin" | "member" | "billing_admin" | null;
  } | null;
};

export type WorkspaceDirectory = {
  currentWorkspace: WorkspaceOption;
  workspaces: WorkspaceOption[];
};

export type OrganizationAdminOverview = {
  account: {
    id: string;
    name: string;
    slug: string;
    accountType: "individual" | "corporate";
    status: "active" | "payment_required" | "suspended" | "closing" | "closed";
    billingEmail: string | null;
    primaryAccountAdminUserId: string;
    membershipRole: "account_admin" | "admin" | "member" | "billing_admin" | null;
    suspendedAt: string | null;
    closingRequestedAt: string | null;
    closedAt: string | null;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    workspaceType: string;
  };
  authority: {
    canManagePeople: boolean;
    canManageBilling: boolean;
    canChangePrimaryAccountAdmin: boolean;
    canCloseAccount: boolean;
  };
  licenseSummary: {
    purchasedSeats: number;
    occupiedSeats: number;
    assignedSeats: number;
    invitedSeats: number;
    suspendedSeats: number;
    availableSeats: number;
    overAssignedBy: number;
  };
  tokens: {
    available: number;
    purchased: number;
    used: number;
  };
  subscription: {
    id: string;
    planKey: string;
    status: string;
    seatCount: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: string | null;
    updatedAt: string;
  } | null;
  members: Array<{
    userId: string;
    displayName: string;
    email: string | null;
    role: "account_admin" | "admin" | "member" | "billing_admin";
    licenseStatus: "assigned" | "invited" | "suspended" | "revoked";
    joinedAt: string;
    isPrimaryAccountAdmin: boolean;
    isCurrentUser: boolean;
  }>;
  pendingInvitations: Array<{
    id: string;
    email: string;
    role: "account_admin" | "admin" | "member" | "billing_admin";
    licenseStatus: "assigned" | "invited" | "suspended" | "revoked";
    expiresAt: string;
    createdAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    summary: string;
    metadata: Record<string, string | number | boolean | null>;
    actorUserId: string | null;
    createdAt: string;
  }>;
};

export type AdminManagedUser = {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  companyName: string | null;
  accountType: "individual" | "corporate" | null;
  workspaceName: string | null;
  profileKind: "easydraft_user" | "easydraft_staff" | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  status: "confirmed" | "pending_confirmation";
  isPlatformAdmin: boolean;
  canDelete: boolean;
  workspaceCount: number;
  documentCount: number;
  privilegeLabels: string[];
};

export type DigitalSignatureProfile = {
  id: string;
  label: string;
  titleText: string | null;
  signerName: string;
  signerEmail: string | null;
  organizationName: string | null;
  signingReason: string | null;
  provider: "easy_draft_remote" | "qualified_remote" | "organization_hsm";
  assuranceLevel: string;
  status: "setup_required" | "requested" | "verified" | "rejected";
  certificateFingerprint: string | null;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
};
