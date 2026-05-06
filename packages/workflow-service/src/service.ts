import {
  canPerformDocumentAction,
  deriveWorkflowState,
  getDocumentCompletionSummary,
  getDocumentSendReadiness,
  isDocumentSignable,
  isWorkflowOverdue,
  type AccessRole,
  type AuditEvent,
  type DeliveryMode,
  type DocumentChangeImpact,
  type DocumentRecord,
  type DocumentNotification,
  type DocumentRetentionMode,
  type DocumentVersion,
  type Field,
  type LockPolicy,
  type ParticipantType,
  type SavedSignature,
  type SignaturePath,
  type SignatureStatus,
  type Signer,
  type User,
  type WorkflowOperationalStatus,
} from "../../domain/src/index.js";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import { SignPdf } from "@signpdf/signpdf";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import forge from "node-forge";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

import {
  getCanonicalAppOrigin,
  isCertificateSigningEnabled,
  readServerEnv,
  shouldRequireEmailDelivery,
  shouldRequireStripe,
} from "./env.js";
import { AppError } from "./errors.js";
import {
  buildSigningVerificationEmail,
  deliverNotificationEmail,
  getConfiguredNotificationEmailProvider,
} from "./notifications.js";
import {
  deriveUsername,
  inferAccountType,
  inferCompanyName,
  inferProfileKind,
  type AccountType,
  type ProfileKind,
} from "./profile-identity.js";
import { createAuthClient, createServiceRoleClient } from "./supabase.js";
import { getWorkspaceSigningTokenBalance } from "./billing.js";

type DocumentRow = {
  id: string;
  name: string;
  file_name: string;
  storage_path: string;
  workspace_id: string | null;
  signature_path: SignaturePath;
  status: SignatureStatus;
  editor_history_index: number;
  delivery_mode: DeliveryMode;
  distribution_target: string | null;
  lock_policy: LockPolicy;
  notify_originator_on_each_signature: boolean;
  due_at: string | null;
  retention_mode: DocumentRetentionMode;
  retention_days: number;
  purge_scheduled_at: string | null;
  purged_at: string | null;
  purged_by_user_id: string | null;
  purge_reason: string | null;
  workflow_status: WorkflowOperationalStatus;
  workflow_status_reason: string | null;
  workflow_status_updated_at: string | null;
  workflow_status_updated_by_user_id: string | null;
  page_count: number | null;
  uploaded_at: string;
  uploaded_by_user_id: string;
  prepared_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  reopened_at: string | null;
  reopened_by_user_id: string | null;
  locked_at: string | null;
  locked_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
  routing_strategy: "sequential" | "parallel";
  is_scanned: boolean;
  is_ocr_complete: boolean;
  is_field_detection_complete: boolean;
  source_storage_bytes: number;
  export_storage_bytes: number;
  export_sha256: string | null;
  latest_change_impact: DocumentChangeImpact | null;
  latest_change_impact_summary: string | null;
  latest_change_impact_at: string | null;
};

type DocumentAccessRow = {
  document_id: string;
  user_id: string;
  role: AccessRole;
};

type DocumentInviteRow = {
  id: string;
  document_id: string;
  email: string;
  role: AccessRole;
  accepted_at: string | null;
};

type SignerRow = {
  id: string;
  document_id: string;
  user_id: string | null;
  name: string;
  email: string;
  participant_type: ParticipantType;
  required: boolean;
  routing_stage: number;
  signing_order: number | null;
};

type SignatureEventInsert = {
  document_id: string;
  signer_type: ParticipantType;
  signer_email: string | null;
  signer_user_id: string | null;
  event_type: "sent" | "viewed" | "signed" | "rejected" | "verified";
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, string | number | boolean | null>;
};

type DocumensoRecipient = {
  id: number;
  email: string;
  name: string;
  role: "SIGNER" | "APPROVER" | "VIEWER" | "CC" | "ASSISTANT";
  token?: string;
  signingUrl?: string;
  signingOrder?: number | null;
  signedAt?: string | null;
  readStatus?: "NOT_OPENED" | "OPENED";
  signingStatus?: "NOT_SIGNED" | "SIGNED" | "REJECTED";
  sendStatus?: "NOT_SENT" | "SENT";
  rejectionReason?: string | null;
};

type DocumensoEnvelopeItem = {
  id: string;
  title: string;
  order: number;
};

type DocumensoEnvelope = {
  id: string;
  externalId?: string | null;
  title: string;
  status: "DRAFT" | "PENDING" | "COMPLETED" | "REJECTED";
  completedAt?: string | null;
  recipients?: DocumensoRecipient[];
  envelopeItems?: DocumensoEnvelopeItem[];
};

type DocumensoWebhookPayload = {
  event:
    | "DOCUMENT_CREATED"
    | "DOCUMENT_SENT"
    | "DOCUMENT_OPENED"
    | "DOCUMENT_SIGNED"
    | "DOCUMENT_RECIPIENT_COMPLETED"
    | "DOCUMENT_COMPLETED"
    | "DOCUMENT_REJECTED"
    | "DOCUMENT_CANCELLED"
    | "DOCUMENT_REMINDER_SENT";
  payload: {
    id: string | number;
    externalId?: string | null;
    title: string;
    status: "DRAFT" | "PENDING" | "COMPLETED" | "REJECTED";
    completedAt?: string | null;
    recipients?: DocumensoRecipient[];
    envelopeItems?: DocumensoEnvelopeItem[];
  };
  createdAt: string;
  webhookEndpoint: string;
};

type FieldRow = {
  id: string;
  document_id: string;
  page: number;
  kind: Field["kind"];
  label: string;
  required: boolean;
  assignee_signer_id: string | null;
  source: "manual" | "auto_detected";
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  applied_saved_signature_id: string | null;
  completed_at: string | null;
  completed_by_signer_id: string | null;
};

type DocumentVersionRow = {
  id: string;
  document_id: string;
  label: string;
  created_at: string;
  created_by_user_id: string;
  note: string;
  change_impact: DocumentChangeImpact | null;
  change_impact_summary: string | null;
};

type AuditEventRow = {
  id: string;
  document_id: string;
  type: AuditEvent["type"];
  created_at: string;
  actor_user_id: string;
  summary: string;
  metadata: Record<string, string | number | boolean | null> | null;
};

type SignatureEventRow = {
  id: string;
  document_id: string;
  signer_type: ParticipantType;
  signer_email: string | null;
  signer_user_id: string | null;
  event_type: "sent" | "viewed" | "signed" | "rejected" | "verified";
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  document_id: string;
  event_type: "signature_request" | "signature_progress" | "workflow_update";
  channel: "email" | "in_app";
  status: "queued" | "sent" | "failed" | "skipped";
  provider: string;
  recipient_email: string;
  recipient_user_id: string | null;
  recipient_signer_id: string | null;
  queued_at: string;
  delivered_at: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
};

type FeedbackRequestStatus = "new" | "acknowledged" | "planned" | "in_progress" | "closed";
type FeedbackRequestPriority = "low" | "medium" | "high";

type FeedbackRequestRow = {
  id: string;
  feedback_type: "bug_report" | "feature_request";
  title: string;
  details: string;
  requester_email: string;
  requester_user_id: string | null;
  source: string;
  requested_path: string | null;
  status: FeedbackRequestStatus;
  priority: FeedbackRequestPriority;
  owner_user_id: string | null;
  updated_by_user_id: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type SavedSignatureRow = {
  id: string;
  user_id: string;
  label: string;
  title_text: string | null;
  signature_type: "typed" | "uploaded";
  typed_text: string | null;
  storage_path: string | null;
  is_default: boolean;
  created_at: string;
};

type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  company_name: string | null;
  account_type: AccountType;
  workspace_name: string | null;
  job_title: string | null;
  locale: string | null;
  timezone: string | null;
  marketing_opt_in: boolean;
  product_updates_opt_in: boolean;
  last_seen_at: string | null;
  onboarding_completed_at: string | null;
  profile_kind: ProfileKind;
};

type EditorSnapshotRow = {
  id: string;
  document_id: string;
  history_index: number;
  action_key: string;
  label: string;
  fields: FieldRow[];
  created_by_user_id: string;
  created_at: string;
};

type DigitalSignatureProfileRow = {
  id: string;
  user_id: string;
  label: string;
  title_text: string | null;
  signer_name: string;
  signer_email: string | null;
  organization_name: string | null;
  signing_reason: string | null;
  provider: "easy_draft_remote" | "qualified_remote" | "organization_hsm";
  assurance_level: string;
  status: "setup_required" | "requested" | "verified" | "rejected";
  certificate_fingerprint: string | null;
  provider_reference: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  workspace_type: string;
  organization_id: string;
  owner_user_id: string;
  billing_email: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  account_type: "individual" | "corporate";
  owner_user_id: string;
  billing_email: string | null;
};

type WorkspaceMembershipWithWorkspaceRow = {
  role: string;
  workspaces: WorkspaceRow | WorkspaceRow[] | null;
};

type OrganizationMembershipRow = {
  organization_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "billing_admin";
  created_at: string;
};

type ProcessingJobType = "ocr" | "field_detection";
type ProcessingJobStatus = "queued" | "running" | "completed" | "failed";
type ProcessingJobRow = {
  id: string;
  document_id: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
};

type SigningTokenRow = {
  id: string;
  document_id: string;
  signer_id: string;
  signer_email: string;
  token: string;
  expires_at: string;
  voided_at: string | null;
  verification_code_hash: string | null;
  verification_code_sent_at: string | null;
  verification_code_expires_at: string | null;
  verification_attempt_count: number;
  verified_at: string | null;
  last_viewed_at: string | null;
  last_completed_at: string | null;
  void_reason: string | null;
};

type WorkflowDocumentResponse = DocumentRecord & {
  currentUserRole: AccessRole | null;
  currentUserIsSigner: boolean;
  currentUserSignerId: string | null;
  accessParticipants: Array<{
    userId: string;
    role: AccessRole;
    displayName: string;
    email: string | null;
  }>;
  workflowState: ReturnType<typeof deriveWorkflowState>;
  operationalStatus: WorkflowOperationalStatus | "overdue";
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
  completionSummary: ReturnType<typeof getDocumentCompletionSummary>;
  editorHistory: {
    currentIndex: number;
    latestIndex: number;
    canUndo: boolean;
    canRedo: boolean;
  };
};

type ProfileResponse = {
  profile: {
    id: string;
    email: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    companyName: string | null;
    accountType: AccountType;
    workspaceName: string | null;
    jobTitle: string | null;
    locale: string | null;
    timezone: string | null;
    marketingOptIn: boolean;
    productUpdatesOptIn: boolean;
    lastSeenAt: string | null;
    onboardingCompletedAt: string | null;
    profileKind: ProfileKind;
  };
};

type DigitalSignatureProfileResponse = {
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

type AdminManagedUserResponse = {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  companyName: string | null;
  accountType: AccountType | null;
  workspaceName: string | null;
  profileKind: ProfileKind | null;
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

export type AuthenticatedUser = User & {
  rawEmail: string;
  accountType?: "individual" | "corporate";
  workspaceName?: string;
  profileKind?: ProfileKind;
  profileMetadata?: Record<string, unknown>;
};

const DEFAULT_TEMPORARY_RETENTION_DAYS = 30;
const COMPLETED_DOCUMENT_PURGE_GRACE_DAYS = 7;
const CLOSED_WORKFLOW_PURGE_GRACE_DAYS = 7;
const STORAGE_PREFIX_QUERY_CHUNK_SIZE = 20;
const SIGNING_VERIFICATION_CODE_EXPIRY_MINUTES = 10;
const SIGNING_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
const SIGNING_VERIFICATION_MAX_ATTEMPTS = 5;

type DocumentStorageObjectRow = {
  bucket_id: string;
  name: string;
  metadata: Record<string, unknown> | null;
};

function addDaysToTimestamp(timestamp: string, days: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addMinutesToTimestamp(timestamp: string, minutes: number) {
  const date = new Date(timestamp);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function addSecondsToTimestamp(timestamp: string, seconds: number) {
  const date = new Date(timestamp);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString();
}

function getDocumentStoragePrefix(uploadedByUserId: string, documentId: string) {
  return `${uploadedByUserId}/${documentId}/`;
}

function getDocumentExportPath(uploadedByUserId: string, documentId: string) {
  return `${uploadedByUserId}/${documentId}/exports/latest.pdf`;
}

function getPreparedInternalSignaturePath(uploadedByUserId: string, documentId: string) {
  return `${uploadedByUserId}/${documentId}/internal/prepared.pdf`;
}

function getSignedInternalSignaturePath(uploadedByUserId: string, documentId: string) {
  return `${uploadedByUserId}/${documentId}/internal/signed.pdf`;
}

function getSignedDocumensoPath(uploadedByUserId: string, documentId: string) {
  return `${uploadedByUserId}/${documentId}/documenso/completed.pdf`;
}

function getSourceDocumentBucketCandidates(env: ReturnType<typeof readServerEnv>) {
  return Array.from(
    new Set([env.SUPABASE_UNSIGNED_DOCUMENT_BUCKET, env.SUPABASE_DOCUMENT_BUCKET]),
  );
}

function getDocumentArtifactBucketCandidates(env: ReturnType<typeof readServerEnv>) {
  return Array.from(
    new Set([
      env.SUPABASE_UNSIGNED_DOCUMENT_BUCKET,
      env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
      env.SUPABASE_DOCUMENT_BUCKET,
    ]),
  );
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function getDocumentStorageObjectBytes(row: DocumentStorageObjectRow) {
  const size = row.metadata?.size;
  const parsed = typeof size === "number" ? size : Number(size ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getRetentionScheduleForDocumentState(document: {
  retentionMode: DocumentRetentionMode;
  retentionDays: number;
  uploadedAt: string;
  sentAt: string | null;
  completedAt: string | null;
  workflowStatus: WorkflowOperationalStatus;
  workflowStatusUpdatedAt: string | null;
}) {
  if (document.retentionMode !== "temporary") {
    return null;
  }

  if (document.completedAt) {
    return addDaysToTimestamp(document.completedAt, COMPLETED_DOCUMENT_PURGE_GRACE_DAYS);
  }

  if (document.workflowStatus === "canceled" || document.workflowStatus === "rejected") {
    return addDaysToTimestamp(
      document.workflowStatusUpdatedAt ?? document.uploadedAt,
      CLOSED_WORKFLOW_PURGE_GRACE_DAYS,
    );
  }

  if (document.sentAt) {
    return null;
  }

  return addDaysToTimestamp(document.uploadedAt, document.retentionDays);
}

async function listDocumentStorageObjectsForPrefixes(prefixes: string[]) {
  const uniquePrefixes = [...new Set(prefixes.filter(Boolean))];

  if (uniquePrefixes.length === 0) {
    return [] as DocumentStorageObjectRow[];
  }

  const adminClient = createServiceRoleClient();
  const env = readServerEnv();
  const objectsByName = new Map<string, DocumentStorageObjectRow>();
  const candidateBuckets = getDocumentArtifactBucketCandidates(env);

  for (const bucketId of candidateBuckets) {
    for (const prefixChunk of chunkArray(uniquePrefixes, STORAGE_PREFIX_QUERY_CHUNK_SIZE)) {
      const orFilter = prefixChunk.map((prefix) => `name.like.${prefix}*`).join(",");
      const { data, error } = await adminClient
        .schema("storage")
        .from("objects")
        .select("bucket_id, name, metadata")
        .eq("bucket_id", bucketId)
        .or(orFilter);

      if (error) {
        throw new AppError(500, `Unable to inspect document storage: ${error.message}`);
      }

      for (const row of (data ?? []) as DocumentStorageObjectRow[]) {
        objectsByName.set(`${row.bucket_id}:${row.name}`, row);
      }
    }
  }

  return [...objectsByName.values()];
}

async function purgeDocumentStorageArtifactsForPrefixes(prefixes: string[]) {
  const objectRows = await listDocumentStorageObjectsForPrefixes(prefixes);

  if (objectRows.length === 0) {
    return {
      removedBytes: 0,
      removedPaths: [] as string[],
    };
  }

  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const objectNamesByBucket = new Map<string, string[]>();

  for (const row of objectRows) {
    const names = objectNamesByBucket.get(row.bucket_id) ?? [];
    names.push(row.name);
    objectNamesByBucket.set(row.bucket_id, names);
  }

  for (const [bucketId, objectNames] of objectNamesByBucket.entries()) {
    const { error } = await adminClient.storage.from(bucketId).remove(objectNames);

    if (error) {
      throw new AppError(500, `Unable to remove document storage artifacts: ${error.message}`);
    }
  }

  return {
    removedBytes: objectRows.reduce((sum, row) => sum + getDocumentStorageObjectBytes(row), 0),
    removedPaths: objectRows.map((row) => `${row.bucket_id}/${row.name}`),
  };
}

const createDocumentInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  fileName: z.string().min(1).max(200),
  storagePath: z.string().min(1),
  fileSize: z.number().int().nonnegative().default(0),
  signaturePath: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  deliveryMode: z.enum(["self_managed", "internal_use_only", "platform_managed"]).default("self_managed"),
  distributionTarget: z.string().trim().max(200).nullable().default(null),
  lockPolicy: z
    .enum(["owner_only", "owner_and_editors", "owner_editors_and_active_signer"])
    .default("owner_only"),
  notifyOriginatorOnEachSignature: z.boolean().default(true),
  dueAt: z.string().datetime().nullable().default(null),
  pageCount: z.number().int().positive().nullable().default(null),
  routingStrategy: z.enum(["sequential", "parallel"]).default("sequential"),
  isScanned: z.boolean().default(false),
});

const prepareInternalSignatureInputSchema = z.object({
  page: z.number().int().positive(),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive().default(220),
  height: z.number().positive().default(64),
  reason: z.string().trim().min(1).max(120).default("Internal document approval"),
  location: z.string().trim().min(1).max(120).default("EasyDraft"),
});

const signInternalDocumentInputSchema = z.object({
  signerName: z.string().trim().min(1).max(120),
  signerEmail: z.string().trim().email().transform((value) => normalizeEmailAddress(value)),
  reason: z.string().trim().min(1).max(120).default("Internal document approval"),
  location: z.string().trim().min(1).max(120).default("EasyDraft"),
});

const addSignerInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().trim().email().transform((value) => normalizeEmailAddress(value)),
  participantType: z.enum(["internal", "external"]).default("external"),
  required: z.boolean().default(true),
  routingStage: z.number().int().positive().default(1),
  signingOrder: z.number().int().positive().nullable().default(null),
});

const updateDocumentRoutingInputSchema = z.object({
  routingStrategy: z.enum(["sequential", "parallel"]),
});

const updateDocumentWorkflowSettingsInputSchema = z.object({
  dueAt: z.string().datetime().nullable().default(null),
});

const updateDocumentRetentionInputSchema = z.object({
  retentionMode: z.enum(["temporary", "retained"]),
});

const addFieldInputSchema = z.object({
  page: z.number().int().positive(),
  kind: z.enum(["text", "image", "signature", "initial", "approval", "date", "checkbox"]),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
  assigneeSignerId: z.string().uuid().nullable().default(null),
  source: z.enum(["manual", "auto_detected"]).default("manual"),
  x: z.number().min(0).default(120),
  y: z.number().min(0).default(540),
  width: z.number().positive().default(180),
  height: z.number().positive().default(40),
});

const inviteCollaboratorInputSchema = z.object({
  email: z.string().trim().email().transform((value) => normalizeEmailAddress(value)),
  role: z.enum(["editor", "viewer"]),
});

const createSavedSignatureInputSchema = z
  .object({
    label: z.string().min(1).max(80),
    titleText: z.string().trim().max(120).nullable().default(null),
    signatureType: z.enum(["typed", "uploaded"]),
    typedText: z.string().trim().max(120).nullable().default(null),
    storagePath: z.string().min(1).nullable().default(null),
    isDefault: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.signatureType === "typed" && !value.typedText?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Typed signatures require signature text.",
        path: ["typedText"],
      });
    }

    if (value.signatureType === "uploaded" && !value.storagePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Uploaded signatures require a storage path.",
        path: ["storagePath"],
      });
    }
  });

const completeFieldInputSchema = z.object({
  savedSignatureId: z.string().uuid().nullable().default(null),
  signingReason: z.string().trim().min(1).max(80).nullable().default(null),
  signingLocation: z.string().trim().min(1).max(120).nullable().default(null),
});

const completeFieldTokenInputSchema = z.object({
  value: z.string().trim().max(500).nullable().default(null),
  signingReason: z.string().trim().min(1).max(80).nullable().default(null),
  signingLocation: z.string().trim().min(1).max(120).nullable().default(null),
});

const workflowResponseInputSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

const reassignSignerInputSchema = z.object({
  signerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => normalizeEmailAddress(value)),
  participantType: z.enum(["internal", "external"]).optional(),
});

const updateProfileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(120).nullable().default(null),
  jobTitle: z.string().trim().max(120).nullable().default(null),
  locale: z.string().trim().max(20).nullable().default(null),
  timezone: z.string().trim().max(60).nullable().default(null),
  marketingOptIn: z.boolean().default(false),
  productUpdatesOptIn: z.boolean().default(true),
});

const adminDeleteUserInputSchema = z.object({
  userId: z.string().uuid(),
});

const adminResetUserPasswordInputSchema = z.object({
  userId: z.string().uuid(),
  redirectTo: z.string().url().nullable().optional(),
});

const adminInviteUserInputSchema = z.object({
  email: z.string().trim().email().transform((value) => normalizeEmailAddress(value)),
  displayName: z.string().trim().max(120).optional().default(""),
  redirectTo: z.string().url().nullable().optional(),
});

const createDigitalSignatureProfileInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  titleText: z.string().trim().max(120).nullable().default(null),
  signerName: z.string().trim().min(1).max(120),
  signerEmail: z
    .string()
    .trim()
    .email()
    .transform((value) => normalizeEmailAddress(value))
    .nullable()
    .default(null),
  organizationName: z.string().trim().max(120).nullable().default(null),
  signingReason: z.string().trim().min(1).max(80),
  provider: z.enum(["easy_draft_remote", "qualified_remote", "organization_hsm"]),
  assuranceLevel: z.string().trim().min(1).max(40).default("advanced"),
});

const createFeedbackRequestInputSchema = z.object({
  feedbackType: z.enum(["bug_report", "feature_request"]),
  title: z.string().trim().min(1).max(140),
  details: z.string().trim().min(1).max(4000),
  email: z.string().trim().email().optional(),
  source: z.string().trim().min(1).max(80).default("web_app"),
  requestedPath: z.string().trim().max(400).nullable().default(null),
});

const updateAdminFeedbackRequestInputSchema = z.object({
  feedbackRequestId: z.string().uuid(),
  status: z.enum(["new", "acknowledged", "planned", "in_progress", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  resolutionNote: z.string().trim().max(4000).nullable().optional(),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizeDisplayName(value: string | null | undefined, email: string) {
  const trimmed = value?.trim();
  return trimmed || email.split("@")[0] || "User";
}

type SyncProfileIdentityInput = {
  id: string;
  email: string;
  displayName?: string | null;
  username?: string | null;
  companyName?: string | null;
  accountType?: AccountType | null;
  workspaceName?: string | null;
  profileKind?: ProfileKind | null;
  touchLastSeenAt?: boolean;
};

export async function syncProfileIdentity(input: SyncProfileIdentityInput) {
  const adminClient = createServiceRoleClient();
  const normalizedEmail = normalizeEmailAddress(input.email);
  const normalizedDisplayName = normalizeDisplayName(input.displayName, normalizedEmail);
  const normalizedProfileKind = inferProfileKind(normalizedEmail, input.profileKind);
  const normalizedUsername = deriveUsername(normalizedEmail, input.username);

  const [organizationMembershipsResult, workspaceMembershipsResult] = await Promise.all([
    adminClient
      .from("organization_memberships")
      .select("role, created_at, organizations(id, name, account_type, owner_user_id)")
      .eq("user_id", input.id),
    adminClient
      .from("workspace_memberships")
      .select("role, created_at, workspaces(id, name, workspace_type, owner_user_id)")
      .eq("user_id", input.id),
  ]);

  if (organizationMembershipsResult.error) {
    throw new AppError(500, organizationMembershipsResult.error.message);
  }

  if (workspaceMembershipsResult.error) {
    throw new AppError(500, workspaceMembershipsResult.error.message);
  }

  const preferredOrganization = ((organizationMembershipsResult.data ?? []) as Array<{
    role: "owner" | "admin" | "member" | "billing_admin";
    created_at: string;
    organizations:
      | {
          id: string;
          name: string;
          account_type: AccountType;
          owner_user_id: string;
        }
      | Array<{
          id: string;
          name: string;
          account_type: AccountType;
          owner_user_id: string;
        }>
      | null;
  }>)
    .map((entry) => ({
      role: entry.role,
      createdAt: entry.created_at,
      organization: Array.isArray(entry.organizations) ? entry.organizations[0] ?? null : entry.organizations,
    }))
    .filter((entry) => entry.organization)
    .sort((left, right) => {
      const roleWeight = (role: string) =>
        role === "owner" ? 0 : role === "admin" ? 1 : role === "billing_admin" ? 2 : 3;
      return (
        roleWeight(left.role) - roleWeight(right.role) ||
        left.createdAt.localeCompare(right.createdAt)
      );
    })[0]?.organization ?? null;

  const preferredWorkspace = ((workspaceMembershipsResult.data ?? []) as Array<{
    role: "owner" | "admin" | "member" | "billing_admin";
    created_at: string;
    workspaces:
      | {
          id: string;
          name: string;
          workspace_type: "personal" | "team";
          owner_user_id: string;
        }
      | Array<{
          id: string;
          name: string;
          workspace_type: "personal" | "team";
          owner_user_id: string;
        }>
      | null;
  }>)
    .map((entry) => ({
      role: entry.role,
      createdAt: entry.created_at,
      workspace: Array.isArray(entry.workspaces) ? entry.workspaces[0] ?? null : entry.workspaces,
    }))
    .filter((entry) => entry.workspace)
    .sort((left, right) => {
      const roleWeight = (role: string) =>
        role === "owner" ? 0 : role === "admin" ? 1 : role === "billing_admin" ? 2 : 3;
      return (
        roleWeight(left.role) - roleWeight(right.role) ||
        left.createdAt.localeCompare(right.createdAt)
      );
    })[0]?.workspace ?? null;

  const normalizedAccountType = inferAccountType(
    input.accountType,
    preferredOrganization?.account_type ?? (preferredWorkspace?.workspace_type === "team" ? "corporate" : "individual"),
  );
  const normalizedWorkspaceName =
    input.workspaceName?.trim() ||
    preferredOrganization?.name ||
    preferredWorkspace?.name ||
    null;
  const normalizedCompanyName = inferCompanyName({
    email: normalizedEmail,
    preferredCompanyName: input.companyName,
    workspaceName: normalizedWorkspaceName,
    accountType: normalizedAccountType,
    profileKind: normalizedProfileKind,
    fallbackCompanyName: preferredOrganization?.account_type === "corporate" ? preferredOrganization.name : null,
  });

  const identity: ProfileIdentity = {
    id: input.id,
    email: normalizedEmail,
    display_name: normalizedDisplayName,
    username: normalizedUsername,
    company_name: normalizedCompanyName,
    account_type: normalizedAccountType,
    workspace_name: normalizedWorkspaceName,
    profile_kind: normalizedProfileKind,
  };

  await upsertRoleSpecificProfileIdentity(adminClient, identity);

  const { error } = await adminClient.auth.admin.updateUserById(input.id, {
    user_metadata: {
      full_name: normalizedDisplayName,
      username: normalizedUsername,
      company_name: normalizedCompanyName ?? undefined,
      account_type: normalizedAccountType,
      workspace_name: normalizedWorkspaceName ?? undefined,
      profile_kind: normalizedProfileKind,
      ...(input.touchLastSeenAt ? { last_seen_at: new Date().toISOString() } : {}),
    },
  });

  if (error) {
    throw new AppError(500, error.message);
  }
}

function isActionFieldKind(kind: Field["kind"]) {
  return kind === "signature" || kind === "initial" || kind === "approval";
}

function getActionLabelForFieldKind(kind: Field["kind"]) {
  return kind === "approval" ? "approval" : "signature";
}

function looksLikeStoredImagePath(value: string | null) {
  if (!value) {
    return false;
  }

  return /\/.+\.(png|jpg|jpeg|webp)$/i.test(value);
}

function formatCompletedAtLabel(timestamp: string | null) {
  if (!timestamp) {
    return "";
  }

  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeDeliveryMode(deliveryMode: DeliveryMode) {
  if (deliveryMode === "platform_managed") {
    return "platform-managed signing path";
  }

  if (deliveryMode === "internal_use_only") {
    return "internal-use-only signing path";
  }

  return "self-managed distribution path";
}

type ChangeImpactAssessment = {
  impact: DocumentChangeImpact;
  summary: string;
};

type NormalizedFieldForImpact = {
  id: string;
  kind: Field["kind"];
  label: string;
  required: boolean;
  assigneeSignerId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  completedAt: string | null;
  completedBySignerId: string | null;
};

function describeChangeImpact(impact: DocumentChangeImpact) {
  return impact.replaceAll("_", " ");
}

function isFieldRow(field: Field | FieldRow): field is FieldRow {
  return "assignee_signer_id" in field;
}

function normalizeFieldForImpact(field: Field | FieldRow): NormalizedFieldForImpact {
  if (!isFieldRow(field)) {
    return {
      id: field.id,
      kind: field.kind,
      label: field.label,
      required: field.required,
      assigneeSignerId: field.assigneeSignerId,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      value: field.value,
      completedAt: field.completedAt,
      completedBySignerId: field.completedBySignerId,
    };
  }

  return {
    id: field.id,
    kind: field.kind,
    label: field.label,
    required: field.required,
    assigneeSignerId: field.assignee_signer_id,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    value: field.value,
    completedAt: field.completed_at,
    completedBySignerId: field.completed_by_signer_id,
  };
}

function documentHasSignedActionFields(document: DocumentRecord) {
  return document.fields.some((field) => isActionFieldKind(field.kind) && Boolean(field.completedAt));
}

export function classifyFieldSetChangeImpact(
  previousFields: Array<Field | FieldRow>,
  nextFields: Array<Field | FieldRow>,
): ChangeImpactAssessment | null {
  const before = previousFields.map(normalizeFieldForImpact);
  const after = nextFields.map(normalizeFieldForImpact);
  const beforeById = new Map(before.map((field) => [field.id, field]));
  const afterById = new Map(after.map((field) => [field.id, field]));

  for (const field of before) {
    if (!isActionFieldKind(field.kind) || !field.completedAt) {
      continue;
    }

    const nextField = afterById.get(field.id);
    if (!nextField) {
      return {
        impact: "resign_required",
        summary: `A signed field was removed after signing started. All action fields must be signed again.`,
      };
    }

    if (
      nextField.assigneeSignerId !== field.assigneeSignerId ||
      nextField.x !== field.x ||
      nextField.y !== field.y ||
      nextField.width !== field.width ||
      nextField.height !== field.height ||
      nextField.value !== field.value
    ) {
      return {
        impact: "resign_required",
        summary: `A signed field changed after signing started. All action fields must be signed again.`,
      };
    }
  }

  const changedUnsignedField = before.some((field) => {
    const nextField = afterById.get(field.id);
    if (!nextField) {
      return !field.completedAt;
    }

    return (
      nextField.kind !== field.kind ||
      nextField.label !== field.label ||
      nextField.required !== field.required ||
      nextField.assigneeSignerId !== field.assigneeSignerId
    );
  });

  if (changedUnsignedField || before.length !== after.length) {
    return {
      impact: "review_required",
      summary: "The field map changed after signing started. Review the document and reopen it before more signing continues.",
    };
  }

  return null;
}

const accessRolePriority: Record<AccessRole, number> = {
  signer: 1,
  viewer: 2,
  editor: 3,
  owner: 4,
};

function mergeAccessRole(existingRole: AccessRole | null, incomingRole: AccessRole) {
  if (!existingRole) {
    return incomingRole;
  }

  return accessRolePriority[existingRole] >= accessRolePriority[incomingRole]
    ? existingRole
    : incomingRole;
}

function getAdminEmailSet() {
  const env = readServerEnv();

  return new Set(
    (env.EASYDRAFT_ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdminUser(user: AuthenticatedUser) {
  return getAdminEmailSet().has(user.rawEmail.toLowerCase());
}

function assertAdminUser(user: AuthenticatedUser) {
  if (!isAdminUser(user)) {
    throw new AppError(403, "You do not have permission to view the EasyDraft admin console.");
  }
}

async function listAdminAuthUsers(adminClient: ReturnType<typeof createServiceRoleClient>) {
  const { data, error } = await adminClient.auth.admin.listUsers();

  if (error) {
    throw new AppError(500, error.message);
  }

  return data.users ?? [];
}

async function findAdminAuthUserById(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  userId: string,
) {
  const users = await listAdminAuthUsers(adminClient);
  return users.find((candidate) => candidate.id === userId) ?? null;
}

async function findAdminAuthUserByEmail(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  email: string,
) {
  const normalizedEmail = normalizeEmailAddress(email);
  const users = await listAdminAuthUsers(adminClient);
  return users.find((candidate) => normalizeEmailAddress(candidate.email ?? "") === normalizedEmail) ?? null;
}

type ProfileIdentity = {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  company_name: string | null;
  account_type: AccountType;
  workspace_name: string | null;
  profile_kind: ProfileKind;
};

function readStringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapAuthUserToProfileIdentity(authUser: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): ProfileIdentity | null {
  const email = authUser.email ? normalizeEmailAddress(authUser.email) : null;

  if (!email) {
    return null;
  }

  const metadata = authUser.user_metadata ?? {};
  const accountType = inferAccountType(readStringMetadata(metadata, "account_type") as AccountType | null);
  const profileKind = inferProfileKind(email, readStringMetadata(metadata, "profile_kind") as ProfileKind | null);
  const workspaceName = readStringMetadata(metadata, "workspace_name");
  const companyName = inferCompanyName({
    email,
    preferredCompanyName: readStringMetadata(metadata, "company_name"),
    workspaceName,
    accountType,
    profileKind,
  });

  return {
    id: authUser.id,
    email,
    display_name: normalizeDisplayName(
      readStringMetadata(metadata, "full_name") ?? readStringMetadata(metadata, "name"),
      email,
    ),
    username: deriveUsername(email, readStringMetadata(metadata, "username")),
    company_name: companyName,
    account_type: accountType,
    workspace_name: workspaceName,
    profile_kind: profileKind,
  };
}

function mapProfileIdentityToProfileRow(identity: ProfileIdentity): ProfileRow {
  return {
    id: identity.id,
    email: identity.email,
    display_name: identity.display_name,
    username: identity.username,
    avatar_url: null,
    company_name: identity.company_name,
    account_type: identity.account_type,
    workspace_name: identity.workspace_name,
    job_title: null,
    locale: null,
    timezone: null,
    marketing_opt_in: false,
    product_updates_opt_in: true,
    last_seen_at: null,
    onboarding_completed_at: null,
    profile_kind: identity.profile_kind,
  };
}

export async function getProfileIdentitiesById(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  userIds: string[],
) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

  if (uniqueUserIds.length === 0) {
    return new Map<string, ProfileIdentity>();
  }

  const authUsers = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const { data, error } = await adminClient.auth.admin.getUserById(userId);

      if (error) {
        throw new AppError(500, error.message);
      }

      return data.user;
    }),
  );

  return new Map(
    authUsers
      .map((authUser) => (authUser ? mapAuthUserToProfileIdentity(authUser) : null))
      .filter((profile): profile is ProfileIdentity => Boolean(profile))
      .map((profile) => [profile.id, profile]),
  );
}

export async function findProfileIdentityByEmail(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  email: string,
) {
  const authUser = await findAdminAuthUserByEmail(adminClient, email);
  return authUser ? mapAuthUserToProfileIdentity(authUser) : null;
}

async function upsertRoleSpecificProfileIdentity(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  identity: ProfileIdentity,
) {
  const table =
    identity.profile_kind === "easydraft_staff"
      ? "easydraft_staff_profiles"
      : "easydraft_user_profiles";
  const otherTable =
    identity.profile_kind === "easydraft_staff"
      ? "easydraft_user_profiles"
      : "easydraft_staff_profiles";
  const { error } = await adminClient.from(table).upsert(
    {
      user_id: identity.id,
      email: identity.email,
      display_name: identity.display_name,
      username: identity.username,
      company_name: identity.company_name,
      account_type: identity.account_type,
      workspace_name: identity.workspace_name,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new AppError(500, error.message);
  }

  const { error: deleteError } = await adminClient
    .from(otherTable)
    .delete()
    .eq("user_id", identity.id);

  if (deleteError) {
    throw new AppError(500, deleteError.message);
  }
}

export async function ensureDefaultWorkspaceForUser(user: AuthenticatedUser) {
  return resolveWorkspaceForUser(user);
}

async function listWorkspaceMembershipsForUser(userId: string) {
  const adminClient = createServiceRoleClient();
  const { data: memberships, error: membershipsError } = await adminClient
    .from("workspace_memberships")
    .select("role, workspaces(id, name, slug, workspace_type, organization_id, owner_user_id, billing_email)")
    .eq("user_id", userId);

  if (membershipsError) {
    throw new AppError(500, membershipsError.message);
  }

  return (memberships ?? []) as unknown as WorkspaceMembershipWithWorkspaceRow[];
}

function flattenWorkspaceMemberships(memberships: WorkspaceMembershipWithWorkspaceRow[]) {
  return memberships.flatMap((membership) =>
    (Array.isArray(membership.workspaces)
      ? membership.workspaces
      : membership.workspaces
        ? [membership.workspaces]
        : []
    ).map((workspace) => ({
      workspace,
      role: membership.role,
    })),
  );
}

export async function getOrganizationById(organizationId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("organizations")
    .select("id, name, slug, account_type, owner_user_id, billing_email")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data ?? null) as OrganizationRow | null;
}

export async function ensureOrganizationForWorkspace(workspace: WorkspaceRow) {
  if (workspace.organization_id) {
    const existing = await getOrganizationById(workspace.organization_id);

    if (existing) {
      return existing;
    }
  }

  const adminClient = createServiceRoleClient();
  const organizationPayload = {
    name: workspace.name,
    slug: workspace.slug,
    account_type: (workspace.workspace_type === "team" ? "corporate" : "individual") as "corporate" | "individual",
    owner_user_id: workspace.owner_user_id,
    billing_email: workspace.billing_email,
  };

  const { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .upsert(organizationPayload, { onConflict: "slug" })
    .select("id, name, slug, account_type, owner_user_id, billing_email")
    .single();

  if (organizationError || !organization) {
    throw new AppError(500, organizationError?.message ?? "Unable to ensure organization.");
  }

  const { error: workspaceError } = await adminClient
    .from("workspaces")
    .update({ organization_id: organization.id })
    .eq("id", workspace.id);

  if (workspaceError) {
    throw new AppError(500, workspaceError.message);
  }

  const { error: membershipError } = await adminClient
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organization.id,
        user_id: workspace.owner_user_id,
        role: "owner",
      },
      { onConflict: "organization_id,user_id" },
    );

  if (membershipError) {
    throw new AppError(500, membershipError.message);
  }

  return organization as OrganizationRow;
}

export async function getOrganizationMembershipRole(organizationId: string, userId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data?.role ?? null) as OrganizationMembershipRow["role"] | null;
}

export async function listAccessibleWorkspacesForUser(user: AuthenticatedUser) {
  const memberships = await listWorkspaceMembershipsForUser(user.id);
  return flattenWorkspaceMemberships(memberships)
    .filter(({ workspace }) => Boolean(workspace))
    .sort((left, right) => {
      if (left.workspace.workspace_type !== right.workspace.workspace_type) {
        return left.workspace.workspace_type === "team" ? -1 : 1;
      }

      return left.workspace.name.localeCompare(right.workspace.name);
    });
}

export async function resolveWorkspaceForUser(
  user: AuthenticatedUser,
  preferredWorkspaceId?: string | null,
) {
  const adminClient = createServiceRoleClient();
  const memberships = await listWorkspaceMembershipsForUser(user.id);
  const accessibleMemberships = flattenWorkspaceMemberships(memberships);

  if (preferredWorkspaceId) {
    const preferredMembership = accessibleMemberships.find(
      ({ workspace }) => workspace.id === preferredWorkspaceId,
    );

    if (preferredMembership) {
      await ensureOrganizationForWorkspace(preferredMembership.workspace);
      return preferredMembership.workspace;
    }
  }

  const joinedTeamWorkspaces = accessibleMemberships
    .map(({ workspace }) => workspace)
    .filter((workspace) => workspace.workspace_type === "team");

  if (joinedTeamWorkspaces.length === 1) {
    await ensureOrganizationForWorkspace(joinedTeamWorkspaces[0]);
    return joinedTeamWorkspaces[0];
  }

  const { data: existingWorkspace, error: existingWorkspaceError } = await adminClient
    .from("workspaces")
    .select("id, name, slug, workspace_type, organization_id, owner_user_id, billing_email")
    .eq("owner_user_id", user.id)
    .eq("workspace_type", "personal")
    .maybeSingle();

  if (existingWorkspaceError) {
    throw new AppError(500, existingWorkspaceError.message);
  }

  if (existingWorkspace) {
    await ensureOrganizationForWorkspace(existingWorkspace as WorkspaceRow);
    await adminClient.from("workspace_memberships").upsert(
      {
        workspace_id: existingWorkspace.id,
        user_id: user.id,
        role: "owner",
      },
      {
        onConflict: "workspace_id,user_id",
      },
    );

    return existingWorkspace;
  }

  const wantsCorporateAccount = user.accountType === "corporate" || Boolean(user.workspaceName?.trim());
  const workspaceType = wantsCorporateAccount ? "team" : "personal";
  const organizationName = wantsCorporateAccount
    ? user.workspaceName?.trim() || (user.name?.trim() ? `${user.name.trim()}'s organization` : "My organization")
    : user.name?.trim()
      ? `${user.name.trim()}'s account`
      : "My account";
  const workspaceName = wantsCorporateAccount
    ? organizationName
    : user.name?.trim()
      ? `${user.name.trim()}'s workspace`
      : "My workspace";
  const baseSlug = slugify(
    wantsCorporateAccount ? organizationName : user.name || user.email.split("@")[0],
  );
  const workspaceSlug = [baseSlug, user.id.slice(0, 8)]
    .filter(Boolean)
    .join("-");

  const { data: createdOrganization, error: createOrganizationError } = await adminClient
    .from("organizations")
    .insert({
      name: organizationName,
      slug: workspaceSlug,
      account_type: wantsCorporateAccount ? "corporate" : "individual",
      owner_user_id: user.id,
      billing_email: user.email,
    })
    .select("id, name, slug, account_type, owner_user_id, billing_email")
    .single();

  if (createOrganizationError || !createdOrganization) {
    throw new AppError(
      500,
      createOrganizationError?.message ?? "Unable to create an organization.",
    );
  }

  const { data: createdWorkspace, error: createWorkspaceError } = await adminClient
    .from("workspaces")
    .insert({
      name: workspaceName,
      slug: workspaceSlug,
      workspace_type: workspaceType,
      organization_id: createdOrganization.id,
      owner_user_id: user.id,
      billing_email: user.email,
    })
    .select("id, name, slug, workspace_type, organization_id, owner_user_id, billing_email")
    .single();

  if (createWorkspaceError || !createdWorkspace) {
    throw new AppError(500, createWorkspaceError?.message ?? "Unable to create a workspace.");
  }

  const { error: membershipError } = await adminClient.from("workspace_memberships").insert({
    workspace_id: createdWorkspace.id,
    user_id: user.id,
    role: "owner",
  });

  if (membershipError) {
    throw new AppError(500, membershipError.message);
  }

  const { error: orgMembershipError } = await adminClient.from("organization_memberships").insert({
    organization_id: createdOrganization.id,
    user_id: user.id,
    role: "owner",
  });

  if (orgMembershipError) {
    throw new AppError(500, orgMembershipError.message);
  }

  return createdWorkspace;
}

function normalizeMetadata(metadata: AuditEventRow["metadata"]): AuditEvent["metadata"] {
  if (!metadata) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    ),
  ) as AuditEvent["metadata"];
}

function mapSigner(row: SignerRow): Signer {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    participantType: row.participant_type,
    required: row.required,
    routingStage: row.routing_stage,
    signingOrder: row.signing_order,
  };
}

function mapField(row: FieldRow): Field {
  return {
    id: row.id,
    page: row.page,
    kind: row.kind,
    label: row.label,
    required: row.required,
    assigneeSignerId: row.assignee_signer_id,
    source: row.source,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    value: row.value,
    appliedSavedSignatureId: row.applied_saved_signature_id,
    completedAt: row.completed_at,
    completedBySignerId: row.completed_by_signer_id,
  };
}

function mapVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    note: row.note,
    changeImpact: row.change_impact,
    changeImpactSummary: row.change_impact_summary,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    summary: row.summary,
    metadata: normalizeMetadata(row.metadata),
  };
}

function mapNotification(row: NotificationRow): DocumentNotification {
  return {
    id: row.id,
    eventType: row.event_type,
    channel: row.channel,
    status: row.status,
    recipientEmail: row.recipient_email,
    recipientUserId: row.recipient_user_id,
    recipientSignerId: row.recipient_signer_id,
    queuedAt: row.queued_at,
    deliveredAt: row.delivered_at,
    metadata: normalizeMetadata(row.metadata),
  };
}

async function mapSavedSignature(row: SavedSignatureRow): Promise<SavedSignature> {
  let previewUrl: string | null = null;

  if (row.signature_type === "uploaded" && row.storage_path) {
    const env = readServerEnv();
    const adminClient = createServiceRoleClient();
    const { data } = await adminClient.storage
      .from(env.SUPABASE_SIGNATURE_BUCKET)
      .createSignedUrl(row.storage_path, 60 * 30);
    previewUrl = data?.signedUrl ?? null;
  }

  return {
    id: row.id,
    label: row.label,
    titleText: row.title_text,
    signatureType: row.signature_type,
    typedText: row.typed_text,
    storagePath: row.storage_path,
    previewUrl,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

function mapProfile(row: ProfileRow): ProfileResponse["profile"] {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    companyName: row.company_name,
    accountType: row.account_type,
    workspaceName: row.workspace_name,
    jobTitle: row.job_title,
    locale: row.locale,
    timezone: row.timezone,
    marketingOptIn: row.marketing_opt_in,
    productUpdatesOptIn: row.product_updates_opt_in,
    lastSeenAt: row.last_seen_at,
    onboardingCompletedAt: row.onboarding_completed_at,
    profileKind: row.profile_kind,
  };
}

function mapAuthenticatedUserProfile(
  user: AuthenticatedUser,
  overrides: Partial<ProfileResponse["profile"]> = {},
): ProfileResponse["profile"] {
  const normalizedEmail = normalizeEmailAddress(user.rawEmail);
  const metadata = user.profileMetadata ?? {};
  const accountType = inferAccountType(user.accountType);
  const profileKind = user.profileKind ?? inferProfileKind(normalizedEmail, readStringMetadata(metadata, "profile_kind"));
  const workspaceName = user.workspaceName ?? readStringMetadata(metadata, "workspace_name");
  const companyName = inferCompanyName({
    email: normalizedEmail,
    preferredCompanyName: overrides.companyName ?? readStringMetadata(metadata, "company_name"),
    workspaceName,
    accountType,
    profileKind,
  });
  const onboardingCompletedAt =
    overrides.onboardingCompletedAt ??
    readStringMetadata(metadata, "onboarding_completed_at");

  return {
    id: user.id,
    email: normalizedEmail,
    displayName: normalizeDisplayName(
      overrides.displayName ??
        readStringMetadata(metadata, "full_name") ??
        readStringMetadata(metadata, "name") ??
        user.name,
      normalizedEmail,
    ),
    username: deriveUsername(normalizedEmail, overrides.username ?? readStringMetadata(metadata, "username")),
    avatarUrl: null,
    companyName,
    accountType,
    workspaceName,
    jobTitle: overrides.jobTitle ?? readStringMetadata(metadata, "job_title"),
    locale: overrides.locale ?? readStringMetadata(metadata, "locale"),
    timezone: overrides.timezone ?? readStringMetadata(metadata, "timezone"),
    marketingOptIn:
      overrides.marketingOptIn ??
      (typeof metadata.marketing_opt_in === "boolean" ? metadata.marketing_opt_in : false),
    productUpdatesOptIn:
      overrides.productUpdatesOptIn ??
      (typeof metadata.product_updates_opt_in === "boolean" ? metadata.product_updates_opt_in : true),
    lastSeenAt: null,
    onboardingCompletedAt,
    profileKind,
    ...overrides,
  };
}

function assertCertificateSigningEnabledForRequest() {
  if (!isCertificateSigningEnabled()) {
    throw new AppError(404, "Feature not available.");
  }
}

function mapDigitalSignatureProfile(
  row: DigitalSignatureProfileRow,
): DigitalSignatureProfileResponse {
  return {
    id: row.id,
    label: row.label,
    titleText: row.title_text,
    signerName: row.signer_name,
    signerEmail: row.signer_email,
    organizationName: row.organization_name,
    signingReason: row.signing_reason,
    provider: row.provider,
    assuranceLevel: row.assurance_level,
    status: row.status,
    certificateFingerprint: row.certificate_fingerprint,
    providerReference: row.provider_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocumentRecord(
  row: DocumentRow,
  accessRows: DocumentAccessRow[],
  accessProfiles: ProfileRow[],
  signerRows: SignerRow[],
  fieldRows: FieldRow[],
  versionRows: DocumentVersionRow[],
  auditRows: AuditEventRow[],
  notificationRows: NotificationRow[],
  latestEditorHistoryIndex: number,
): DocumentRecord & {
  editorHistory: { currentIndex: number; latestIndex: number };
  accessProfileDirectory: Array<{ userId: string; displayName: string; email: string | null }>;
} {
  const accessProfileById = new Map(accessProfiles.map((profile) => [profile.id, profile]));

  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    storagePath: row.storage_path,
    workspaceId: row.workspace_id,
    signaturePath: row.signature_path,
    status: row.status,
    deliveryMode: row.delivery_mode,
    distributionTarget: row.distribution_target,
    lockPolicy: row.lock_policy,
    notifyOriginatorOnEachSignature: row.notify_originator_on_each_signature,
    dueAt: row.due_at,
    retentionMode: row.retention_mode,
    retentionDays: row.retention_days,
    purgeScheduledAt: row.purge_scheduled_at,
    purgedAt: row.purged_at,
    purgedByUserId: row.purged_by_user_id,
    purgeReason: row.purge_reason,
    workflowStatus: row.workflow_status,
    workflowStatusReason: row.workflow_status_reason,
    workflowStatusUpdatedAt: row.workflow_status_updated_at,
    workflowStatusUpdatedByUserId: row.workflow_status_updated_by_user_id,
    pageCount: row.page_count,
    uploadedAt: row.uploaded_at,
    uploadedByUserId: row.uploaded_by_user_id,
    preparedAt: row.prepared_at,
    sentAt: row.sent_at,
    completedAt: row.completed_at,
    reopenedAt: row.reopened_at,
    reopenedByUserId: row.reopened_by_user_id,
    lockedAt: row.locked_at,
    lockedByUserId: row.locked_by_user_id,
    routingStrategy: row.routing_strategy,
    isScanned: row.is_scanned,
    isOcrComplete: row.is_ocr_complete,
    isFieldDetectionComplete: row.is_field_detection_complete,
    sourceStorageBytes: row.source_storage_bytes ?? 0,
    exportStorageBytes: row.export_storage_bytes ?? 0,
    exportSha256: row.export_sha256 ?? null,
    latestChangeImpact: row.latest_change_impact ?? null,
    latestChangeImpactSummary: row.latest_change_impact_summary ?? null,
    latestChangeImpactAt: row.latest_change_impact_at ?? null,
    access: accessRows.map((entry) => ({
      userId: entry.user_id,
      role: entry.role,
    })),
    accessProfileDirectory: accessRows.map((entry) => {
      const profile = accessProfileById.get(entry.user_id);
      return {
        userId: entry.user_id,
        displayName: profile?.display_name ?? "Workspace user",
        email: profile?.email ?? null,
      };
    }),
    signers: signerRows
      .slice()
      .sort((left, right) => {
        if (left.routing_stage !== right.routing_stage) {
          return left.routing_stage - right.routing_stage;
        }

        return (left.signing_order ?? 999) - (right.signing_order ?? 999);
      })
      .map(mapSigner),
    fields: fieldRows.slice().sort((left, right) => left.page - right.page).map(mapField),
    versions: versionRows
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(mapVersion),
    auditTrail: auditRows
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(mapAuditEvent),
    notifications: notificationRows
      .slice()
      .sort((left, right) => right.queued_at.localeCompare(left.queued_at))
      .map(mapNotification),
    editorHistory: {
      currentIndex: row.editor_history_index ?? 0,
      latestIndex: latestEditorHistoryIndex,
    },
  };
}

export async function resolveAuthenticatedUser(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AppError(401, "Missing or invalid bearer token.");
  }

  const token = authorizationHeader.slice("Bearer ".length);
  const authClient = createAuthClient();
  const adminClient = createServiceRoleClient();
  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data.user?.email) {
    throw new AppError(401, "Unable to verify the signed-in user.");
  }

  const normalizedEmail = normalizeEmailAddress(data.user.email);
  const profileKind = inferProfileKind(normalizedEmail, data.user.user_metadata.profile_kind);
  const user: AuthenticatedUser = {
    id: data.user.id,
    email: data.user.email,
    rawEmail: data.user.email,
    name:
      data.user.user_metadata.full_name ??
      data.user.user_metadata.name ??
      data.user.email.split("@")[0],
    accountType:
      data.user.user_metadata.account_type === "corporate" ? "corporate" : "individual",
    workspaceName: data.user.user_metadata.workspace_name ?? undefined,
    profileKind,
    profileMetadata: data.user.user_metadata ?? {},
  };

  await upsertRoleSpecificProfileIdentity(
    adminClient,
    {
      id: user.id,
      email: user.email,
      display_name: normalizeDisplayName(user.name, normalizedEmail),
      username: deriveUsername(
        normalizedEmail,
        typeof data.user.user_metadata.username === "string" ? data.user.user_metadata.username : null,
      ),
      company_name: inferCompanyName({
        email: normalizedEmail,
        preferredCompanyName:
          typeof data.user.user_metadata.company_name === "string"
            ? data.user.user_metadata.company_name
            : null,
        workspaceName: user.workspaceName ?? null,
        accountType: inferAccountType(user.accountType),
        profileKind,
      }),
      account_type: inferAccountType(user.accountType),
      workspace_name: user.workspaceName ?? null,
      profile_kind: profileKind,
    },
  );

  const { data: invites } = await adminClient
    .from("document_invites")
    .select("id, document_id, email, role, accepted_at")
    .is("accepted_at", null)
    .ilike("email", normalizedEmail);

  if (invites && invites.length > 0) {
    await Promise.all(
      invites.map(async (invite) => {
        const typedInvite = invite as DocumentInviteRow;

        await upsertDocumentAccessRole(
          adminClient,
          typedInvite.document_id,
          user.id,
          typedInvite.role,
        );

        await adminClient
          .from("document_invites")
          .update({ accepted_at: new Date().toISOString() })
          .eq("id", typedInvite.id);

        if (typedInvite.role === "signer") {
          await adminClient
            .from("document_signers")
            .update({ user_id: user.id })
            .eq("document_id", typedInvite.document_id)
            .ilike("email", normalizedEmail)
            .is("user_id", null);
        }
      }),
    );
  }

  const { data: signerRows } = await adminClient
    .from("document_signers")
    .select("id, document_id, user_id, name, email, participant_type, required, routing_stage, signing_order")
    .ilike("email", normalizedEmail)
    .is("user_id", null);

  if (signerRows && signerRows.length > 0) {
    await Promise.all(
      signerRows.map(async (row) => {
        const signer = row as SignerRow;
        await adminClient
          .from("document_signers")
          .update({ user_id: user.id })
          .eq("id", signer.id);

        await upsertDocumentAccessRole(adminClient, signer.document_id, user.id, "signer");
      }),
    );
  }

  await ensureDefaultWorkspaceForUser(user);

  return user;
}

async function tryResolveAuthenticatedUser(authorizationHeader: string | undefined) {
  if (!authorizationHeader) {
    return null;
  }

  return resolveAuthenticatedUser(authorizationHeader);
}

async function requireDocumentRole(documentId: string, userId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_access")
    .select("document_id, user_id, role")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  if (!data) {
    throw new AppError(404, "Document not found.");
  }

  return data.role as AccessRole;
}

async function getDocumentRole(documentId: string, userId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_access")
    .select("role")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data?.role as AccessRole | undefined) ?? null;
}

async function upsertDocumentAccessRole(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  documentId: string,
  userId: string,
  incomingRole: AccessRole,
) {
  const { data, error } = await adminClient
    .from("document_access")
    .select("role")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  const nextRole = mergeAccessRole((data?.role as AccessRole | undefined) ?? null, incomingRole);

  if (data?.role === nextRole) {
    return nextRole;
  }

  const { error: upsertError } = await adminClient.from("document_access").upsert(
    {
      document_id: documentId,
      user_id: userId,
      role: nextRole,
    },
    {
      onConflict: "document_id,user_id",
    },
  );

  if (upsertError) {
    throw new AppError(500, upsertError.message);
  }

  return nextRole;
}

function findSignerForUser(document: DocumentRecord, user: Pick<AuthenticatedUser, "id" | "rawEmail">) {
  const normalizedEmail = normalizeEmailAddress(user.rawEmail);
  return (
    document.signers.find(
      (signer) =>
        signer.userId === user.id || normalizeEmailAddress(signer.email) === normalizedEmail,
    ) ?? null
  );
}

async function updateDocumentWorkflowStatus(
  documentId: string,
  userId: string,
  status: WorkflowOperationalStatus,
  reason: string | null,
) {
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      workflow_status: status,
      workflow_status_reason: reason?.trim() || null,
      workflow_status_updated_at: now,
      workflow_status_updated_by_user_id: userId,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }
}

function ensureSignerCanRespondToWorkflow(
  document: DocumentRecord,
  user: Pick<AuthenticatedUser, "id" | "rawEmail">,
) {
  if (document.workflowStatus !== "active") {
    throw new AppError(409, "This workflow is paused or closed. Ask the initiator to resume it before continuing.");
  }

  const signer = findSignerForUser(document, user);

  if (!signer) {
    throw new AppError(403, "You are not assigned as a signer on this document.");
  }

  const eligibleSignerIds = getEligibleSignerIdsForNotifications(document);

  if (!eligibleSignerIds.includes(signer.id)) {
    throw new AppError(
      409,
      "This signer is not active yet. Complete the current stage or signing order before continuing.",
    );
  }

  return signer;
}

async function queueOriginatorWorkflowUpdate(
  document: DocumentRecord,
  actorUserId: string,
  actorLabel: string,
  summary: string,
  appOrigin?: string,
) {
  const originator = await getProfileById(document.uploadedByUserId);

  if (!originator?.email) {
    return;
  }

  await queueNotification(document.id, "workflow_update", originator.email, {
    recipientUserId: originator.id,
    metadata: {
      ...(appOrigin ? { appOrigin } : {}),
      signerName: actorLabel,
      actionLabel: "action",
      summary,
    },
  });

  await appendAuditEvent(
    document.id,
    actorUserId,
    "notification.queued",
    `Queued workflow update for the initiator: ${summary}`,
    {
      originatorNotified: true,
    },
  );
}

async function requireDocumentBundle(documentId: string) {
  const adminClient = createServiceRoleClient();
  const [
    documentResponse,
    accessResponse,
    signerResponse,
    fieldResponse,
    versionResponse,
    auditResponse,
    notificationResponse,
    snapshotResponse,
  ] = await Promise.all([
    adminClient.from("documents").select("*").eq("id", documentId).is("deleted_at", null).maybeSingle(),
    adminClient.from("document_access").select("document_id, user_id, role").eq("document_id", documentId),
    adminClient
      .from("document_signers")
      .select("id, document_id, user_id, name, email, participant_type, required, routing_stage, signing_order")
      .eq("document_id", documentId),
    adminClient
      .from("document_fields")
      .select(
        "id, document_id, page, kind, label, required, assignee_signer_id, source, x, y, width, height, value, applied_saved_signature_id, completed_at, completed_by_signer_id",
      )
      .eq("document_id", documentId),
    adminClient
      .from("document_versions")
      .select("id, document_id, label, created_at, created_by_user_id, note, change_impact, change_impact_summary")
      .eq("document_id", documentId),
    adminClient
      .from("document_audit_events")
      .select("id, document_id, type, created_at, actor_user_id, summary, metadata")
      .eq("document_id", documentId),
    adminClient
      .from("document_notifications")
      .select(
        "id, document_id, event_type, channel, status, provider, recipient_email, recipient_user_id, recipient_signer_id, queued_at, delivered_at, metadata",
      )
      .eq("document_id", documentId),
    adminClient
      .from("document_editor_snapshots")
      .select("history_index")
      .eq("document_id", documentId)
      .order("history_index", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (documentResponse.error) {
    throw new AppError(500, documentResponse.error.message);
  }

  if (!documentResponse.data) {
    throw new AppError(404, "Document not found.");
  }

  for (const response of [
    accessResponse,
    signerResponse,
    fieldResponse,
    versionResponse,
    auditResponse,
    notificationResponse,
    snapshotResponse,
  ]) {
	  if (response.error) {
	      throw new AppError(500, response.error.message);
	    }
	  }

  const accessRows = (accessResponse.data ?? []) as DocumentAccessRow[];
  const accessUserIds = [...new Set(accessRows.map((entry) => entry.user_id))];
  let accessProfiles: ProfileRow[] = [];

  if (accessUserIds.length > 0) {
    const profileById = await getProfileIdentitiesById(adminClient, accessUserIds);
    accessProfiles = Array.from(profileById.values()).map(mapProfileIdentityToProfileRow);
  }

  return mapDocumentRecord(
    documentResponse.data as DocumentRow,
    accessRows,
    accessProfiles,
    (signerResponse.data ?? []) as SignerRow[],
    (fieldResponse.data ?? []) as FieldRow[],
    (versionResponse.data ?? []) as DocumentVersionRow[],
    (auditResponse.data ?? []) as AuditEventRow[],
    (notificationResponse.data ?? []) as NotificationRow[],
    ((snapshotResponse.data as { history_index: number } | null)?.history_index ??
      (documentResponse.data as DocumentRow).editor_history_index ??
      0),
  );
}

function toWorkflowDocumentResponse(
  document: DocumentRecord & {
    editorHistory: { currentIndex: number; latestIndex: number };
    accessProfileDirectory?: Array<{ userId: string; displayName: string; email: string | null }>;
  },
  userId: string,
): WorkflowDocumentResponse {
  const normalizedUserId = userId.trim();
  const currentUserSigner = document.signers.find((signer) => signer.userId === normalizedUserId) ?? null;
  const accessProfileById = new Map(accessProfilesForDocument(document).map((profile) => [profile.userId, profile]));
  const waitingOn = getWorkflowWaitingOn(document);
  const overdue = isWorkflowOverdue(document);

  return {
    ...document,
    currentUserRole: document.access.find((entry) => entry.userId === normalizedUserId)?.role ?? null,
    currentUserIsSigner: Boolean(currentUserSigner),
    currentUserSignerId: currentUserSigner?.id ?? null,
    accessParticipants: document.access.map((entry) => {
      const participant = accessProfileById.get(entry.userId);
      return {
        userId: entry.userId,
        role: entry.role,
        displayName: participant?.displayName ?? "Workspace user",
        email: participant?.email ?? null,
      };
    }),
    workflowState: deriveWorkflowState(document),
    operationalStatus: overdue ? "overdue" : document.workflowStatus,
    isOverdue: overdue,
    waitingOn,
    eligibleSignerIds: getEligibleSignerIdsForNotifications(document),
    signable: isDocumentSignable(document),
    completionSummary: getDocumentCompletionSummary(document),
    editorHistory: {
      currentIndex: document.editorHistory.currentIndex,
      latestIndex: document.editorHistory.latestIndex,
      canUndo: document.editorHistory.currentIndex > 0,
      canRedo: document.editorHistory.currentIndex < document.editorHistory.latestIndex,
    },
  };
}

function accessProfilesForDocument(
  document: DocumentRecord & {
    accessProfileDirectory?: Array<{ userId: string; displayName: string; email: string | null }>;
  },
) {
  return document.accessProfileDirectory ?? [];
}

function getWorkflowWaitingOn(document: DocumentRecord) {
  const dueAt = document.dueAt;
  const overdue = isWorkflowOverdue(document);

  if (document.workflowStatus === "canceled") {
    return {
      kind: "canceled" as const,
      summary: document.workflowStatusReason?.trim()
        ? `Canceled: ${document.workflowStatusReason.trim()}`
        : "Canceled by the initiator.",
      signerId: null,
      signerName: null,
      signerEmail: null,
      actionLabel: null,
      stage: null,
      dueAt,
      isOverdue: false,
    };
  }

  if (document.workflowStatus === "rejected") {
    return {
      kind: "rejected" as const,
      summary: document.workflowStatusReason?.trim()
        ? `Rejected: ${document.workflowStatusReason.trim()}`
        : "Rejected by the current participant.",
      signerId: null,
      signerName: null,
      signerEmail: null,
      actionLabel: null,
      stage: null,
      dueAt,
      isOverdue: false,
    };
  }

  if (document.workflowStatus === "changes_requested") {
    return {
      kind: "initiator" as const,
      summary: document.workflowStatusReason?.trim()
        ? `Changes requested: ${document.workflowStatusReason.trim()}`
        : "Changes were requested from the initiator.",
      signerId: null,
      signerName: null,
      signerEmail: null,
      actionLabel: null,
      stage: null,
      dueAt,
      isOverdue: false,
    };
  }

  if (!document.sentAt) {
    return {
      kind: "setup" as const,
      summary: "Finish setup, then send the workflow.",
      signerId: null,
      signerName: null,
      signerEmail: null,
      actionLabel: null,
      stage: null,
      dueAt,
      isOverdue: false,
    };
  }

  if (deriveWorkflowState(document) === "completed") {
    return {
      kind: "completed" as const,
      summary: "All required workflow actions are complete.",
      signerId: null,
      signerName: null,
      signerEmail: null,
      actionLabel: null,
      stage: null,
      dueAt,
      isOverdue: false,
    };
  }

  const eligibleSignerIds = getEligibleSignerIdsForNotifications(document);
  const nextSigner = document.signers.find((signer) => eligibleSignerIds.includes(signer.id)) ?? null;
  const pendingFields = getPendingRequiredAssignedFields(document).filter(
    (field) => field.assigneeSignerId === nextSigner?.id,
  );
  const actionLabel: "signature" | "approval" | "action" | null = pendingFields.some(
    (field) => field.kind === "approval",
  )
    ? pendingFields.every((field) => field.kind === "approval")
      ? "approval"
      : "action"
    : pendingFields.length > 0
      ? "signature"
      : null;

  if (nextSigner) {
    return {
      kind: "participant" as const,
      summary: overdue
        ? `Overdue: waiting on ${nextSigner.name} to complete their next ${actionLabel ?? "action"}.`
        : `Waiting on ${nextSigner.name} to complete their next ${actionLabel ?? "action"}.`,
      signerId: nextSigner.id,
      signerName: nextSigner.name,
      signerEmail: nextSigner.email,
      actionLabel,
      stage: nextSigner.routingStage ?? null,
      dueAt,
      isOverdue: overdue,
    };
  }

  return {
    kind: "none" as const,
    summary: overdue ? "Overdue and waiting on workflow routing." : "Waiting on the next workflow transition.",
    signerId: null,
    signerName: null,
    signerEmail: null,
    actionLabel: null,
    stage: null,
    dueAt,
    isOverdue: overdue,
  };
}

async function appendAuditEvent(
  documentId: string,
  actorUserId: string,
  type: AuditEvent["type"],
  summary: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_audit_events").insert({
    document_id: documentId,
    actor_user_id: actorUserId,
    type,
    summary,
    metadata,
  });

  if (error) {
    throw new AppError(500, error.message);
  }
}

async function queueNotification(
  documentId: string,
  eventType: NotificationRow["event_type"],
  recipientEmail: string,
  options: {
    recipientUserId?: string | null;
    recipientSignerId?: string | null;
    metadata?: Record<string, string | number | boolean>;
  } = {},
) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_notifications")
    .insert({
      document_id: documentId,
      event_type: eventType,
      channel: "email",
      status: "queued",
      recipient_email: recipientEmail,
      recipient_user_id: options.recipientUserId ?? null,
      recipient_signer_id: options.recipientSignerId ?? null,
      provider: "pending",
      metadata: options.metadata ?? {},
    })
    .select(
      "id, document_id, event_type, channel, status, provider, recipient_email, recipient_user_id, recipient_signer_id, queued_at, delivered_at, metadata",
    )
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to queue notification.");
  }

  if (hasNotificationEmailConfig()) {
    await deliverNotificationRow(data as NotificationRow);
  }
}

function hasNotificationEmailConfig() {
  const env = readServerEnv();
  return Boolean(getConfiguredNotificationEmailProvider(env));
}

function assertNotificationEmailReady() {
  const env = readServerEnv();

  if (getConfiguredNotificationEmailProvider(env)) {
    return true;
  }

  if (!shouldRequireEmailDelivery(env)) {
    return false;
  }

  throw new AppError(
    503,
    "Managed email delivery is required in this environment. Configure Resend or SMTP before sending platform-managed workflows.",
  );
}

function getNotificationActionOrigin(notification: NotificationRow) {
  const env = readServerEnv();
  const metadataOrigin =
    typeof notification.metadata?.appOrigin === "string" ? notification.metadata.appOrigin.trim() : "";
  const candidateOrigin = metadataOrigin || getCanonicalAppOrigin(env);

  return candidateOrigin.replace(/\/+$/, "");
}

function buildNotificationEmailContent(notification: NotificationRow, document: DocumentRecord) {
  const origin = getNotificationActionOrigin(notification);
  const signingToken =
    typeof notification.metadata?.signingToken === "string" ? notification.metadata.signingToken : null;
  const actionUrl = signingToken
    ? `${origin}?documentId=${encodeURIComponent(document.id)}&signingToken=${encodeURIComponent(signingToken)}`
    : `${origin}?documentId=${encodeURIComponent(document.id)}`;
  const actorLabel =
    typeof notification.metadata?.signerName === "string" ? notification.metadata.signerName : "A signer";
  const fieldLabel =
    typeof notification.metadata?.fieldLabel === "string" ? notification.metadata.fieldLabel : "a required field";
  const actionLabel =
    typeof notification.metadata?.actionLabel === "string" ? notification.metadata.actionLabel : "signature";
  const summary =
    typeof notification.metadata?.summary === "string" ? notification.metadata.summary : "Workflow updated";

  if (notification.event_type === "workflow_update") {
    return {
      subject: `Workflow update for ${document.name}`,
      html: `<p>${summary}</p><p><a href="${actionUrl}">Open the document in EasyDraft</a></p>`,
    };
  }

  if (notification.event_type === "signature_progress") {
    const subject =
      actionLabel === "approval"
        ? `${actorLabel} approved ${document.name}`
        : `${actorLabel} completed an action on ${document.name}`;

    return {
      subject,
      html: `<p>${actorLabel} completed ${fieldLabel} on <strong>${document.name}</strong>.</p><p><a href="${actionUrl}">Open the document in EasyDraft</a></p>`,
    };
  }

  const subject =
    actionLabel === "approval" ? `Approval requested for ${document.name}` : `Action requested for ${document.name}`;

  return {
    subject,
    html: `<p>You have a pending ${actionLabel} request on <strong>${document.name}</strong>.</p><p><a href="${actionUrl}">Open the document in EasyDraft</a></p>`,
  };
}

async function deliverNotificationRow(notification: NotificationRow) {
  const env = readServerEnv();
  const configuredProvider = getConfiguredNotificationEmailProvider(env);
  const adminClient = createServiceRoleClient();

  if (!configuredProvider) {
    if (shouldRequireEmailDelivery(env)) {
      await adminClient
        .from("document_notifications")
        .update({
          status: "failed",
          provider: "unconfigured",
        })
        .eq("id", notification.id);

      throw new AppError(
        503,
        "Managed email delivery is required in this environment. Configure Resend or SMTP before sending platform-managed workflows.",
      );
    }

    return { delivered: false, reason: "provider_not_configured" } as const;
  }

  const document = await requireDocumentBundle(notification.document_id);
  const emailContent = buildNotificationEmailContent(notification, document);

  try {
    const delivery = await deliverNotificationEmail(env, {
      to: notification.recipient_email,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    if (!delivery) {
      return { delivered: false, reason: "provider_not_configured" } as const;
    }

    await adminClient
      .from("document_notifications")
      .update({
        status: "sent",
        provider: delivery.provider,
        delivered_at: new Date().toISOString(),
        metadata: {
          ...(notification.metadata ?? {}),
          providerMessageId: delivery.messageId ?? "",
        },
      })
      .eq("id", notification.id);

    await appendAuditEvent(
      notification.document_id,
      "system",
      "notification.sent",
      `Delivered ${notification.event_type.replaceAll("_", " ")} email to ${notification.recipient_email}`,
      {
        provider: delivery.provider,
      },
    );

    return { delivered: true } as const;
  } catch (error) {
    await adminClient
      .from("document_notifications")
      .update({
        status: "failed",
        provider: configuredProvider,
      })
      .eq("id", notification.id);
    throw error;
  }
}

async function listFieldRowsForDocument(documentId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_fields")
    .select(
      "id, document_id, page, kind, label, required, assignee_signer_id, source, x, y, width, height, value, applied_saved_signature_id, completed_at, completed_by_signer_id",
    )
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data ?? []) as FieldRow[];
}

async function ensureInitialEditorSnapshot(documentId: string, userId: string, fieldRows: FieldRow[]) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_editor_snapshots")
    .select("id")
    .eq("document_id", documentId)
    .limit(1);

  if (error) {
    throw new AppError(500, error.message);
  }

  if ((data ?? []).length > 0) {
    return;
  }

  const { error: insertError } = await adminClient.from("document_editor_snapshots").insert({
    document_id: documentId,
    history_index: 0,
    action_key: "initial",
    label: "Initial field map",
    fields: fieldRows,
    created_by_user_id: userId,
  });

  if (insertError) {
    throw new AppError(500, insertError.message);
  }
}

async function pushEditorSnapshot(
  documentId: string,
  userId: string,
  actionKey: string,
  label: string,
  fieldRows: FieldRow[],
) {
  const adminClient = createServiceRoleClient();
  const { data: documentRow, error: documentError } = await adminClient
    .from("documents")
    .select("editor_history_index")
    .eq("id", documentId)
    .maybeSingle();

  if (documentError || !documentRow) {
    throw new AppError(404, documentError?.message ?? "Document not found.");
  }

  const currentIndex = (documentRow as { editor_history_index: number }).editor_history_index ?? 0;
  const nextIndex = currentIndex + 1;

  const { error: deleteFutureError } = await adminClient
    .from("document_editor_snapshots")
    .delete()
    .eq("document_id", documentId)
    .gt("history_index", currentIndex);

  if (deleteFutureError) {
    throw new AppError(500, deleteFutureError.message);
  }

  const { error: insertError } = await adminClient.from("document_editor_snapshots").insert({
    document_id: documentId,
    history_index: nextIndex,
    action_key: actionKey,
    label,
    fields: fieldRows,
    created_by_user_id: userId,
  });

  if (insertError) {
    throw new AppError(500, insertError.message);
  }

  const { error: updateError } = await adminClient
    .from("documents")
    .update({ editor_history_index: nextIndex })
    .eq("id", documentId);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }
}

async function restoreEditorSnapshot(
  documentId: string,
  snapshot: EditorSnapshotRow,
) {
  const adminClient = createServiceRoleClient();
  const { error: deleteError } = await adminClient
    .from("document_fields")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) {
    throw new AppError(500, deleteError.message);
  }

  const fields = Array.isArray(snapshot.fields) ? snapshot.fields : [];

  if (fields.length > 0) {
    const { error: insertError } = await adminClient.from("document_fields").insert(
      fields.map((field) => ({
        id: field.id,
        document_id: documentId,
        page: field.page,
        kind: field.kind,
        label: field.label,
        required: field.required,
        assignee_signer_id: field.assignee_signer_id,
        source: field.source,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        value: field.value,
        applied_saved_signature_id: field.applied_saved_signature_id,
        completed_at: field.completed_at,
        completed_by_signer_id: field.completed_by_signer_id,
      })),
    );

    if (insertError) {
      throw new AppError(500, insertError.message);
    }
  }

  const { error: updateError } = await adminClient
    .from("documents")
    .update({ editor_history_index: snapshot.history_index })
    .eq("id", documentId);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }
}

async function getProfileById(userId: string) {
  const adminClient = createServiceRoleClient();
  const profileById = await getProfileIdentitiesById(adminClient, [userId]);
  const profile = profileById.get(userId);

  return profile
    ? { id: profile.id, email: profile.email, display_name: profile.display_name }
    : null;
}

function getPendingRequiredAssignedFields(document: DocumentRecord) {
  return document.fields.filter(
    (field) =>
      field.required &&
      !!field.assigneeSignerId &&
      isActionFieldKind(field.kind) &&
      !field.completedAt,
  );
}

async function assertWorkspaceHasActivePlan(workspaceId: string) {
  const env = readServerEnv();
  if (!env.STRIPE_SECRET_KEY) {
    if (shouldRequireStripe(env)) {
      throw new AppError(
        503,
        "Stripe billing is required in this environment. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before sending documents.",
      );
    }

    return; // placeholder mode — no billing gate
  }

  const adminClient = createServiceRoleClient();
  const { data } = await adminClient
    .from("workspace_subscriptions")
    .select("status")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const subscription = (data ?? [])[0] ?? null;

  if (!subscription || !["active", "trialing"].includes(subscription.status)) {
    throw new AppError(
      402,
      "An active subscription is required to send documents. Visit the billing section to subscribe.",
    );
  }
}

async function assertWorkspaceHasSigningTokens(workspaceId: string, count: number) {
  const env = readServerEnv();
  if (!env.STRIPE_SECRET_KEY) {
    if (shouldRequireStripe(env)) {
      throw new AppError(
        503,
        "Stripe billing is required in this environment. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before sending external signing links.",
      );
    }

    return; // placeholder mode — unlimited tokens
  }

  const { available } = await getWorkspaceSigningTokenBalance(workspaceId);

  if (available < count) {
    throw new AppError(
      402,
      `Not enough external signer tokens. ${available} available, ${count} needed. Purchase a token bundle ($12 CAD = 12 tokens) in the Billing section.`,
    );
  }
}

async function generateSigningToken(
  documentId: string,
  signerId: string,
  signerEmail: string,
  expiresAt: string,
) {
  const adminClient = createServiceRoleClient();
  const token = crypto.randomUUID();

  await adminClient
    .from("document_signing_tokens")
    .update({
      voided_at: new Date().toISOString(),
      void_reason: "superseded",
      verification_code_hash: null,
      verification_code_sent_at: null,
      verification_code_expires_at: null,
      verification_attempt_count: 0,
      verified_at: null,
    })
    .eq("document_id", documentId)
    .eq("signer_id", signerId)
    .is("voided_at", null);

  const { error } = await adminClient.from("document_signing_tokens").insert({
    document_id: documentId,
    signer_id: signerId,
    signer_email: signerEmail,
    token,
    expires_at: expiresAt,
    verification_code_hash: null,
    verification_code_sent_at: null,
    verification_code_expires_at: null,
    verification_attempt_count: 0,
    verified_at: null,
    void_reason: null,
  });

  if (error) {
    throw new AppError(500, `Failed to create signing token: ${error.message}`);
  }

  return token;
}

async function getOrReuseSigningToken(
  documentId: string,
  signerId: string,
  signerEmail: string,
  expiresAt: string,
) {
  const adminClient = createServiceRoleClient();
  const { data } = await adminClient
    .from("document_signing_tokens")
    .select("token, expires_at, voided_at")
    .eq("document_id", documentId)
    .eq("signer_id", signerId)
    .is("voided_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = (data ?? [])[0] ?? null;

  if (existing && new Date(existing.expires_at) > new Date()) {
    return existing.token as string;
  }

  return generateSigningToken(documentId, signerId, signerEmail, expiresAt);
}

async function requireValidSigningToken(token: string, documentId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_signing_tokens")
    .select(
      "id, document_id, signer_id, signer_email, token, expires_at, voided_at, verification_code_hash, verification_code_sent_at, verification_code_expires_at, verification_attempt_count, verified_at, last_viewed_at, last_completed_at, void_reason",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data) {
    throw new AppError(401, "Invalid signing link.");
  }

  if (data.voided_at) {
    throw new AppError(
      410,
      data.void_reason === "completed"
        ? "This signing link has already been completed."
        : data.void_reason === "revoked"
          ? "This signing link is no longer active. Ask the sender to send a new reminder."
          : "This signing link is no longer active. Ask the sender to send a new reminder.",
    );
  }

  if (new Date(data.expires_at) < new Date()) {
    throw new AppError(410, "This signing link has expired. Ask the sender to send a reminder.");
  }

  if (data.document_id !== documentId) {
    throw new AppError(403, "Signing link does not match this document.");
  }

  return data as SigningTokenRow;
}

function hashSigningVerificationCode(token: string, code: string) {
  return createHash("sha256").update(`${token}:${code}`).digest("hex");
}

function createSigningVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function maskEmailAddress(email: string) {
  const [localPart, domainPart] = email.split("@");

  if (!localPart || !domainPart) {
    return email;
  }

  const visibleLocal = localPart.length <= 2
    ? `${localPart[0] ?? ""}*`
    : `${localPart.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(localPart.length - 2, 4)))}`;

  return `${visibleLocal}@${domainPart}`;
}

function hasVerifiedSigningToken(tokenRow: SigningTokenRow) {
  return Boolean(tokenRow.verified_at);
}

function toSigningVerificationState(tokenRow: SigningTokenRow) {
  const sentAt = tokenRow.verification_code_sent_at ?? null;

  return {
    required: true,
    verified: hasVerifiedSigningToken(tokenRow),
    verifiedAt: tokenRow.verified_at ?? null,
    codeSentAt: sentAt,
    codeExpiresAt: tokenRow.verification_code_expires_at ?? null,
    retryAvailableAt: sentAt ? addSecondsToTimestamp(sentAt, SIGNING_VERIFICATION_RESEND_COOLDOWN_SECONDS) : null,
    attemptsRemaining: Math.max(0, SIGNING_VERIFICATION_MAX_ATTEMPTS - Number(tokenRow.verification_attempt_count ?? 0)),
    emailHint: maskEmailAddress(tokenRow.signer_email),
  };
}

async function invalidateSigningTokensForSigner(
  documentId: string,
  signerId: string,
  reason: "completed" | "revoked" | "superseded",
) {
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("document_signing_tokens")
    .update({
      voided_at: now,
      void_reason: reason,
      verification_code_hash: null,
      verification_code_sent_at: null,
      verification_code_expires_at: null,
      verification_attempt_count: 0,
    })
    .eq("document_id", documentId)
    .eq("signer_id", signerId)
    .is("voided_at", null);

  if (error) {
    throw new AppError(500, `Failed to invalidate signing links: ${error.message}`);
  }
}

async function markSigningTokenViewed(tokenRow: SigningTokenRow) {
  const adminClient = createServiceRoleClient();
  await adminClient
    .from("document_signing_tokens")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", tokenRow.id);
}

async function ensureSigningVerificationForAction(tokenRow: SigningTokenRow, fieldKind: Field["kind"]) {
  if (!isActionFieldKind(fieldKind)) {
    return;
  }

  if (!hasVerifiedSigningToken(tokenRow)) {
    throw new AppError(
      403,
      `Enter the verification code sent to ${maskEmailAddress(tokenRow.signer_email)} before completing this signing action.`,
    );
  }
}

function getEligibleSignerIdsForNotifications(document: DocumentRecord) {
  const pendingFields = getPendingRequiredAssignedFields(document);

  if (pendingFields.length === 0) {
    return [] as string[];
  }

  const signerById = new Map(document.signers.map((signer) => [signer.id, signer]));
  const pendingFieldsInCurrentStage = pendingFields
    .map((field) => ({
      field,
      signer: signerById.get(field.assigneeSignerId ?? ""),
    }))
    .filter((entry): entry is { field: Field; signer: Signer } => Boolean(entry.signer));

  if (pendingFieldsInCurrentStage.length === 0) {
    return [] as string[];
  }

  const nextStage = Math.min(
    ...pendingFieldsInCurrentStage.map((entry) => entry.signer.routingStage ?? 1),
  );
  const stagePendingFields = pendingFieldsInCurrentStage.filter(
    (entry) => (entry.signer.routingStage ?? 1) === nextStage,
  );

  if (document.routingStrategy === "parallel") {
    return [
      ...new Set(stagePendingFields.map((entry) => entry.field.assigneeSignerId).filter(Boolean)),
    ] as string[];
  }

  const signerOrderById = new Map(
    document.signers.map((signer) => [signer.id, signer.signingOrder ?? Number.MAX_SAFE_INTEGER]),
  );
  const nextOrder = Math.min(
    ...stagePendingFields.map(
      (entry) => signerOrderById.get(entry.field.assigneeSignerId ?? "") ?? Number.MAX_SAFE_INTEGER,
    ),
  );

  return [
    ...new Set(
      stagePendingFields
        .filter(
          (entry) =>
            (signerOrderById.get(entry.field.assigneeSignerId ?? "") ?? Number.MAX_SAFE_INTEGER) ===
            nextOrder,
        )
        .map((entry) => entry.field.assigneeSignerId)
        .filter(Boolean),
    ),
  ] as string[];
}

async function queueEligibleSignerNotifications(
  document: DocumentRecord,
  actorUserId: string,
  eligibleSignerIds: string[],
  options: { reason: string; actorLabel: string; appOrigin?: string; signerTokens?: Map<string, string> },
) {
  if (document.deliveryMode !== "platform_managed" || eligibleSignerIds.length === 0) {
    return;
  }

  const signersToNotify = document.signers.filter((signer) => eligibleSignerIds.includes(signer.id));
  const pendingFieldsForEligibleSigners = getPendingRequiredAssignedFields(document).filter((field) =>
    eligibleSignerIds.includes(field.assigneeSignerId ?? ""),
  );
  const actionLabel = pendingFieldsForEligibleSigners.some((field) => field.kind === "approval")
    ? pendingFieldsForEligibleSigners.every((field) => field.kind === "approval")
      ? "approval"
      : "action"
    : "signature";

  await Promise.all(
    signersToNotify.map((signer) => {
      const signingToken = options.signerTokens?.get(signer.id);
      return queueNotification(document.id, "signature_request", signer.email, {
        recipientUserId: signer.userId || null,
        recipientSignerId: signer.id,
        metadata: {
          ...(options.appOrigin ? { appOrigin: options.appOrigin } : {}),
          ...(signingToken ? { signingToken } : {}),
          signerName: signer.name,
          actionLabel,
          reason: options.reason,
        },
      });
    }),
  );

  await appendAuditEvent(
    document.id,
    actorUserId,
    "notification.queued",
    `${options.actorLabel} queued ${signersToNotify.length} signer notification${signersToNotify.length === 1 ? "" : "s"}`,
    {
      recipients: signersToNotify.length,
      sequential: document.routingStrategy === "sequential",
    },
  );
}

async function appendSignatureEvent(event: SignatureEventInsert) {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("signature_events").insert({
    document_id: event.document_id,
    signer_type: event.signer_type,
    signer_email: event.signer_email,
    signer_user_id: event.signer_user_id,
    event_type: event.event_type,
    ip_address: event.ip_address,
    user_agent: event.user_agent,
    metadata: event.metadata,
  });

  if (error) {
    throw new AppError(500, error.message);
  }
}

async function appendSignatureEventOnce(event: SignatureEventInsert, dedupeKey: string) {
  const adminClient = createServiceRoleClient();
  const metadata = {
    ...event.metadata,
    dedupe_key: dedupeKey,
  };
  const { data, error } = await adminClient
    .from("signature_events")
    .select("id")
    .eq("document_id", event.document_id)
    .eq("event_type", event.event_type)
    .contains("metadata", { dedupe_key: dedupeKey })
    .limit(1);

  if (error) {
    throw new AppError(500, error.message);
  }

  if ((data ?? []).length > 0) {
    return false;
  }

  await appendSignatureEvent({
    ...event,
    metadata,
  });

  return true;
}

function getDocumensoBaseUrl(env: ReturnType<typeof readServerEnv>) {
  return env.DOCUMENSO_API_BASE_URL.replace(/\/+$/, "");
}

function getDocumensoHost(env: ReturnType<typeof readServerEnv>) {
  return getDocumensoBaseUrl(env).replace(/\/api\/v2$/, "");
}

function assertDocumensoConfiguration() {
  const env = readServerEnv();

  if (!env.DOCUMENSO_API_KEY) {
    throw new AppError(500, "DOCUMENSO_API_KEY is required for Documenso signing.");
  }

  if (!env.DOCUMENSO_WEBHOOK_SECRET) {
    throw new AppError(500, "DOCUMENSO_WEBHOOK_SECRET is required for Documenso signing webhooks.");
  }

  return env as ReturnType<typeof readServerEnv> & {
    DOCUMENSO_API_KEY: string;
    DOCUMENSO_WEBHOOK_SECRET: string;
  };
}

async function callDocumenso<TResponse>(path: string, init?: RequestInit) {
  const env = assertDocumensoConfiguration();
  const response = await fetch(`${getDocumensoBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      Authorization: env.DOCUMENSO_API_KEY,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new AppError(502, `Documenso request failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return (await response.json()) as TResponse;
}

async function callDocumensoBinary(path: string) {
  const env = assertDocumensoConfiguration();
  const response = await fetch(`${getDocumensoBaseUrl(env)}${path}`, {
    headers: {
      Authorization: env.DOCUMENSO_API_KEY,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new AppError(502, `Documenso download failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function createDocumensoEnvelope(
  document: DocumentRecord,
  sourceBuffer: Buffer,
  payload: Record<string, unknown>,
) {
  assertDocumensoConfiguration();
  const formData = new FormData();
  const sourceBytes = new Uint8Array(sourceBuffer.byteLength);
  sourceBytes.set(sourceBuffer);
  formData.append("payload", JSON.stringify(payload));
  formData.append("files", new Blob([sourceBytes], { type: "application/pdf" }), document.fileName);

  return callDocumenso<{ id: string }>("/envelope/create", {
    method: "POST",
    body: formData,
  });
}

function getDocumensoRecipientRole(fields: Field[]) {
  if (fields.length > 0 && fields.every((field) => field.kind === "approval")) {
    return "APPROVER" as const;
  }

  return "SIGNER" as const;
}

function mapFieldKindToDocumensoType(kind: Field["kind"]) {
  switch (kind) {
    case "signature":
      return "SIGNATURE" as const;
    case "initial":
      return "INITIALS" as const;
    case "date":
      return "DATE" as const;
    case "text":
      return "TEXT" as const;
    case "checkbox":
      return "CHECKBOX" as const;
    default:
      return null;
  }
}

function toDocumensoPercentage(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Number(((value / total) * 100).toFixed(4))));
}

async function buildDocumensoRecipients(document: DocumentRecord) {
  const { sourceBlob } = await downloadSourceDocumentBlob(document);
  const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer());
  const pdfDocument = await PDFDocument.load(sourceBuffer);
  const pages = pdfDocument.getPages();

  const recipients = document.signers.map((signer) => {
    const assignedFields = document.fields.filter((field) => field.assigneeSignerId === signer.id);
    const documensoFields = assignedFields.flatMap((field) => {
      const documensoType = mapFieldKindToDocumensoType(field.kind);

      if (!documensoType || field.kind === "approval") {
        return [];
      }

      const page = pages[field.page - 1];

      if (!page) {
        throw new AppError(400, `Field ${field.label} points to a missing PDF page.`);
      }

      const { width, height } = page.getSize();

      return [
        {
          identifier: 0,
          type: documensoType,
          page: field.page,
          positionX: toDocumensoPercentage(field.x, width),
          positionY: toDocumensoPercentage(field.y, height),
          width: toDocumensoPercentage(field.width, width),
          height: toDocumensoPercentage(field.height, height),
          ...(field.kind === "text" ? { meta: { type: "text" } } : {}),
        },
      ];
    });

    return {
      email: signer.email,
      name: signer.name,
      role: getDocumensoRecipientRole(assignedFields),
      signingOrder: document.routingStrategy === "sequential" ? signer.signingOrder ?? undefined : undefined,
      ...(documensoFields.length > 0 ? { fields: documensoFields } : {}),
    };
  });

  return {
    sourceBuffer,
    recipients,
  };
}

async function getLatestDocumensoEnvelopeMetadata(documentId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("signature_events")
    .select("metadata")
    .eq("document_id", documentId)
    .contains("metadata", { provider: "documenso" })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data?.metadata ?? null) as Record<string, string | number | boolean | null> | null;
}

async function getLatestDocumensoRecipientMetadata(documentId: string, signerEmail: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("signature_events")
    .select("metadata")
    .eq("document_id", documentId)
    .eq("signer_email", signerEmail)
    .contains("metadata", { provider: "documenso" })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data?.metadata ?? null) as Record<string, string | number | boolean | null> | null;
}

async function downloadSourceDocumentBlob(document: Pick<DocumentRecord, "storagePath">) {
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();

  for (const bucket of getSourceDocumentBucketCandidates(env)) {
    const { data: sourceBlob, error: sourceDownloadError } = await adminClient.storage
      .from(bucket)
      .download(document.storagePath);

    if (!sourceDownloadError && sourceBlob) {
      return {
        bucket,
        sourceBlob,
      };
    }
  }

  throw new AppError(500, "Unable to load the source PDF.");
}

async function createSourceDocumentSignedUrl(path: string, expiresInSeconds: number) {
  const env = readServerEnv();

  for (const bucket of getSourceDocumentBucketCandidates(env)) {
    try {
      const signedUrl = await createSignedStorageUrl(bucket, path, expiresInSeconds);
      return {
        bucket,
        signedUrl,
      };
    } catch {
      // Try the next candidate bucket when the path lives in legacy storage.
    }
  }

  throw new AppError(500, "Unable to create a source document URL.");
}

async function createSignedStorageUrl(bucket: string, path: string, expiresInSeconds: number) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new AppError(500, error?.message ?? "Unable to create a signed document URL.");
  }

  return data.signedUrl;
}

function readInternalSigningCertificate() {
  const env = readServerEnv();

  if (!env.P12_CERT_BASE64) {
    throw new AppError(500, "P12_CERT_BASE64 is required for internal PDF signing.");
  }

  const p12Buffer = Buffer.from(env.P12_CERT_BASE64, "base64");

  if (p12Buffer.length === 0) {
    throw new AppError(500, "P12_CERT_BASE64 could not be decoded.");
  }

  const derBytes = p12Buffer.toString("binary");
  const asn1 = forge.asn1.fromDer(derBytes);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, env.P12_CERT_PASSPHRASE ?? "");
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificate = certBags[0]?.cert;

  if (!certificate) {
    throw new AppError(500, "No certificate was found in P12_CERT_BASE64.");
  }

  const certificateDer = forge.asn1
    .toDer(forge.pki.certificateToAsn1(certificate))
    .getBytes();
  const thumbprint = createHash("sha256")
    .update(Buffer.from(certificateDer, "binary"))
    .digest("hex");

  return {
    p12Buffer,
    passphrase: env.P12_CERT_PASSPHRASE ?? "",
    thumbprint,
  };
}

async function renderDocumentExportBuffer(document: DocumentRecord) {
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const { sourceBlob } = await downloadSourceDocumentBlob(document);
  const sourceBytes = await sourceBlob.arrayBuffer();
  const pdfDocument = await PDFDocument.load(sourceBytes);
  const regularFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const italicFont = await pdfDocument.embedFont(StandardFonts.HelveticaOblique);
  const signerById = new Map(document.signers.map((signer) => [signer.id, signer]));

  for (const field of document.fields) {
    if (!field.completedAt) {
      continue;
    }

    const page = pdfDocument.getPage(field.page - 1);

    if (!page) {
      continue;
    }

    const pageHeight = page.getHeight();
    const x = Math.max(0, field.x);
    const y = Math.max(0, pageHeight - field.y - field.height);
    const width = Math.max(24, field.width);
    const height = Math.max(16, field.height);
    const signer = field.completedBySignerId ? signerById.get(field.completedBySignerId) : null;

    if ((field.kind === "signature" || field.kind === "initial") && looksLikeStoredImagePath(field.value)) {
      const storedImagePath = field.value as string;
      const { data: imageBlob, error: imageDownloadError } = await adminClient.storage
        .from(env.SUPABASE_SIGNATURE_BUCKET)
        .download(storedImagePath);

      if (!imageDownloadError && imageBlob) {
        const imageBytes = await imageBlob.arrayBuffer();

        try {
          const image = await pdfDocument.embedPng(imageBytes);
          page.drawImage(image, { x, y, width, height });
          continue;
        } catch {
          try {
            const image = await pdfDocument.embedJpg(imageBytes);
            page.drawImage(image, { x, y, width, height });
            continue;
          } catch {
            // Fall back to text rendering below if image embedding fails.
          }
        }
      }
    }

    const primaryText =
      field.kind === "approval"
        ? signer?.name
          ? `Approved by ${signer.name}`
          : "Approved"
        : field.value && field.value !== "completed"
          ? field.value
          : signer?.name ?? "Signed";
    const secondaryText =
      field.kind === "approval"
        ? formatCompletedAtLabel(field.completedAt)
        : signer?.name && primaryText !== signer.name
          ? signer.name
          : formatCompletedAtLabel(field.completedAt);
    const tertiaryText =
      secondaryText && secondaryText !== formatCompletedAtLabel(field.completedAt)
        ? formatCompletedAtLabel(field.completedAt)
        : "";
    const primaryFontSize = Math.max(10, Math.min(18, height * (field.kind === "initial" ? 0.5 : 0.6)));
    const secondaryFontSize = Math.max(7, Math.min(10, height * 0.22));
    const tertiaryFontSize = Math.max(7, Math.min(9, height * 0.2));
    const textX = x + 3;
    const primaryY = y + Math.max(4, height - primaryFontSize - 4);

    page.drawText(primaryText, {
      x: textX,
      y: primaryY,
      size: primaryFontSize,
      font: field.kind === "signature" || field.kind === "initial" ? italicFont : regularFont,
      color: rgb(0.12, 0.12, 0.16),
      maxWidth: Math.max(12, width - 6),
    });

    if (secondaryText) {
      page.drawText(secondaryText, {
        x: textX,
        y: y + Math.max(2, height * 0.26),
        size: secondaryFontSize,
        font: regularFont,
        color: rgb(0.35, 0.35, 0.42),
        maxWidth: Math.max(12, width - 6),
      });
    }

    if (tertiaryText) {
      page.drawText(tertiaryText, {
        x: textX,
        y: y + 2,
        size: tertiaryFontSize,
        font: regularFont,
        color: rgb(0.42, 0.42, 0.48),
        maxWidth: Math.max(12, width - 6),
      });
    }
  }
  const exportBuffer = Buffer.from(await pdfDocument.save());
  const exportSha256 = createHash("sha256").update(exportBuffer).digest("hex");

  return {
    exportBuffer,
    exportSha256,
  };
}

async function renderDocumentExportToStorage(document: DocumentRecord) {
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const { exportBuffer, exportSha256 } = await renderDocumentExportBuffer(document);
  const exportPath = getDocumentExportPath(document.uploadedByUserId, document.id);

  const { error: uploadError } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .upload(exportPath, exportBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new AppError(500, uploadError.message);
  }

  // Persist the hash so it can appear in completion certificates and audit records.
  await adminClient
    .from("documents")
    .update({ export_sha256: exportSha256, export_storage_bytes: exportBuffer.length })
    .eq("id", document.id);

  return { exportPath, exportSha256, bucket: env.SUPABASE_DOCUMENT_BUCKET };
}

async function createExportSignedUrl(document: DocumentRecord, expiresInSeconds: number) {
  const env = readServerEnv();
  const signedInternalPath = getSignedInternalSignaturePath(document.uploadedByUserId, document.id);
  const signedDocumensoPath = getSignedDocumensoPath(document.uploadedByUserId, document.id);

  if (document.status === "signed" && (document.signaturePath === 1 || document.signaturePath === 2)) {
    const signedPath = document.signaturePath === 1 ? signedInternalPath : signedDocumensoPath;

    try {
      const signedUrl = await createSignedStorageUrl(
        env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
        signedPath,
        expiresInSeconds,
      );

      return {
        signedUrl,
        exportPath: signedPath,
      };
    } catch {
      // Fall back to rendering the unsigned export if the signed object is missing.
    }
  }

  const { exportPath, bucket } = await renderDocumentExportToStorage(document);
  const signedUrl = await createSignedStorageUrl(bucket, exportPath, expiresInSeconds);

  return {
    signedUrl,
    exportPath,
  };
}

async function appendVersion(
  documentId: string,
  createdByUserId: string,
  label: string,
  note: string,
  changeImpact: DocumentChangeImpact | null = null,
  changeImpactSummary: string | null = null,
) {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_versions").insert({
    document_id: documentId,
    created_by_user_id: createdByUserId,
    label,
    note,
    change_impact: changeImpact,
    change_impact_summary: changeImpactSummary,
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  if (changeImpact) {
    const now = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("documents")
      .update({
        latest_change_impact: changeImpact,
        latest_change_impact_summary: changeImpactSummary ?? note,
        latest_change_impact_at: now,
      })
      .eq("id", documentId);

    if (updateError) {
      throw new AppError(500, updateError.message);
    }
  }
}

async function resetCompletedActionFields(documentId: string) {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient
    .from("document_fields")
    .update({
      value: null,
      applied_saved_signature_id: null,
      completed_at: null,
      completed_by_signer_id: null,
    })
    .eq("document_id", documentId)
    .in("kind", ["signature", "initial", "approval"]);

  if (error) {
    throw new AppError(500, error.message);
  }
}

async function queueWorkflowUpdateForRecipient(
  documentId: string,
  recipientEmail: string,
  summary: string,
  metadata: Record<string, string | number | boolean | null>,
  recipientUserId?: string | null,
  recipientSignerId?: string | null,
) {
  await queueNotification(documentId, "workflow_update", recipientEmail, {
    recipientUserId: recipientUserId ?? null,
    recipientSignerId: recipientSignerId ?? null,
    metadata: {
      ...metadata,
      summary,
    },
  });
}

async function applyDocumentChangeImpact(
  document: DocumentRecord,
  actorUserId: string,
  actorLabel: string,
  assessment: ChangeImpactAssessment,
  appOrigin?: string,
) {
  const adminClient = createServiceRoleClient();
  await appendVersion(
    document.id,
    actorUserId,
    `Change impact: ${describeChangeImpact(assessment.impact)}`,
    assessment.summary,
    assessment.impact,
    assessment.summary,
  );
  await appendAuditEvent(
    document.id,
    actorUserId,
    assessment.impact === "resign_required" ? "document.resign_required" : "document.change_impact.assessed",
    assessment.summary,
    {
      changeImpact: assessment.impact,
    },
  );

  if (assessment.impact === "non_material") {
    return;
  }

  if (assessment.impact === "review_required") {
    await updateDocumentWorkflowStatus(document.id, actorUserId, "changes_requested", assessment.summary);
    await queueOriginatorWorkflowUpdate(document, actorUserId, actorLabel, assessment.summary, appOrigin);
    return;
  }

  await resetCompletedActionFields(document.id);
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      completed_at: null,
      locked_at: null,
      locked_by_user_id: null,
      workflow_status: "active",
      workflow_status_reason: assessment.summary,
      workflow_status_updated_at: now,
      workflow_status_updated_by_user_id: actorUserId.startsWith("guest:") ? null : actorUserId,
    })
    .eq("id", document.id);

  if (error) {
    throw new AppError(500, error.message);
  }

  const metadata = {
    ...(appOrigin ? { appOrigin } : {}),
    actorLabel,
    changeImpact: assessment.impact,
  };
  await queueOriginatorWorkflowUpdate(document, actorUserId, actorLabel, assessment.summary, appOrigin);

  const notifiedEmails = new Set<string>();
  for (const signer of document.signers) {
    const completedField = document.fields.find(
      (field) => field.completedBySignerId === signer.id && isActionFieldKind(field.kind),
    );

    if (!completedField || notifiedEmails.has(signer.email)) {
      continue;
    }

    await queueWorkflowUpdateForRecipient(
      document.id,
      signer.email,
      assessment.summary,
      metadata,
      signer.userId,
      signer.id,
    );
    notifiedEmails.add(signer.email);
  }
}

async function assertPermission(
  documentId: string,
  user: Pick<AuthenticatedUser, "id" | "rawEmail">,
  action: Parameters<typeof canPerformDocumentAction>[1],
) {
  const role = await getDocumentRole(documentId, user.id);

  if (role && canPerformDocumentAction(role, action)) {
    return role;
  }

  if (action === "lock_document") {
    const document = await requireDocumentBundle(documentId);

    if (role === "editor" && document.lockPolicy !== "owner_only") {
      return role;
    }

    if (document.lockPolicy === "owner_editors_and_active_signer") {
      const signer = findSignerForUser(document, user);
      const eligibleSignerIds = getEligibleSignerIdsForNotifications(document);

      if (signer && eligibleSignerIds.includes(signer.id)) {
        return role ?? "signer";
      }
    }
  }

  if (
    action === "complete_assigned_field" ||
    action === "request_workflow_changes" ||
    action === "reject_workflow"
  ) {
    const adminClient = createServiceRoleClient();
    const { data: byUserId, error: byUserIdError } = await adminClient
      .from("document_signers")
      .select("id")
      .eq("document_id", documentId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (byUserIdError) {
      throw new AppError(500, byUserIdError.message);
    }

    if (byUserId) {
      return role ?? "signer";
    }

    const { data: byEmail, error: byEmailError } = await adminClient
      .from("document_signers")
      .select("id")
      .eq("document_id", documentId)
      .ilike("email", normalizeEmailAddress(user.rawEmail))
      .limit(1)
      .maybeSingle();

    if (byEmailError) {
      throw new AppError(500, byEmailError.message);
    }

    if (byEmail) {
      return role ?? "signer";
    }
  }

  throw new AppError(403, "You do not have permission to perform this action.");
}

export async function getSessionFromAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: isAdminUser(user),
    },
  };
}

export async function createFeedbackRequest(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const parsed = createFeedbackRequestInputSchema.parse(input);
  const maybeUser = await tryResolveAuthenticatedUser(authorizationHeader);
  const requesterEmail = maybeUser?.email ?? parsed.email?.trim().toLowerCase();

  if (!requesterEmail) {
    throw new AppError(400, "Email is required when you are not signed in.");
  }

  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("feedback_requests")
    .insert({
      feedback_type: parsed.feedbackType,
      title: parsed.title,
      details: parsed.details,
      requester_email: requesterEmail,
      requester_user_id: maybeUser?.id ?? null,
      source: parsed.source,
      requested_path: parsed.requestedPath,
    })
    .select("id, feedback_type, title, requester_email, source, requested_path, status, priority, created_at")
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to save feedback right now.");
  }

  return {
    feedback: {
      id: (data as { id: string }).id,
      feedbackType: (data as { feedback_type: "bug_report" | "feature_request" }).feedback_type,
      title: (data as { title: string }).title,
      requesterEmail: (data as { requester_email: string }).requester_email,
      source: (data as { source: string }).source,
      requestedPath: (data as { requested_path: string | null }).requested_path,
      status: (data as { status: FeedbackRequestStatus }).status,
      priority: (data as { priority: FeedbackRequestPriority }).priority,
      createdAt: (data as { created_at: string }).created_at,
    },
  };
}

export async function listAdminFeedbackRequestsForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("feedback_requests")
    .select(
      "id, feedback_type, title, details, requester_email, requester_user_id, source, requested_path, status, priority, owner_user_id, updated_by_user_id, resolution_note, resolved_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new AppError(500, error.message);
  }

  const rows = (data ?? []) as FeedbackRequestRow[];
  const relatedProfileIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.owner_user_id, row.updated_by_user_id]).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );

  const profileById = new Map<string, { display_name: string; email: string }>();

  if (relatedProfileIds.length > 0) {
    const profileRows = await getProfileIdentitiesById(adminClient, relatedProfileIds);

    for (const profile of profileRows.values()) {
      profileById.set(profile.id, {
        display_name: profile.display_name,
        email: profile.email,
      });
    }
  }

  return {
    feedbackRequests: rows.map((row) => ({
      id: row.id,
      feedbackType: row.feedback_type,
      title: row.title,
      details: row.details,
      requesterEmail: row.requester_email,
      requesterUserId: row.requester_user_id,
      source: row.source,
      requestedPath: row.requested_path,
      status: row.status,
      priority: row.priority,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: row.owner_user_id ? profileById.get(row.owner_user_id)?.display_name ?? "Assigned admin" : null,
      ownerEmail: row.owner_user_id ? profileById.get(row.owner_user_id)?.email ?? null : null,
      updatedByUserId: row.updated_by_user_id,
      updatedByDisplayName:
        row.updated_by_user_id ? profileById.get(row.updated_by_user_id)?.display_name ?? "Admin" : null,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function updateAdminFeedbackRequestForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const parsed = updateAdminFeedbackRequestInputSchema.parse(input);

  if (
    parsed.status === undefined &&
    parsed.priority === undefined &&
    parsed.ownerUserId === undefined &&
    parsed.resolutionNote === undefined
  ) {
    throw new AppError(400, "Choose at least one feedback field to update.");
  }

  const adminClient = createServiceRoleClient();
  const updatePayload: Record<string, string | null> = {
    updated_by_user_id: user.id,
  };

  if (parsed.status !== undefined) {
    updatePayload.status = parsed.status;
    updatePayload.resolved_at = parsed.status === "closed" ? new Date().toISOString() : null;
  }

  if (parsed.priority !== undefined) {
    updatePayload.priority = parsed.priority;
  }

  if (parsed.ownerUserId !== undefined) {
    updatePayload.owner_user_id = parsed.ownerUserId;
  }

  if (parsed.resolutionNote !== undefined) {
    updatePayload.resolution_note = parsed.resolutionNote?.trim() || null;
  }

  const { data, error } = await adminClient
    .from("feedback_requests")
    .update(updatePayload)
    .eq("id", parsed.feedbackRequestId)
    .select(
      "id, feedback_type, title, details, requester_email, requester_user_id, source, requested_path, status, priority, owner_user_id, updated_by_user_id, resolution_note, resolved_at, created_at, updated_at",
    )
    .maybeSingle();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to update feedback right now.");
  }

  const row = data as FeedbackRequestRow;

  return {
    feedbackRequest: {
      id: row.id,
      status: row.status,
      priority: row.priority,
      ownerUserId: row.owner_user_id,
      updatedByUserId: row.updated_by_user_id,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function getProfileForAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);

  return {
    profile: mapAuthenticatedUserProfile(user),
  };
}

export async function markOnboardingCompleteForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.profileMetadata ?? {}),
      onboarding_completed_at: new Date().toISOString(),
    },
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  return { ok: true };
}

export async function updateProfileForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = updateProfileInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  await syncProfileIdentity({
    id: user.id,
    email: user.rawEmail,
    displayName: parsed.displayName,
    companyName: parsed.companyName?.trim() || null,
    accountType: user.accountType,
    workspaceName: user.workspaceName ?? null,
    profileKind: user.profileKind,
  });
  const { error } = await adminClient.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.profileMetadata ?? {}),
      full_name: parsed.displayName,
      company_name: parsed.companyName?.trim() || undefined,
      job_title: parsed.jobTitle?.trim() || undefined,
      locale: parsed.locale?.trim() || undefined,
      timezone: parsed.timezone?.trim() || undefined,
      marketing_opt_in: parsed.marketingOptIn,
      product_updates_opt_in: parsed.productUpdatesOptIn,
    },
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    profile: mapAuthenticatedUserProfile(user, {
      displayName: parsed.displayName,
      companyName: parsed.companyName?.trim() || null,
      jobTitle: parsed.jobTitle?.trim() || null,
      locale: parsed.locale?.trim() || null,
      timezone: parsed.timezone?.trim() || null,
      marketingOptIn: parsed.marketingOptIn,
      productUpdatesOptIn: parsed.productUpdatesOptIn,
    }),
  };
}

export async function listDigitalSignatureProfilesForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  assertCertificateSigningEnabledForRequest();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("digital_signature_profiles")
    .select(
      "id, user_id, label, title_text, signer_name, signer_email, organization_name, signing_reason, provider, assurance_level, status, certificate_fingerprint, provider_reference, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    profiles: ((data ?? []) as DigitalSignatureProfileRow[]).map(mapDigitalSignatureProfile),
  };
}

export async function createDigitalSignatureProfileForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  assertCertificateSigningEnabledForRequest();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = createDigitalSignatureProfileInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();
  const providerConnected =
    Boolean(env.EASYDRAFT_DIGITAL_SIGNING_API_KEY) &&
    env.EASYDRAFT_DIGITAL_SIGNING_PROVIDER === parsed.provider;
  const { data, error } = await adminClient
    .from("digital_signature_profiles")
    .insert({
      user_id: user.id,
      label: parsed.label,
      title_text: parsed.titleText?.trim() || null,
      signer_name: parsed.signerName,
      signer_email: parsed.signerEmail,
      organization_name: parsed.organizationName?.trim() || null,
      signing_reason: parsed.signingReason,
      provider: parsed.provider,
      assurance_level: parsed.assuranceLevel,
      status: providerConnected ? "setup_required" : "requested",
      provider_reference: providerConnected ? `${parsed.provider}-${crypto.randomUUID()}` : null,
    })
    .select(
      "id, user_id, label, title_text, signer_name, signer_email, organization_name, signing_reason, provider, assurance_level, status, certificate_fingerprint, provider_reference, created_at, updated_at",
    )
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to create digital signature profile request.");
  }

  return {
    profile: mapDigitalSignatureProfile(data as DigitalSignatureProfileRow),
  };
}

export async function getAdminOverviewForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const adminClient = createServiceRoleClient();
  const authUsers = await listAdminAuthUsers(adminClient);
  const [
    workspacesCount,
    documentsCount,
    sentDocumentsCount,
    completedDocumentsCount,
    pendingNotificationsCount,
    failedNotificationsCount,
    oldestPendingNotificationResponse,
    queuedJobsCount,
    oldestQueuedJobResponse,
    subscriptionsResponse,
    billingCustomersCount,
    workspacesResponse,
  ] = await Promise.all([
    adminClient.from("workspaces").select("*", { count: "exact", head: true }),
    adminClient.from("documents").select("*", { count: "exact", head: true }).is("deleted_at", null),
    adminClient
      .from("documents")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("sent_at", "is", null),
    adminClient
      .from("documents")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("completed_at", "is", null),
    adminClient
      .from("document_notifications")
      .select("*", { count: "exact", head: true })
      .eq("status", "queued"),
    adminClient
      .from("document_notifications")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed"),
    adminClient
      .from("document_notifications")
      .select("queued_at")
      .eq("status", "queued")
      .order("queued_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("document_processing_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "running"]),
    adminClient
      .from("document_processing_jobs")
      .select("created_at")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("workspace_subscriptions")
      .select(
        "id, workspace_id, billing_plan_key, status, seat_count, current_period_end, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(8),
    adminClient.from("workspace_billing_customers").select("*", { count: "exact", head: true }),
    adminClient
      .from("workspaces")
      .select("id, name, slug, workspace_type, owner_user_id, billing_email, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  for (const response of [
    workspacesCount,
    documentsCount,
    sentDocumentsCount,
    completedDocumentsCount,
    pendingNotificationsCount,
    failedNotificationsCount,
    oldestPendingNotificationResponse,
    queuedJobsCount,
    oldestQueuedJobResponse,
    subscriptionsResponse,
    billingCustomersCount,
    workspacesResponse,
  ]) {
    if (response.error) {
      throw new AppError(500, response.error.message);
    }
  }

  const planRowsResponse = await adminClient
    .from("billing_plans")
    .select("key, name, monthly_price_usd, billing_interval")
    .eq("active", true);

  if (planRowsResponse.error) {
    throw new AppError(500, planRowsResponse.error.message);
  }

  const planPriceByKey = new Map(
    ((planRowsResponse.data ?? []) as Array<{
      key: string;
      name: string;
      monthly_price_usd: number;
      billing_interval?: "month" | "year";
    }>).map((plan) => [
      plan.key,
      (plan.billing_interval ?? "month") === "year" ? plan.monthly_price_usd / 12 : plan.monthly_price_usd,
    ]),
  );
  const subscriptions = (subscriptionsResponse.data ??
    []) as Array<{
    id: string;
    workspace_id: string;
    billing_plan_key: string;
    status: string;
    seat_count: number;
    current_period_end: string | null;
    updated_at: string;
  }>;
  const estimatedMrrUsd = subscriptions
    .filter((subscription) => ["active", "trialing", "past_due"].includes(subscription.status))
    .reduce(
      (sum, subscription) =>
        sum + (planPriceByKey.get(subscription.billing_plan_key) ?? 0) * subscription.seat_count,
      0,
    );

  return {
    metrics: {
      totalUsers: authUsers.length,
      totalWorkspaces: workspacesCount.count ?? 0,
      totalDocuments: documentsCount.count ?? 0,
      sentDocuments: sentDocumentsCount.count ?? 0,
      completedDocuments: completedDocumentsCount.count ?? 0,
      pendingNotifications: pendingNotificationsCount.count ?? 0,
      failedNotifications: failedNotificationsCount.count ?? 0,
      oldestPendingNotificationAt:
        (oldestPendingNotificationResponse.data as { queued_at: string } | null)?.queued_at ?? null,
      queuedProcessingJobs: queuedJobsCount.count ?? 0,
      oldestQueuedProcessingAt:
        (oldestQueuedJobResponse.data as { created_at: string } | null)?.created_at ?? null,
      billingCustomers: billingCustomersCount.count ?? 0,
      estimatedMrrUsd,
    },
    recentSubscriptions: subscriptions,
    recentWorkspaces: (workspacesResponse.data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      workspace_type: string;
      owner_user_id: string;
      billing_email: string | null;
      created_at: string;
    }>,
  };
}

export async function listAdminUsersForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const adminClient = createServiceRoleClient();
  const authUsers = await listAdminAuthUsers(adminClient);
  const userIds = authUsers.map((authUser) => authUser.id);

  if (userIds.length === 0) {
    return { users: [] as AdminManagedUserResponse[] };
  }

  const [profileById, membershipsResponse, documentsResponse] = await Promise.all([
    getProfileIdentitiesById(adminClient, userIds),
    adminClient
      .from("workspace_memberships")
      .select("workspace_id, user_id, role")
      .in("user_id", userIds),
    adminClient
      .from("documents")
      .select("id, uploaded_by_user_id")
      .is("deleted_at", null)
      .in("uploaded_by_user_id", userIds),
  ]);

  for (const response of [membershipsResponse, documentsResponse]) {
    if (response.error) {
      throw new AppError(500, response.error.message);
    }
  }

  const memberships = (membershipsResponse.data ?? []) as Array<{
    workspace_id: string;
    user_id: string;
    role: "owner" | "admin" | "member" | "billing_admin";
  }>;
  const workspaceIds = [...new Set(memberships.map((membership) => membership.workspace_id))];
  const workspacesResponse =
    workspaceIds.length > 0
      ? await adminClient.from("workspaces").select("id, name").in("id", workspaceIds)
      : { data: [], error: null };

  if (workspacesResponse.error) {
    throw new AppError(500, workspacesResponse.error.message);
  }

  const workspaceById = new Map(
    ((workspacesResponse.data ?? []) as Array<{ id: string; name: string }>).map((workspace) => [
      workspace.id,
      workspace,
    ]),
  );
  const membershipsByUserId = new Map<string, typeof memberships>();

  for (const membership of memberships) {
    const list = membershipsByUserId.get(membership.user_id) ?? [];
    list.push(membership);
    membershipsByUserId.set(membership.user_id, list);
  }

  const documentCountByUserId = new Map<string, number>();

  for (const row of (documentsResponse.data ?? []) as Array<{ id: string; uploaded_by_user_id: string }>) {
    documentCountByUserId.set(
      row.uploaded_by_user_id,
      (documentCountByUserId.get(row.uploaded_by_user_id) ?? 0) + 1,
    );
  }

  const adminEmails = getAdminEmailSet();
  const users: AdminManagedUserResponse[] = authUsers
    .map((authUser) => {
      const profile = profileById.get(authUser.id);
      const email = authUser.email ?? profile?.email ?? "";
      const normalizedEmail = email.toLowerCase();
      const workspaceMemberships = membershipsByUserId.get(authUser.id) ?? [];
      const status: AdminManagedUserResponse["status"] = authUser.email_confirmed_at
        ? "confirmed"
        : "pending_confirmation";
      const privilegeLabels = [
        ...(adminEmails.has(normalizedEmail) ? ["platform admin"] : []),
        ...workspaceMemberships.map((membership) => {
          const workspace = workspaceById.get(membership.workspace_id);
          return `${membership.role} @ ${workspace?.name ?? membership.workspace_id}`;
        }),
      ];

      return {
        id: authUser.id,
        email,
        displayName:
          profile?.display_name ??
          authUser.user_metadata?.full_name ??
          authUser.user_metadata?.name ??
          email.split("@")[0] ??
          "Unknown user",
        username: profile?.username ?? deriveUsername(email),
        companyName: profile?.company_name ?? null,
        accountType: profile?.account_type ?? null,
        workspaceName: profile?.workspace_name ?? null,
        profileKind: profile?.profile_kind ?? null,
        createdAt: authUser.created_at,
        lastSignInAt: authUser.last_sign_in_at ?? null,
        emailConfirmedAt: authUser.email_confirmed_at ?? null,
        status,
        isPlatformAdmin: adminEmails.has(normalizedEmail),
        canDelete: authUser.id !== user.id && !adminEmails.has(normalizedEmail),
        workspaceCount: workspaceMemberships.length,
        documentCount: documentCountByUserId.get(authUser.id) ?? 0,
        privilegeLabels: privilegeLabels.length > 0 ? privilegeLabels : ["workspace member pending"],
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return { users };
}

export async function sendAdminPasswordResetForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const parsed = adminResetUserPasswordInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const authUser = await findAdminAuthUserById(adminClient, parsed.userId);

  if (!authUser?.email) {
    throw new AppError(404, "That user account could not be found.");
  }

  const authClient = createAuthClient();
  const { error } = await authClient.auth.resetPasswordForEmail(authUser.email, {
    redirectTo: parsed.redirectTo ?? getCanonicalAppOrigin(),
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    email: authUser.email,
    redirectTo: parsed.redirectTo ?? getCanonicalAppOrigin(),
  };
}

export async function sendAdminUserInviteForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const parsed = adminInviteUserInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const existingUser = await findAdminAuthUserByEmail(adminClient, parsed.email);

  if (existingUser?.email) {
    return {
      email: existingUser.email,
      status: existingUser.email_confirmed_at ? ("existing_account" as const) : ("pending_invite" as const),
      redirectTo: parsed.redirectTo ?? getCanonicalAppOrigin(),
    };
  }

  const redirectTo = parsed.redirectTo ?? getCanonicalAppOrigin();
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(parsed.email, {
    redirectTo,
    data: {
      full_name: parsed.displayName?.trim() || parsed.email.split("@")[0],
      profile_kind: "easydraft_staff",
    },
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    email: data.user?.email ?? parsed.email,
    status: "invited" as const,
    redirectTo,
  };
}

export async function deleteAdminUserForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  assertAdminUser(user);
  const parsed = adminDeleteUserInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const authUser = await findAdminAuthUserById(adminClient, parsed.userId);

  if (!authUser?.email) {
    throw new AppError(404, "That user account could not be found.");
  }

  if (authUser.id === user.id) {
    throw new AppError(400, "Use another admin account before deleting your own access.");
  }

  if (getAdminEmailSet().has(authUser.email.toLowerCase())) {
    throw new AppError(400, "Platform admin accounts cannot be deleted from the UI.");
  }

  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(parsed.userId, false);

  if (authDeleteError) {
    throw new AppError(500, authDeleteError.message);
  }

  const [userProfileDelete, staffProfileDelete] = await Promise.all([
    adminClient.from("easydraft_user_profiles").delete().eq("user_id", parsed.userId),
    adminClient.from("easydraft_staff_profiles").delete().eq("user_id", parsed.userId),
  ]);

  if (userProfileDelete.error || staffProfileDelete.error) {
    throw new AppError(
      500,
      userProfileDelete.error?.message ??
        staffProfileDelete.error?.message ??
        "Unable to delete user profile rows.",
    );
  }

  return {
    deletedUserId: parsed.userId,
    email: authUser.email,
  };
}

export async function deleteOwnAccountForAuthorizationHeader(
  authorizationHeader: string | undefined,
  confirmEmail: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();

  // Require the user to confirm by typing their own email address
  if (confirmEmail.trim().toLowerCase() !== user.rawEmail.toLowerCase()) {
    throw new AppError(400, "The email address you entered does not match your account.");
  }

  // ── 1. Cancel any active Stripe subscription ─────────────────────────────
  if (env.STRIPE_SECRET_KEY) {
    const { data: workspace } = await adminClient
      .from("workspaces")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (workspace?.id) {
      const { data: customer } = await adminClient
        .from("workspace_billing_customers")
        .select("provider_customer_id")
        .eq("workspace_id", workspace.id)
        .maybeSingle();

      const { data: subscription } = await adminClient
        .from("workspace_subscriptions")
        .select("provider_subscription_id, status")
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        subscription?.provider_subscription_id &&
        ["active", "trialing", "past_due"].includes(subscription.status)
      ) {
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(env.STRIPE_SECRET_KEY);
          await stripe.subscriptions.cancel(subscription.provider_subscription_id);
        } catch {
          // Non-fatal — proceed with deletion even if Stripe cancel fails
        }
      }

      void customer; // suppress unused warning
    }
  }

  // ── 2. Collect and delete all storage files ───────────────────────────────
  // Document files
  const { data: documents } = await adminClient
    .from("documents")
    .select("id, uploaded_by_user_id")
    .eq("uploaded_by_user_id", user.id)
    .not("id", "is", null);

  const documentPrefixes = (documents ?? [])
    .map((document) =>
      getDocumentStoragePrefix(
        (document as { uploaded_by_user_id: string }).uploaded_by_user_id,
        (document as { id: string }).id,
      ),
    )
    .filter(Boolean);

  if (documentPrefixes.length > 0) {
    await purgeDocumentStorageArtifactsForPrefixes(documentPrefixes);
  }

  // Saved signature images
  const { data: signatures } = await adminClient
    .from("saved_signatures")
    .select("storage_path")
    .eq("user_id", user.id)
    .not("storage_path", "is", null);

  const signaturePaths = (signatures ?? [])
    .map((s: { storage_path: string }) => s.storage_path)
    .filter(Boolean);

  if (signaturePaths.length > 0) {
    await adminClient.storage.from(env.SUPABASE_SIGNATURE_BUCKET).remove(signaturePaths);
  }

  // ── 3. Delete the auth user — cascades through profile → workspace → docs ─
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user.id, false);

  if (authDeleteError) {
    throw new AppError(500, `Account deletion failed: ${authDeleteError.message}`);
  }

  return { deleted: true };
}

export async function listSavedSignaturesForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("saved_signatures")
    .select("id, user_id, label, title_text, signature_type, typed_text, storage_path, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    signatures: await Promise.all(((data ?? []) as SavedSignatureRow[]).map(mapSavedSignature)),
  };
}

export async function createSavedSignatureForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = createSavedSignatureInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const storagePath = parsed.storagePath?.trim() || null;

  if (parsed.signatureType === "uploaded" && storagePath && !storagePath.startsWith(`${user.id}/`)) {
    throw new AppError(400, "Signature assets must be stored in the signed-in user's folder.");
  }

  if (parsed.isDefault) {
    await adminClient.from("saved_signatures").update({ is_default: false }).eq("user_id", user.id);
  }

  const { data, error } = await adminClient
    .from("saved_signatures")
    .insert({
      user_id: user.id,
      label: parsed.label,
      title_text: parsed.titleText?.trim() || null,
      signature_type: parsed.signatureType,
      typed_text: parsed.signatureType === "typed" ? parsed.typedText?.trim() || null : null,
      storage_path: parsed.signatureType === "uploaded" ? storagePath : null,
      is_default: parsed.isDefault,
    })
    .select("id, user_id, label, title_text, signature_type, typed_text, storage_path, is_default, created_at")
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to save signature.");
  }

  return {
    signature: await mapSavedSignature(data as SavedSignatureRow),
  };
}

export async function listDocumentsForAuthorizationHeader(
  authorizationHeader: string | undefined,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const workspace = await resolveWorkspaceForUser(user, preferredWorkspaceId);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_access")
    .select("document_id, documents!inner(workspace_id)")
    .eq("user_id", user.id)
    .eq("documents.workspace_id", workspace.id);

  if (error) {
    throw new AppError(500, error.message);
  }

  const documentIds = [
    ...new Set(((data ?? []) as Array<{ document_id: string }>).map((entry) => entry.document_id)),
  ];
  const settledDocuments = await Promise.allSettled(
    documentIds.map((documentId) => requireDocumentBundle(documentId)),
  );
  const documents = settledDocuments.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  return {
    documents: documents
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
      .map((document) => toWorkflowDocumentResponse(document, user.id)),
  };
}

export async function getDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await requireDocumentRole(documentId, user.id);
  const updatedDocument = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
  };
}

export async function listSignatureEventsForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await requireDocumentRole(documentId, user.id);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("signature_events")
    .select(
      "id, document_id, signer_type, signer_email, signer_user_id, event_type, ip_address, user_agent, metadata, created_at",
    )
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    events: ((data ?? []) as SignatureEventRow[]).map((event) => ({
      id: event.id,
      documentId: event.document_id,
      signerType: event.signer_type,
      signerEmail: event.signer_email,
      signerUserId: event.signer_user_id,
      eventType: event.event_type,
      ipAddress: event.ip_address,
      userAgent: event.user_agent,
      metadata: event.metadata ?? {},
      createdAt: event.created_at,
    })),
  };
}

export async function createDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = createDocumentInputSchema.parse(input);
  const workspace = await resolveWorkspaceForUser(user, preferredWorkspaceId);
  const now = new Date().toISOString();

  if (!parsed.storagePath.startsWith(`${user.id}/`)) {
    throw new AppError(400, "Storage paths must begin with the signed-in user's folder.");
  }

  const adminClient = createServiceRoleClient();
  const insertPayload = {
    id: parsed.id,
    name: parsed.name,
    file_name: parsed.fileName,
    storage_path: parsed.storagePath,
    workspace_id: workspace.id,
    signature_path: parsed.signaturePath,
    status: "pending" as const,
    delivery_mode: parsed.deliveryMode,
    distribution_target: parsed.distributionTarget?.trim() ? parsed.distributionTarget.trim() : null,
    lock_policy: parsed.lockPolicy,
    notify_originator_on_each_signature: parsed.notifyOriginatorOnEachSignature,
    due_at: parsed.dueAt,
    retention_mode: "temporary" as const,
    retention_days: DEFAULT_TEMPORARY_RETENTION_DAYS,
    purge_scheduled_at: addDaysToTimestamp(now, DEFAULT_TEMPORARY_RETENTION_DAYS),
    purged_at: null,
    purged_by_user_id: null,
    purge_reason: null,
    workflow_status: "active" as const,
    workflow_status_reason: null,
    workflow_status_updated_at: null,
    workflow_status_updated_by_user_id: null,
    page_count: parsed.pageCount,
    uploaded_at: now,
    uploaded_by_user_id: user.id,
    prepared_at: null,
    sent_at: null,
    completed_at: null,
    reopened_at: null,
    reopened_by_user_id: null,
    locked_at: null,
    locked_by_user_id: null,
    routing_strategy: parsed.routingStrategy,
    is_scanned: parsed.isScanned,
    is_ocr_complete: !parsed.isScanned,
    is_field_detection_complete: false,
    source_storage_bytes: parsed.fileSize,
    export_storage_bytes: 0,
  };

  const { error } = await adminClient.from("documents").insert(insertPayload);

  if (error) {
    throw new AppError(500, error.message);
  }

  await adminClient.from("document_access").insert({
    document_id: parsed.id,
    user_id: user.id,
    role: "owner",
  });
  await ensureInitialEditorSnapshot(parsed.id, user.id, []);

  await appendVersion(parsed.id, user.id, "Uploaded original", "Source PDF uploaded to storage");
  await appendAuditEvent(parsed.id, user.id, "document.uploaded", `Uploaded ${parsed.fileName}`);
  await appendAuditEvent(
    parsed.id,
    user.id,
    "document.delivery_mode.updated",
    `Configured ${describeDeliveryMode(parsed.deliveryMode)}`,
    {
      deliveryMode: parsed.deliveryMode,
      platformManaged: parsed.deliveryMode === "platform_managed",
      internalUseOnly: parsed.deliveryMode === "internal_use_only",
      lockPolicy: parsed.lockPolicy,
      hasDistributionTarget: Boolean(parsed.distributionTarget?.trim()),
    },
  );

  if (parsed.isScanned) {
    await requestProcessingJobForAuthorizationHeader(authorizationHeader, parsed.id, "ocr");
  }

  const document = await requireDocumentBundle(parsed.id);

  return {
    document: toWorkflowDocumentResponse(document, user.id),
  };
}

export async function prepareDocumentForInternalSignatureForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "edit_document");
  const parsed = prepareInternalSignatureInputSchema.parse(input);
  const document = await requireDocumentBundle(documentId);

  if (document.signaturePath !== 1) {
    throw new AppError(409, "This document is not configured for the internal signature path.");
  }

  const { sourceBlob } = await downloadSourceDocumentBlob(document);
  const pdfDocument = await PDFDocument.load(await sourceBlob.arrayBuffer());
  const page = pdfDocument.getPage(parsed.page - 1);

  if (!page) {
    throw new AppError(400, `Page ${parsed.page} does not exist on this PDF.`);
  }

  const pageHeight = page.getHeight();
  const bottom = Math.max(0, pageHeight - parsed.y - parsed.height);
  const widgetRect = [
    Math.max(0, parsed.x),
    bottom,
    Math.max(0, parsed.x) + parsed.width,
    bottom + parsed.height,
  ] as [number, number, number, number];

  pdflibAddPlaceholder({
    pdfDoc: pdfDocument,
    pdfPage: page,
    reason: parsed.reason,
    contactInfo: user.email,
    name: user.name,
    location: parsed.location,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    widgetRect,
  });

  const preparedBuffer = Buffer.from(await pdfDocument.save());
  const preparedPath = getPreparedInternalSignaturePath(document.uploadedByUserId, document.id);
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();

  const { error: uploadError } = await adminClient.storage
    .from(env.SUPABASE_UNSIGNED_DOCUMENT_BUCKET)
    .upload(preparedPath, preparedBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new AppError(500, uploadError.message);
  }

  const { error: updateError } = await adminClient
    .from("documents")
    .update({
      storage_path: preparedPath,
      prepared_at: now,
      source_storage_bytes: preparedBuffer.length,
      signature_path: 1,
      status: "pending",
    })
    .eq("id", documentId);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }

  await appendVersion(
    documentId,
    user.id,
    "Prepared internal signature PDF",
    `Embedded an internal signature placeholder on page ${parsed.page}`,
  );
  await appendAuditEvent(
    documentId,
    user.id,
    "document.prepared",
    `Prepared an internal signature placeholder on page ${parsed.page}`,
    {
      signaturePath: 1,
      page: parsed.page,
      x: Math.round(parsed.x),
      y: Math.round(parsed.y),
      width: Math.round(parsed.width),
      height: Math.round(parsed.height),
    },
  );

  const updatedDocument = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
    preparedPath,
  };
}

export async function createInternallySignedDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await requireDocumentRole(documentId, user.id);
  const parsed = signInternalDocumentInputSchema.parse(input);
  const document = await requireDocumentBundle(documentId);

  if (document.signaturePath !== 1) {
    throw new AppError(409, "This document is not configured for the internal signature path.");
  }

  if (!document.preparedAt) {
    throw new AppError(409, "Prepare the PDF for internal signing before signing it.");
  }

  if (deriveWorkflowState(document) !== "completed") {
    throw new AppError(409, "All required signing and approval fields must be completed before internal signing.");
  }

  const env = readServerEnv();
  const signedPath = getSignedInternalSignaturePath(document.uploadedByUserId, document.id);

  if (document.status === "signed") {
    const signedUrl = await createSignedStorageUrl(
      env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
      signedPath,
      60 * 10,
    );

    return {
      document: toWorkflowDocumentResponse(document, user.id),
      signedUrl,
      signedPath,
      exportSha256: document.exportSha256,
      certificateThumbprint: null,
    };
  }

  const { exportBuffer } = await renderDocumentExportBuffer(document);
  const { p12Buffer, passphrase, thumbprint } = readInternalSigningCertificate();
  const signer = new P12Signer(p12Buffer, { passphrase });
  const signingTime = new Date();

  let signedPdfBuffer: Buffer;

  try {
    signedPdfBuffer = await new SignPdf().sign(exportBuffer, signer, signingTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign the prepared PDF.";

    if (message.includes("No ByteRangeStrings found")) {
      throw new AppError(409, "The PDF is missing its internal signature placeholder. Prepare it again and retry.");
    }

    throw new AppError(500, message);
  }

  const adminClient = createServiceRoleClient();
  const signedSha256 = createHash("sha256").update(signedPdfBuffer).digest("hex");
  const { error: uploadError } = await adminClient.storage
    .from(env.SUPABASE_SIGNED_DOCUMENT_BUCKET)
    .upload(signedPath, signedPdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new AppError(500, uploadError.message);
  }

  const { error: updateError } = await adminClient
    .from("documents")
    .update({
      status: "signed",
      export_sha256: signedSha256,
      export_storage_bytes: signedPdfBuffer.length,
    })
    .eq("id", documentId);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }

  const matchedSigner =
    document.signers.find((signerRow) => signerRow.userId === user.id) ??
    document.signers.find((signerRow) => normalizeEmailAddress(signerRow.email) === parsed.signerEmail);

  await appendSignatureEvent({
    document_id: documentId,
    signer_type: matchedSigner?.participantType ?? "internal",
    signer_email: parsed.signerEmail,
    signer_user_id: matchedSigner?.userId ?? user.id,
    event_type: "signed",
    ip_address: null,
    user_agent: null,
    metadata: {
      certificate_thumbprint: thumbprint,
      signature_path: 1,
      signed_bucket: env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
      signed_path: signedPath,
      signer_name: parsed.signerName,
      signer_email: parsed.signerEmail,
      signing_time: signingTime.toISOString(),
    },
  });

  const signedUrl = await createSignedStorageUrl(
    env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
    signedPath,
    60 * 10,
  );
  const updatedDocument = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
    signedUrl,
    signedPath,
    exportSha256: signedSha256,
    certificateThumbprint: thumbprint,
  };
}

export async function createDocumensoEnvelopeForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "send_document");
  const document = await requireDocumentBundle(documentId);

  if (document.signaturePath !== 2) {
    throw new AppError(409, "This document is not configured for the Documenso signature path.");
  }

  const sendReadiness = getDocumentSendReadiness(document);

  if (!sendReadiness.ready) {
    throw new AppError(400, sendReadiness.blockers.join(" "));
  }

  const env = assertDocumensoConfiguration();
  const existingMetadata = await getLatestDocumensoEnvelopeMetadata(documentId);
  const existingEnvelopeId =
    typeof existingMetadata?.envelope_id === "string" ? existingMetadata.envelope_id : null;

  if (existingEnvelopeId) {
    const envelope = await callDocumenso<DocumensoEnvelope>(`/envelope/${existingEnvelopeId}`);
    const currentUserRecipient = document.signers.find(
      (signer) => signer.userId === user.id || normalizeEmailAddress(signer.email) === user.email,
    );
    const currentUserMetadata = currentUserRecipient
      ? await getLatestDocumensoRecipientMetadata(documentId, currentUserRecipient.email)
      : null;

    return {
      document: toWorkflowDocumentResponse(document, user.id),
      envelopeId: envelope.id,
      envelopeStatus: envelope.status,
      documensoHost: getDocumensoHost(env),
      currentUserRecipientToken:
        currentUserRecipient && typeof currentUserMetadata?.recipient_token === "string"
          ? currentUserMetadata.recipient_token
          : null,
      currentUserSigningUrl:
        currentUserRecipient && typeof currentUserMetadata?.signing_url === "string"
          ? currentUserMetadata.signing_url
          : null,
    };
  }

  const { sourceBuffer, recipients } = await buildDocumensoRecipients(document);
  const redirectUrl = `${(appOrigin ?? getCanonicalAppOrigin()).replace(/\/+$/, "")}/`;
  const createPayload = {
    type: "DOCUMENT",
    title: document.name,
    externalId: document.id,
    visibility: "EVERYONE",
    recipients,
    meta: {
      subject: `Please sign ${document.name}`,
      message: `Please review and complete ${document.name} in Documenso.`,
      timezone: "Etc/UTC",
      redirectUrl,
      distributionMethod: "EMAIL",
      signingOrder: document.routingStrategy === "sequential" ? "SEQUENTIAL" : "PARALLEL",
    },
  };

  const { id: envelopeId } = await createDocumensoEnvelope(document, sourceBuffer, createPayload);
  const distribution = await callDocumenso<{
    success: boolean;
    id: string;
    recipients: DocumensoRecipient[];
  }>("/envelope/distribute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      envelopeId,
    }),
  });

  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("documents")
    .update({
      signature_path: 2,
      status: "sent",
      prepared_at: now,
      sent_at: now,
      workflow_status: "active",
      workflow_status_reason: null,
      workflow_status_updated_at: now,
      workflow_status_updated_by_user_id: user.id,
    })
    .eq("id", documentId);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }

  const signerByEmail = new Map(document.signers.map((signer) => [normalizeEmailAddress(signer.email), signer]));
  let currentUserRecipientToken: string | null = null;
  let currentUserSigningUrl: string | null = null;

  for (const recipient of distribution.recipients ?? []) {
    const matchedSigner = signerByEmail.get(normalizeEmailAddress(recipient.email));
    const signingUrl =
      recipient.signingUrl ??
      (recipient.token ? `${getDocumensoHost(env)}/sign/${recipient.token}` : null);
    const dedupeKey = `documenso:sent:${envelopeId}:${recipient.id}`;
    await appendSignatureEventOnce(
      {
        document_id: documentId,
        signer_type: matchedSigner?.participantType ?? "external",
        signer_email: recipient.email,
        signer_user_id: matchedSigner?.userId ?? null,
        event_type: "sent",
        ip_address: null,
        user_agent: null,
        metadata: {
          provider: "documenso",
          signature_path: 2,
          envelope_id: envelopeId,
          recipient_id: recipient.id,
          recipient_role: recipient.role,
          recipient_token: recipient.token ?? null,
          signing_url: signingUrl,
        },
      },
      dedupeKey,
    );

    if (matchedSigner && (matchedSigner.userId === user.id || normalizeEmailAddress(matchedSigner.email) === user.email)) {
      currentUserRecipientToken = recipient.token ?? null;
      currentUserSigningUrl = signingUrl;
    }
  }

  await appendVersion(documentId, user.id, "Sent via Documenso", "Created and distributed a Documenso envelope");
  await appendAuditEvent(documentId, user.id, "document.sent", "Sent document through Documenso", {
    signaturePath: 2,
    envelopeId,
    recipients: distribution.recipients?.length ?? 0,
  });

  const updatedDocument = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
    envelopeId,
    envelopeStatus: "PENDING" as const,
    documensoHost: getDocumensoHost(env),
    currentUserRecipientToken,
    currentUserSigningUrl,
  };
}

export async function handleDocumensoWebhook(rawBody: Buffer, secretHeader: string | undefined) {
  const env = assertDocumensoConfiguration();
  const expectedSecret = env.DOCUMENSO_WEBHOOK_SECRET ?? "";
  const receivedSecret = secretHeader?.trim() ?? "";

  if (
    Buffer.byteLength(expectedSecret) !== Buffer.byteLength(receivedSecret) ||
    !timingSafeEqual(Buffer.from(receivedSecret), Buffer.from(expectedSecret))
  ) {
    throw new AppError(401, "Unauthorized");
  }

  const payload = JSON.parse(rawBody.toString("utf8")) as DocumensoWebhookPayload;
  const documentId = typeof payload.payload.externalId === "string" ? payload.payload.externalId : null;

  if (!documentId) {
    return {
      received: true,
      ignored: true,
      reason: "missing_external_id",
    };
  }

  const adminClient = createServiceRoleClient();
  const existingDocument = await requireDocumentBundle(documentId);
  const envelopeId = String(payload.payload.id);
  const signerByEmail = new Map(
    existingDocument.signers.map((signer) => [normalizeEmailAddress(signer.email), signer]),
  );

  if (payload.event === "DOCUMENT_OPENED") {
    for (const recipient of payload.payload.recipients ?? []) {
      if (recipient.readStatus !== "OPENED") {
        continue;
      }

      const matchedSigner = signerByEmail.get(normalizeEmailAddress(recipient.email));
      await appendSignatureEventOnce(
        {
          document_id: documentId,
          signer_type: matchedSigner?.participantType ?? "external",
          signer_email: recipient.email,
          signer_user_id: matchedSigner?.userId ?? null,
          event_type: "viewed",
          ip_address: null,
          user_agent: null,
          metadata: {
            provider: "documenso",
            signature_path: 2,
            envelope_id: envelopeId,
            recipient_id: recipient.id,
          },
        },
        `documenso:viewed:${envelopeId}:${recipient.id}`,
      );
    }
  }

  if (payload.event === "DOCUMENT_SIGNED" || payload.event === "DOCUMENT_RECIPIENT_COMPLETED") {
    for (const recipient of payload.payload.recipients ?? []) {
      if (recipient.signingStatus !== "SIGNED") {
        continue;
      }

      const matchedSigner = signerByEmail.get(normalizeEmailAddress(recipient.email));
      const signedAt = recipient.signedAt ?? payload.createdAt;
      await appendSignatureEventOnce(
        {
          document_id: documentId,
          signer_type: matchedSigner?.participantType ?? "external",
          signer_email: recipient.email,
          signer_user_id: matchedSigner?.userId ?? null,
          event_type: "signed",
          ip_address: null,
          user_agent: null,
          metadata: {
            provider: "documenso",
            signature_path: 2,
            envelope_id: envelopeId,
            recipient_id: recipient.id,
            signed_at: signedAt,
          },
        },
        `documenso:signed:${envelopeId}:${recipient.id}:${signedAt}`,
      );
    }
  }

  if (payload.event === "DOCUMENT_REJECTED") {
    if (existingDocument.status !== "rejected") {
      const { error } = await adminClient
        .from("documents")
        .update({
          status: "rejected",
          workflow_status: "rejected",
          workflow_status_reason: "Rejected in Documenso",
          workflow_status_updated_at: payload.createdAt,
          workflow_status_updated_by_user_id: null,
        })
        .eq("id", documentId);

      if (error) {
        throw new AppError(500, error.message);
      }
    }

    for (const recipient of payload.payload.recipients ?? []) {
      if (recipient.signingStatus !== "REJECTED") {
        continue;
      }

      const matchedSigner = signerByEmail.get(normalizeEmailAddress(recipient.email));
      await appendSignatureEventOnce(
        {
          document_id: documentId,
          signer_type: matchedSigner?.participantType ?? "external",
          signer_email: recipient.email,
          signer_user_id: matchedSigner?.userId ?? null,
          event_type: "rejected",
          ip_address: null,
          user_agent: null,
          metadata: {
            provider: "documenso",
            signature_path: 2,
            envelope_id: envelopeId,
            recipient_id: recipient.id,
            rejection_reason: recipient.rejectionReason ?? null,
          },
        },
        `documenso:rejected:${envelopeId}:${recipient.id}`,
      );
    }
  }

  if (payload.event === "DOCUMENT_COMPLETED" && existingDocument.status !== "signed") {
    const envelope = await callDocumenso<DocumensoEnvelope>(`/envelope/${envelopeId}`);
    const envelopeItems = envelope.envelopeItems ?? payload.payload.envelopeItems ?? [];
    const firstItem = envelopeItems[0];

    if (!firstItem) {
      throw new AppError(502, "Documenso did not return an envelope item to download.");
    }

    const completedPdf = await callDocumensoBinary(`/envelope/item/${firstItem.id}/download`);
    const signedPath = getSignedDocumensoPath(existingDocument.uploadedByUserId, existingDocument.id);
    const signedSha256 = createHash("sha256").update(completedPdf).digest("hex");
    const { error: uploadError } = await adminClient.storage
      .from(env.SUPABASE_SIGNED_DOCUMENT_BUCKET)
      .upload(signedPath, completedPdf, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new AppError(500, uploadError.message);
    }

    const completedAt = envelope.completedAt ?? payload.payload.completedAt ?? payload.createdAt;
    const { error: updateError } = await adminClient
      .from("documents")
      .update({
        status: "signed",
        completed_at: completedAt,
        export_sha256: signedSha256,
        export_storage_bytes: completedPdf.length,
      })
      .eq("id", documentId);

    if (updateError) {
      throw new AppError(500, updateError.message);
    }

    for (const recipient of envelope.recipients ?? payload.payload.recipients ?? []) {
      if (recipient.signingStatus !== "SIGNED") {
        continue;
      }

      const matchedSigner = signerByEmail.get(normalizeEmailAddress(recipient.email));
      const signedAt = recipient.signedAt ?? completedAt;
      await appendSignatureEventOnce(
        {
          document_id: documentId,
          signer_type: matchedSigner?.participantType ?? "external",
          signer_email: recipient.email,
          signer_user_id: matchedSigner?.userId ?? null,
          event_type: "signed",
          ip_address: null,
          user_agent: null,
          metadata: {
            provider: "documenso",
            signature_path: 2,
            envelope_id: envelopeId,
            recipient_id: recipient.id,
            signed_at: signedAt,
            signed_bucket: env.SUPABASE_SIGNED_DOCUMENT_BUCKET,
            signed_path: signedPath,
          },
        },
        `documenso:signed:${envelopeId}:${recipient.id}:${signedAt}`,
      );
    }

    await appendAuditEvent(documentId, "system", "document.completed", "Completed in Documenso", {
      signaturePath: 2,
      envelopeId,
      signedPath,
    });
  }

  return {
    received: true,
    event: payload.event,
    documentId,
  };
}

export async function addSignerForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_signers");
  const parsed = addSignerInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const { data: existingSigner, error: existingSignerError } = await adminClient
    .from("document_signers")
    .select("id")
    .eq("document_id", documentId)
    .ilike("email", parsed.email)
    .limit(1)
    .maybeSingle();

  if (existingSignerError) {
    throw new AppError(500, existingSignerError.message);
  }

  if (existingSigner) {
    throw new AppError(
      409,
      "This email is already assigned as a signer on the document. Each signer email can only appear once.",
    );
  }

  const { error } = await adminClient.from("document_signers").insert({
    document_id: documentId,
    name: parsed.name,
    email: parsed.email,
    participant_type: parsed.participantType,
    required: parsed.required,
    routing_stage: parsed.routingStage,
    signing_order: parsed.signingOrder,
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  await adminClient.from("document_invites").upsert(
    {
      document_id: documentId,
      email: parsed.email,
      role: "signer",
      invited_by_user_id: user.id,
    },
    {
      onConflict: "document_id,email,role",
      ignoreDuplicates: false,
    },
  );

  await appendAuditEvent(
    documentId,
    user.id,
    "field.assigned",
    `Added signer ${parsed.name}`,
    {
      participantType: parsed.participantType,
      required: parsed.required,
      routingStage: parsed.routingStage,
      signingOrder: parsed.signingOrder ?? 0,
    },
  );
  await appendVersion(documentId, user.id, "Updated signer routing", `Added signer ${parsed.email}`);

  if (documentHasSignedActionFields(document)) {
    await applyDocumentChangeImpact(document, user.id, user.name, {
      impact: "review_required",
      summary: `A participant was added after signing started. Review the workflow and reopen it before more signing continues.`,
    });
  }

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function updateDocumentRoutingStrategyForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_signers");
  const parsed = updateDocumentRoutingInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const { error } = await adminClient
    .from("documents")
    .update({
      routing_strategy: parsed.routingStrategy,
      prepared_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(
    documentId,
    user.id,
    "Updated routing",
    `Switched routing to ${parsed.routingStrategy}`,
  );
  await appendAuditEvent(
    documentId,
    user.id,
    "document.prepared",
    `Updated routing to ${parsed.routingStrategy}`,
  );

  if (documentHasSignedActionFields(document)) {
    await applyDocumentChangeImpact(document, user.id, user.name, {
      impact: "review_required",
      summary: `Routing changed after signing started. Review the workflow and reopen it before more signing continues.`,
    });
  }

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function updateDocumentWorkflowSettingsForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_workflow");
  const parsed = updateDocumentWorkflowSettingsInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const { error } = await adminClient
    .from("documents")
    .update({
      due_at: parsed.dueAt,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendAuditEvent(
    documentId,
    user.id,
    "document.due_date.updated",
    parsed.dueAt ? "Updated workflow due date" : "Cleared workflow due date",
    {
      hasDueDate: Boolean(parsed.dueAt),
    },
  );
  await appendVersion(
    documentId,
    user.id,
    parsed.dueAt ? "Updated workflow due date" : "Cleared workflow due date",
    parsed.dueAt ? `Workflow due date set to ${parsed.dueAt}` : "Workflow due date removed",
    documentHasSignedActionFields(document) ? "non_material" : null,
    documentHasSignedActionFields(document)
      ? "Workflow metadata changed after signing started without affecting signed fields."
      : null,
  );

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function reassignDocumentSignerForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_signers");
  const parsed = reassignSignerInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const signer = document.signers.find((candidate) => candidate.id === parsed.signerId);

  if (!signer) {
    throw new AppError(404, "Signer not found.");
  }

  const completedFieldsForSigner = document.fields.filter(
    (field) => field.completedBySignerId === signer.id && isActionFieldKind(field.kind),
  );

  if (completedFieldsForSigner.length > 0) {
    throw new AppError(
      409,
      "This participant has already completed workflow actions. Duplicate the document or reopen the workflow instead of reassigning this signer slot.",
    );
  }

  const { data: conflictingSigner, error: conflictingSignerError } = await adminClient
    .from("document_signers")
    .select("id")
    .eq("document_id", documentId)
    .ilike("email", parsed.email)
    .neq("id", parsed.signerId)
    .limit(1)
    .maybeSingle();

  if (conflictingSignerError) {
    throw new AppError(500, conflictingSignerError.message);
  }

  if (conflictingSigner) {
    throw new AppError(
      409,
      "This email is already assigned as a signer on the document. Each signer email can only appear once.",
    );
  }

  const { error } = await adminClient
    .from("document_signers")
    .update({
      name: parsed.name,
      email: parsed.email,
      user_id: null,
      participant_type: parsed.participantType ?? signer.participantType,
    })
    .eq("id", parsed.signerId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await adminClient.from("document_invites").upsert(
    {
      document_id: documentId,
      email: parsed.email,
      role: "signer",
      invited_by_user_id: user.id,
    },
    {
      onConflict: "document_id,email,role",
      ignoreDuplicates: false,
    },
  );

  await appendAuditEvent(
    documentId,
    user.id,
    "document.signer_reassigned",
    `Reassigned signer slot from ${signer.email} to ${parsed.email}`,
    {
      previousSigner: signer.email,
      nextSigner: parsed.email,
    },
  );
  await appendVersion(documentId, user.id, "Reassigned participant", `Signer slot now belongs to ${parsed.email}`);

  if (documentHasSignedActionFields(document)) {
    await applyDocumentChangeImpact(document, user.id, user.name, {
      impact: "review_required",
      summary: `A signer assignment changed after signing started. Review the workflow and reopen it before more signing continues.`,
    }, appOrigin);
  }

  const updatedDocument = await requireDocumentBundle(documentId);
  const eligibleSignerIds = getEligibleSignerIdsForNotifications(updatedDocument);

  if (
    updatedDocument.sentAt &&
    updatedDocument.workflowStatus === "active" &&
    eligibleSignerIds.includes(parsed.signerId)
  ) {
    await queueEligibleSignerNotifications(updatedDocument, user.id, [parsed.signerId], {
      reason: "signer_reassigned",
      actorLabel: user.name,
      appOrigin,
    });
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function addFieldForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "edit_document");
  const parsed = addFieldInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const currentFieldRows = await listFieldRowsForDocument(documentId);
  await ensureInitialEditorSnapshot(documentId, user.id, currentFieldRows);
  const { data, error } = await adminClient
    .from("document_fields")
    .insert({
      document_id: documentId,
      page: parsed.page,
      kind: parsed.kind,
      label: parsed.label,
      required: parsed.required,
      assignee_signer_id: parsed.assigneeSignerId,
      source: parsed.source,
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    })
    .select(
      "id, document_id, page, kind, label, required, assignee_signer_id, source, x, y, width, height, value, applied_saved_signature_id, completed_at, completed_by_signer_id",
    )
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to add field.");
  }

  await adminClient
    .from("documents")
    .update({ prepared_at: new Date().toISOString() })
    .eq("id", documentId);

  await pushEditorSnapshot(
    documentId,
    user.id,
    "field_added",
    `Added field ${parsed.label}`,
    [...currentFieldRows, data as FieldRow],
  );

  await appendAuditEvent(documentId, user.id, "field.created", `Created field ${parsed.label}`, {
    page: parsed.page,
  });
  await appendVersion(documentId, user.id, "Updated field map", `Added field ${parsed.label}`);

  const changeImpact = documentHasSignedActionFields(document)
    ? classifyFieldSetChangeImpact(document.fields, [...currentFieldRows, data as FieldRow])
    : null;

  if (changeImpact) {
    await applyDocumentChangeImpact(document, user.id, user.name, changeImpact);
  }

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function inviteCollaboratorForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_access");
  const parsed = inviteCollaboratorInputSchema.parse(input);
  const adminClient = createServiceRoleClient();

  const { error } = await adminClient.from("document_invites").upsert(
    {
      document_id: documentId,
      email: parsed.email,
      role: parsed.role,
      invited_by_user_id: user.id,
      accepted_at: null,
    },
    {
      onConflict: "document_id,email,role",
    },
  );

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(documentId, user.id, "Updated access", `Invited ${parsed.email} as ${parsed.role}`);
  await appendAuditEvent(
    documentId,
    user.id,
    "document.prepared",
    `Invited ${parsed.email} as ${parsed.role}`,
  );

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function sendDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "send_document");
  const adminClient = createServiceRoleClient();
  const currentDocument = await requireDocumentBundle(documentId);
  const sendReadiness = getDocumentSendReadiness(currentDocument);

  if (!sendReadiness.ready) {
    throw new AppError(400, sendReadiness.blockers.join(" "));
  }

  if (currentDocument.workspaceId) {
    await assertWorkspaceHasActivePlan(currentDocument.workspaceId);
  }

  if (currentDocument.deliveryMode === "platform_managed") {
    assertNotificationEmailReady();
  }

  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      prepared_at: now,
      sent_at: now,
      completed_at: null,
      purge_scheduled_at: null,
      reopened_at: null,
      reopened_by_user_id: null,
      workflow_status: "active",
      workflow_status_reason: null,
      workflow_status_updated_at: now,
      workflow_status_updated_by_user_id: user.id,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(
    documentId,
    user.id,
    currentDocument.deliveryMode === "platform_managed"
      ? "Sent for signing"
      : currentDocument.deliveryMode === "internal_use_only"
        ? "Opened for internal signing"
        : "Marked ready for distribution",
    currentDocument.deliveryMode === "platform_managed"
      ? "Document sent to assigned participants"
      : currentDocument.deliveryMode === "internal_use_only"
        ? "Document opened for internal EasyDraft signing"
        : "Document marked ready for self-managed distribution",
  );
  await appendAuditEvent(
    documentId,
    user.id,
    "document.sent",
    currentDocument.deliveryMode === "platform_managed"
      ? "Sent document for signing with managed notifications"
      : currentDocument.deliveryMode === "internal_use_only"
        ? "Marked document ready for internal EasyDraft signing"
        : "Marked document ready for self-managed distribution",
  );

  const document = await requireDocumentBundle(documentId);

  if (document.deliveryMode === "platform_managed") {
    const eligibleSignerIds = getEligibleSignerIdsForNotifications(document);
    const signerTokens = new Map<string, string>();

    if (document.workspaceId && eligibleSignerIds.length > 0) {
      const externalEligible = document.signers.filter(
        (s) => eligibleSignerIds.includes(s.id) && s.participantType === "external",
      );

      if (externalEligible.length > 0) {
        await assertWorkspaceHasSigningTokens(document.workspaceId, externalEligible.length);

        const tokenExpiry =
          document.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await Promise.all(
          externalEligible.map(async (signer) => {
            const token = await generateSigningToken(document.id, signer.id, signer.email, tokenExpiry);
            signerTokens.set(signer.id, token);
          }),
        );

        const { error: usageError } = await adminClient.from("billing_usage_events").insert(
          externalEligible.map((signer) => ({
            workspace_id: document.workspaceId,
            meter_key: "signing_token",
            quantity: 1,
            occurred_at: now,
            source_document_id: document.id,
            source_user_id: user.id,
            metadata: { signerId: signer.id, signerEmail: signer.email },
          })),
        );

        if (usageError) {
          throw new AppError(500, `Failed to record token usage: ${usageError.message}`);
        }
      }
    }

    await queueEligibleSignerNotifications(document, user.id, eligibleSignerIds, {
      reason: "document_sent",
      actorLabel: user.name,
      appOrigin,
      signerTokens,
    });
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function lockDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "lock_document");
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      locked_at: now,
      locked_by_user_id: user.id,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(documentId, user.id, "Locked snapshot", "Explicit document lock");
  await appendAuditEvent(
    documentId,
    user.id,
    "document.locked",
    "Document was explicitly locked before full completion",
  );

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function reopenDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "reopen_document");
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      locked_at: null,
      locked_by_user_id: null,
      reopened_at: now,
      reopened_by_user_id: user.id,
      completed_at: null,
      purge_scheduled_at: null,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(documentId, user.id, "Reopened workflow", "Document reopened for more signing");
  await appendAuditEvent(documentId, user.id, "document.reopened", "Document was reopened for further signing");

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function requestDocumentChangesForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "request_workflow_changes");
  const parsed = workflowResponseInputSchema.parse(input);
  const document = await requireDocumentBundle(documentId);
  const signer = ensureSignerCanRespondToWorkflow(document, user);

  await updateDocumentWorkflowStatus(documentId, user.id, "changes_requested", parsed.note);
  await appendVersion(documentId, user.id, "Changes requested", parsed.note);
  await appendAuditEvent(
    documentId,
    user.id,
    "document.changes_requested",
    `${signer.name} requested changes`,
    {
      actorEmail: signer.email,
    },
  );

  const updatedDocument = await requireDocumentBundle(documentId);

  if (updatedDocument.notifyOriginatorOnEachSignature) {
    await queueOriginatorWorkflowUpdate(
      updatedDocument,
      user.id,
      signer.name,
      `${signer.name} requested changes on ${updatedDocument.name}. ${parsed.note}`,
      appOrigin,
    );
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function rejectDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "reject_workflow");
  const parsed = workflowResponseInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const signer = ensureSignerCanRespondToWorkflow(document, user);
  const now = new Date().toISOString();

  await updateDocumentWorkflowStatus(documentId, user.id, "rejected", parsed.note);
  if (document.retentionMode === "temporary") {
    const { error: retentionError } = await adminClient
      .from("documents")
      .update({
        purge_scheduled_at: addDaysToTimestamp(now, CLOSED_WORKFLOW_PURGE_GRACE_DAYS),
      })
      .eq("id", documentId);

    if (retentionError) {
      throw new AppError(500, retentionError.message);
    }
  }
  await appendVersion(documentId, user.id, "Rejected workflow", parsed.note);
  await appendAuditEvent(
    documentId,
    user.id,
    "document.rejected",
    `${signer.name} rejected the workflow`,
    {
      actorEmail: signer.email,
    },
  );

  const updatedDocument = await requireDocumentBundle(documentId);

  if (updatedDocument.notifyOriginatorOnEachSignature) {
    await queueOriginatorWorkflowUpdate(
      updatedDocument,
      user.id,
      signer.name,
      `${signer.name} rejected ${updatedDocument.name}. ${parsed.note}`,
      appOrigin,
    );
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function cancelDocumentWorkflowForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_workflow");
  const parsed = workflowResponseInputSchema.parse(input);
  const document = await requireDocumentBundle(documentId);
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();

  await updateDocumentWorkflowStatus(documentId, user.id, "canceled", parsed.note);
  if (document.retentionMode === "temporary") {
    const { error: retentionError } = await adminClient
      .from("documents")
      .update({
        purge_scheduled_at: addDaysToTimestamp(now, CLOSED_WORKFLOW_PURGE_GRACE_DAYS),
      })
      .eq("id", documentId);

    if (retentionError) {
      throw new AppError(500, retentionError.message);
    }
  }
  await appendVersion(documentId, user.id, "Canceled workflow", parsed.note);
  await appendAuditEvent(documentId, user.id, "document.canceled", "Canceled the current workflow", {
    previouslySent: Boolean(document.sentAt),
  });

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function completeFieldForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  fieldId: string,
  input: unknown = {},
  appOrigin?: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsedInput = completeFieldInputSchema.parse(input);
  await assertPermission(documentId, user, "complete_assigned_field");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const eligibleSignerIdsBefore = getEligibleSignerIdsForNotifications(document);
  const signer = ensureSignerCanRespondToWorkflow(document, user);

  const field = document.fields.find((candidate) => candidate.id === fieldId);

  if (!field) {
    throw new AppError(404, "Field not found.");
  }

  if (field.assigneeSignerId !== signer.id) {
    throw new AppError(403, "This field is assigned to another signer.");
  }

  let appliedSavedSignature: SavedSignatureRow | null = null;

  if (parsedInput.savedSignatureId) {
    const { data: signatureRow, error: signatureError } = await adminClient
      .from("saved_signatures")
      .select("id, user_id, label, title_text, signature_type, typed_text, storage_path, is_default, created_at")
      .eq("id", parsedInput.savedSignatureId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (signatureError) {
      throw new AppError(500, signatureError.message);
    }

    if (!signatureRow) {
      throw new AppError(404, "Saved signature not found.");
    }

    appliedSavedSignature = signatureRow as SavedSignatureRow;
  }

  const completionValue =
    appliedSavedSignature?.signature_type === "typed"
      ? appliedSavedSignature.typed_text
      : appliedSavedSignature?.storage_path ?? field.value ?? "completed";
  const completedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("document_fields")
    .update({
      value: completionValue,
      applied_saved_signature_id: appliedSavedSignature?.id ?? null,
      completed_at: completedAt,
      completed_by_signer_id: signer.id,
    })
    .eq("id", fieldId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendAuditEvent(documentId, user.id, "field.completed", `Completed field ${field.label}`, {
    page: field.page,
    usedSavedSignature: Boolean(appliedSavedSignature),
    ...(parsedInput.signingReason ? { signingReason: parsedInput.signingReason } : {}),
    ...(parsedInput.signingLocation ? { signingLocation: parsedInput.signingLocation } : {}),
  });

  const updatedDocument = await requireDocumentBundle(documentId);
  const eligibleSignerIdsAfter = getEligibleSignerIdsForNotifications(updatedDocument);

  if (
    updatedDocument.deliveryMode === "platform_managed" &&
    updatedDocument.notifyOriginatorOnEachSignature &&
    isActionFieldKind(field.kind)
  ) {
    const originator = await getProfileById(updatedDocument.uploadedByUserId);

    if (originator?.email) {
      await queueNotification(documentId, "signature_progress", originator.email, {
        recipientUserId: originator.id,
        recipientSignerId: signer.id,
        metadata: {
          ...(appOrigin ? { appOrigin } : {}),
          signerName: signer.name,
          actionLabel: getActionLabelForFieldKind(field.kind),
          fieldLabel: field.label,
          fieldKind: field.kind,
        },
      });

      await appendAuditEvent(
        documentId,
        user.id,
        "notification.queued",
        `Queued originator update after ${signer.name} completed ${field.label}`,
        {
          originatorNotified: true,
        },
      );
    }
  }

  const newlyEligibleSignerIds = eligibleSignerIdsAfter.filter(
    (signerId) => !eligibleSignerIdsBefore.includes(signerId),
  );

  if (newlyEligibleSignerIds.length > 0) {
    await queueEligibleSignerNotifications(updatedDocument, user.id, newlyEligibleSignerIds, {
      reason: "previous_signer_completed",
      actorLabel: signer.name,
      appOrigin,
    });
  }

  const workflowState = deriveWorkflowState(updatedDocument);

  if (workflowState === "completed") {
    const completionTimestamp = updatedDocument.completedAt ?? new Date().toISOString();
    await adminClient
      .from("documents")
      .update({
        completed_at: completionTimestamp,
        purge_scheduled_at:
          updatedDocument.retentionMode === "temporary"
            ? addDaysToTimestamp(completionTimestamp, COMPLETED_DOCUMENT_PURGE_GRACE_DAYS)
            : null,
        locked_at: null,
        locked_by_user_id: null,
      })
      .eq("id", documentId);
    await appendVersion(documentId, user.id, "Completed document", "All required assigned action fields completed");
    await appendAuditEvent(
      documentId,
      user.id,
      "document.completed",
      "Completed all required assigned action fields",
    );
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function getDocumentDownloadUrlForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await requireDocumentRole(documentId, user.id);
  const document = await requireDocumentBundle(documentId);
  const { signedUrl } = await createExportSignedUrl(document, 60 * 10);

  return {
    signedUrl,
  };
}

export async function createDocumentShareLinkForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "export_document");
  const document = await requireDocumentBundle(documentId);
  const expiresInSeconds = 60 * 60 * 24;
  const { signedUrl } = await createExportSignedUrl(document, expiresInSeconds);

  await appendAuditEvent(documentId, user.id, "document.exported", "Generated secure share link", {
    expiresInSeconds,
  });

  return {
    url: signedUrl,
    expiresInSeconds,
  };
}

export async function clearDocumentFieldsForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_editor_history");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const currentFieldRows = await listFieldRowsForDocument(documentId);
  await ensureInitialEditorSnapshot(documentId, user.id, currentFieldRows);

  const { error } = await adminClient
    .from("document_fields")
    .delete()
    .eq("document_id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await pushEditorSnapshot(documentId, user.id, "fields_cleared", "Cleared field boxes", []);
  await appendVersion(documentId, user.id, "Cleared field boxes", "Removed all current field placements");
  await appendAuditEvent(documentId, user.id, "field.created", "Cleared all field boxes", {
    removedFieldCount: currentFieldRows.length,
  });

  const changeImpact = documentHasSignedActionFields(document)
    ? classifyFieldSetChangeImpact(document.fields, [])
    : null;

  if (changeImpact) {
    await applyDocumentChangeImpact(document, user.id, user.name, changeImpact);
  }

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function undoDocumentEditorForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_editor_history");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const currentFieldRows = await listFieldRowsForDocument(documentId);
  await ensureInitialEditorSnapshot(documentId, user.id, currentFieldRows);

  if (document.editorHistory.currentIndex <= 0) {
    throw new AppError(409, "There is no earlier editor state to undo to.");
  }

  const targetIndex = document.editorHistory.currentIndex - 1;
  const { data, error } = await adminClient
    .from("document_editor_snapshots")
    .select("id, document_id, history_index, action_key, label, fields, created_by_user_id, created_at")
    .eq("document_id", documentId)
    .eq("history_index", targetIndex)
    .maybeSingle();

  if (error || !data) {
    throw new AppError(404, error?.message ?? "Undo state not found.");
  }

  await restoreEditorSnapshot(documentId, data as EditorSnapshotRow);
  await appendVersion(documentId, user.id, "Undid field edit", `Reverted to editor state ${targetIndex}`);
  await appendAuditEvent(documentId, user.id, "field.created", "Undid field layout change", {
    historyIndex: targetIndex,
  });

  const changeImpact = documentHasSignedActionFields(document)
    ? classifyFieldSetChangeImpact(currentFieldRows, (data as EditorSnapshotRow).fields as FieldRow[])
    : null;

  if (changeImpact) {
    await applyDocumentChangeImpact(document, user.id, user.name, changeImpact);
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function redoDocumentEditorForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_editor_history");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const currentFieldRows = await listFieldRowsForDocument(documentId);

  if (document.editorHistory.currentIndex >= document.editorHistory.latestIndex) {
    throw new AppError(409, "There is no later editor state to redo to.");
  }

  const targetIndex = document.editorHistory.currentIndex + 1;
  const { data, error } = await adminClient
    .from("document_editor_snapshots")
    .select("id, document_id, history_index, action_key, label, fields, created_by_user_id, created_at")
    .eq("document_id", documentId)
    .eq("history_index", targetIndex)
    .maybeSingle();

  if (error || !data) {
    throw new AppError(404, error?.message ?? "Redo state not found.");
  }

  await restoreEditorSnapshot(documentId, data as EditorSnapshotRow);
  await appendVersion(documentId, user.id, "Redid field edit", `Restored editor state ${targetIndex}`);
  await appendAuditEvent(documentId, user.id, "field.created", "Redid field layout change", {
    historyIndex: targetIndex,
  });

  const changeImpact = documentHasSignedActionFields(document)
    ? classifyFieldSetChangeImpact(currentFieldRows, (data as EditorSnapshotRow).fields as FieldRow[])
    : null;

  if (changeImpact) {
    await applyDocumentChangeImpact(document, user.id, user.name, changeImpact);
  }

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function duplicateDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "edit_document");
  const adminClient = createServiceRoleClient();
  const sourceDocument = await requireDocumentBundle(documentId);
  const { data: sourceRow, error: sourceError } = await adminClient
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sourceError || !sourceRow) {
    throw new AppError(404, sourceError?.message ?? "Document not found.");
  }

  const newDocumentId = crypto.randomUUID();
  const nextStoragePath = `${user.id}/${newDocumentId}/${sourceDocument.fileName}`;
  const { bucket: sourceBucket, sourceBlob: fileBlob } = await downloadSourceDocumentBlob(sourceDocument);

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const now = new Date().toISOString();
  const { error: uploadError } = await adminClient.storage
    .from(sourceBucket)
    .upload(nextStoragePath, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    throw new AppError(500, uploadError.message);
  }

  const insertedDocument = {
    id: newDocumentId,
    name: `${sourceDocument.name} copy`,
    file_name: sourceDocument.fileName,
    storage_path: nextStoragePath,
    workspace_id: (sourceRow as DocumentRow).workspace_id,
    signature_path: sourceDocument.signaturePath,
    status: "pending" as const,
    editor_history_index: 0,
    delivery_mode: sourceDocument.deliveryMode,
    distribution_target: sourceDocument.distributionTarget,
    lock_policy: sourceDocument.lockPolicy,
    notify_originator_on_each_signature: sourceDocument.notifyOriginatorOnEachSignature,
    due_at: sourceDocument.dueAt,
    retention_mode: sourceDocument.retentionMode,
    retention_days: sourceDocument.retentionDays,
    purge_scheduled_at:
      sourceDocument.retentionMode === "temporary"
        ? addDaysToTimestamp(now, sourceDocument.retentionDays)
        : null,
    purged_at: null,
    purged_by_user_id: null,
    purge_reason: null,
    workflow_status: "active" as const,
    workflow_status_reason: null,
    workflow_status_updated_at: null,
    workflow_status_updated_by_user_id: null,
    page_count: sourceDocument.pageCount,
    uploaded_at: now,
    uploaded_by_user_id: user.id,
    prepared_at: sourceDocument.preparedAt,
    sent_at: null,
    completed_at: null,
    reopened_at: null,
    reopened_by_user_id: null,
    locked_at: null,
    locked_by_user_id: null,
    deleted_at: null,
    deleted_by_user_id: null,
    routing_strategy: sourceDocument.routingStrategy,
    is_scanned: sourceDocument.isScanned,
    is_ocr_complete: sourceDocument.isOcrComplete,
    is_field_detection_complete: sourceDocument.isFieldDetectionComplete,
    source_storage_bytes: buffer.length,
    export_storage_bytes: 0,
  };

  const { error: insertDocumentError } = await adminClient.from("documents").insert(insertedDocument);

  if (insertDocumentError) {
    throw new AppError(500, insertDocumentError.message);
  }

  await adminClient.from("document_access").insert({
    document_id: newDocumentId,
    user_id: user.id,
    role: "owner",
  });

  const signerIdMap = new Map<string, string>();
  if (sourceDocument.signers.length > 0) {
    const signerPayload = sourceDocument.signers.map((signer) => {
      const newSignerId = crypto.randomUUID();
      signerIdMap.set(signer.id, newSignerId);
      return {
        id: newSignerId,
        document_id: newDocumentId,
        user_id: null,
        name: signer.name,
        email: signer.email,
        participant_type: signer.participantType,
        required: signer.required,
        routing_stage: signer.routingStage,
        signing_order: signer.signingOrder,
      };
    });
    const { error: signerError } = await adminClient.from("document_signers").insert(signerPayload);

    if (signerError) {
      throw new AppError(500, signerError.message);
    }
  }

  const duplicatedFields: FieldRow[] = sourceDocument.fields.map((field) => ({
    id: crypto.randomUUID(),
    document_id: newDocumentId,
    page: field.page,
    kind: field.kind,
    label: field.label,
    required: field.required,
    assignee_signer_id: field.assigneeSignerId ? signerIdMap.get(field.assigneeSignerId) ?? null : null,
    source: field.source,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    value: null,
    applied_saved_signature_id: null,
    completed_at: null,
    completed_by_signer_id: null,
  }));

  if (duplicatedFields.length > 0) {
    const { error: fieldError } = await adminClient.from("document_fields").insert(
      duplicatedFields.map((field) => ({
        id: field.id,
        document_id: field.document_id,
        page: field.page,
        kind: field.kind,
        label: field.label,
        required: field.required,
        assignee_signer_id: field.assignee_signer_id,
        source: field.source,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        value: field.value,
        applied_saved_signature_id: field.applied_saved_signature_id,
        completed_at: field.completed_at,
        completed_by_signer_id: field.completed_by_signer_id,
      })),
    );

    if (fieldError) {
      throw new AppError(500, fieldError.message);
    }
  }

  await ensureInitialEditorSnapshot(newDocumentId, user.id, duplicatedFields);
  await appendVersion(newDocumentId, user.id, "Saved as copy", `Duplicated from ${sourceDocument.name}`);
  await appendAuditEvent(newDocumentId, user.id, "document.uploaded", `Duplicated document ${sourceDocument.name}`);

  const finalDocument = await requireDocumentBundle(newDocumentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function deleteDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "delete_document");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const { removedBytes, removedPaths } = await purgeDocumentStorageArtifactsForPrefixes([
    getDocumentStoragePrefix(document.uploadedByUserId, document.id),
  ]);

  await appendVersion(
    documentId,
    user.id,
    "Deleted document",
    "Purged stored document files and removed document from the active workspace view",
  );
  await appendAuditEvent(documentId, user.id, "document.purged", "Purged stored document files", {
    removedBytes,
    removedFiles: removedPaths.length,
  });

  const { error } = await adminClient
    .from("documents")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: user.id,
      purged_at: new Date().toISOString(),
      purged_by_user_id: user.id,
      purge_reason: "deleted_by_user",
      purge_scheduled_at: null,
      source_storage_bytes: 0,
      export_storage_bytes: 0,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    deleted: true,
    purged: true,
    removedBytes,
  };
}

export async function updateDocumentRetentionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_workflow");
  const parsed = updateDocumentRetentionInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const purgeScheduledAt = getRetentionScheduleForDocumentState({
    retentionMode: parsed.retentionMode,
    retentionDays: document.retentionDays,
    uploadedAt: document.uploadedAt,
    sentAt: document.sentAt,
    completedAt: document.completedAt,
    workflowStatus: document.workflowStatus,
    workflowStatusUpdatedAt: document.workflowStatusUpdatedAt,
  });

  const { error } = await adminClient
    .from("documents")
    .update({
      retention_mode: parsed.retentionMode,
      purge_scheduled_at: purgeScheduledAt,
      purge_reason: null,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(
    documentId,
    user.id,
    "Updated retention",
    parsed.retentionMode === "retained"
      ? "Document will stay stored in EasyDraft until manually deleted."
      : "Document uses temporary storage and will be purged automatically when eligible.",
  );
  await appendAuditEvent(
    documentId,
    user.id,
    "document.retention.updated",
    parsed.retentionMode === "retained"
      ? "Changed document retention to retained storage"
      : "Changed document retention to temporary storage",
    {
      retentionMode: parsed.retentionMode,
      hasScheduledPurge: Boolean(purgeScheduledAt),
    },
  );

  const updatedDocument = await requireDocumentBundle(documentId);
  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
  };
}

export async function renameDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  name: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "edit_document");
  const document = await requireDocumentBundle(documentId);

  const trimmed = name.trim();

  if (!trimmed) {
    throw new AppError(400, "Document name cannot be empty.");
  }

  if (trimmed.length > 255) {
    throw new AppError(400, "Document name must be 255 characters or fewer.");
  }

  const adminClient = createServiceRoleClient();

  const { error } = await adminClient
    .from("documents")
    .update({ name: trimmed })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendAuditEvent(documentId, user.id, "document.renamed", `Document renamed to "${trimmed}"`);
  await appendVersion(
    documentId,
    user.id,
    "Renamed document",
    `Document renamed to "${trimmed}"`,
    documentHasSignedActionFields(document) ? "non_material" : null,
    documentHasSignedActionFields(document)
      ? "Document metadata changed after signing started without affecting signed fields."
      : null,
  );

  const updatedDocument = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(updatedDocument, user.id),
  };
}

export async function requestProcessingJobForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  jobType: ProcessingJobType,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "edit_document");
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_processing_jobs").insert({
    document_id: documentId,
    requested_by_user_id: user.id,
    type: jobType,
    status: "queued",
    provider: "pending",
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendAuditEvent(
    documentId,
    user.id,
    jobType === "ocr" ? "processing.ocr.requested" : "processing.field_detection.requested",
    jobType === "ocr" ? "Queued OCR processing" : "Queued field detection processing",
  );

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function markProcessingJobCompleted(
  jobId: string,
  result: Record<string, string | number | boolean>,
) {
  const adminClient = createServiceRoleClient();
  const { data: job, error: jobError } = await adminClient
    .from("document_processing_jobs")
    .select("id, document_id, type")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError || !job) {
    throw new AppError(404, "Processing job not found.");
  }

  const completedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("document_processing_jobs")
    .update({
      status: "completed",
      completed_at: completedAt,
      result,
      confidence: typeof result.averageConfidence === "number" ? result.averageConfidence : null,
      provider: "mock-worker",
    })
    .eq("id", jobId);

  if (error) {
    throw new AppError(500, error.message);
  }

  if (job.type === "ocr") {
    await adminClient
      .from("documents")
      .update({ is_ocr_complete: true })
      .eq("id", job.document_id);
    await appendAuditEvent(
      job.document_id,
      "system",
      "processing.ocr.completed",
      "OCR completed",
      result,
    );
  }

  if (job.type === "field_detection") {
    await adminClient
      .from("documents")
      .update({ is_field_detection_complete: true })
      .eq("id", job.document_id);
    await appendAuditEvent(
      job.document_id,
      "system",
      "processing.field_detection.completed",
      "Automatic field detection completed",
      result,
    );
  }

  return { ok: true };
}

export async function processQueuedJobs(limit = 5) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_processing_jobs")
    .select("id, document_id, type, status")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new AppError(500, error.message);
  }

  const jobs = (data ?? []) as ProcessingJobRow[];
  const processedJobs: string[] = [];

  for (const job of jobs) {
    await adminClient
      .from("document_processing_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    let result: Record<string, string | number | boolean>;

    if (job.type === "ocr") {
      result = {
        textLayerCreated: true,
        averageConfidence: 0.94,
        pagesProcessed: 1,
      };
    } else {
      result = {
        confidence: 0.88,
        suggestions: 2,
      };
    }

    await markProcessingJobCompleted(job.id, result);
    processedJobs.push(job.id);
  }

  return {
    processedJobs,
  };
}

export async function processDueDocumentPurges(limit = 10) {
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from("documents")
    .select("id, name, uploaded_by_user_id")
    .eq("retention_mode", "temporary")
    .is("deleted_at", null)
    .is("purged_at", null)
    .not("purge_scheduled_at", "is", null)
    .lte("purge_scheduled_at", now)
    .order("purge_scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new AppError(500, error.message);
  }

  const dueDocuments = (data ?? []) as Array<{
    id: string;
    name: string;
    uploaded_by_user_id: string;
  }>;
  const purgedDocumentIds: string[] = [];

  for (const document of dueDocuments) {
    const { removedBytes, removedPaths } = await purgeDocumentStorageArtifactsForPrefixes([
      getDocumentStoragePrefix(document.uploaded_by_user_id, document.id),
    ]);
    const purgedAt = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("documents")
      .update({
        deleted_at: purgedAt,
        deleted_by_user_id: null,
        purged_at: purgedAt,
        purged_by_user_id: null,
        purge_reason: "scheduled_retention_expired",
        purge_scheduled_at: null,
        source_storage_bytes: 0,
        export_storage_bytes: 0,
      })
      .eq("id", document.id);

    if (updateError) {
      throw new AppError(500, updateError.message);
    }

    await appendAuditEvent(
      document.id,
      "system",
      "document.purged",
      `Purged stored document files after the temporary retention window expired for ${document.name}`,
      {
        removedBytes,
        removedFiles: removedPaths.length,
      },
    );
    purgedDocumentIds.push(document.id);
  }

  return {
    purgedDocumentIds,
  };
}

export async function sendSigningTokenVerificationCode(token: string, documentId: string) {
  const tokenRow = await requireValidSigningToken(token, documentId);
  const env = readServerEnv();
  const document = await requireDocumentBundle(documentId);
  const signer = document.signers.find((candidate) => candidate.id === tokenRow.signer_id);

  if (!signer) {
    throw new AppError(403, "The signer associated with this link is no longer on this document.");
  }

  if (document.workflowStatus !== "active") {
    throw new AppError(409, "This workflow is paused or closed. Ask the sender to resume it before continuing.");
  }

  assertNotificationEmailReady();

  if (tokenRow.verification_code_sent_at) {
    const resendAvailableAt = addSecondsToTimestamp(
      tokenRow.verification_code_sent_at,
      SIGNING_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    );

    if (new Date(resendAvailableAt) > new Date()) {
      throw new AppError(
        429,
        `A verification code was sent recently. Try again after ${resendAvailableAt}.`,
      );
    }
  }

  const verificationCode = createSigningVerificationCode();
  const now = new Date().toISOString();
  const expiresAt = addMinutesToTimestamp(now, SIGNING_VERIFICATION_CODE_EXPIRY_MINUTES);
  const adminClient = createServiceRoleClient();

  const { error: updateError } = await adminClient
    .from("document_signing_tokens")
    .update({
      verification_code_hash: hashSigningVerificationCode(tokenRow.token, verificationCode),
      verification_code_sent_at: now,
      verification_code_expires_at: expiresAt,
      verification_attempt_count: 0,
      verified_at: null,
    })
    .eq("id", tokenRow.id);

  if (updateError) {
    throw new AppError(500, updateError.message);
  }

  const deliveryResult = await deliverNotificationEmail(env, {
    to: signer.email,
    subject: `Verification code for ${document.name}`,
    html: buildSigningVerificationEmail(signer.name, document.name, verificationCode),
  });

  if (!deliveryResult) {
    throw new AppError(503, "Verification email delivery is not configured for this environment.");
  }

  await appendAuditEvent(
    documentId,
    `guest:${signer.email}`,
    "notification.sent",
    `Sent signing verification code to ${signer.email}`,
    {
      signerId: signer.id,
      verificationCodeSent: true,
    },
  );

  const refreshedTokenRow = await requireValidSigningToken(token, documentId);
  return {
    verification: toSigningVerificationState(refreshedTokenRow),
  };
}

export async function verifySigningTokenCode(
  token: string,
  documentId: string,
  code: string,
) {
  const tokenRow = await requireValidSigningToken(token, documentId);
  const adminClient = createServiceRoleClient();
  const normalizedCode = code.trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AppError(400, "Enter the 6-digit verification code from the email.");
  }

  if (!tokenRow.verification_code_hash || !tokenRow.verification_code_expires_at) {
    throw new AppError(409, "Request a verification code before trying to continue.");
  }

  if (new Date(tokenRow.verification_code_expires_at) < new Date()) {
    throw new AppError(410, "That verification code expired. Request a new code and try again.");
  }

  const expectedHash = hashSigningVerificationCode(tokenRow.token, normalizedCode);
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(tokenRow.verification_code_hash, "hex");
  const codeMatches =
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);

  if (!codeMatches) {
    const nextAttemptCount = Number(tokenRow.verification_attempt_count ?? 0) + 1;
    const exhausted = nextAttemptCount >= SIGNING_VERIFICATION_MAX_ATTEMPTS;

    const { error: attemptError } = await adminClient
      .from("document_signing_tokens")
      .update({
        verification_attempt_count: nextAttemptCount,
        ...(exhausted
          ? {
              verification_code_hash: null,
              verification_code_sent_at: null,
              verification_code_expires_at: null,
            }
          : {}),
      })
      .eq("id", tokenRow.id);

    if (attemptError) {
      throw new AppError(500, attemptError.message);
    }

    if (exhausted) {
      throw new AppError(429, "Too many incorrect codes. Request a new verification code to continue.");
    }

    throw new AppError(
      401,
      `Incorrect verification code. ${SIGNING_VERIFICATION_MAX_ATTEMPTS - nextAttemptCount} attempt${nextAttemptCount === SIGNING_VERIFICATION_MAX_ATTEMPTS - 1 ? "" : "s"} remaining.`,
    );
  }

  const verifiedAt = new Date().toISOString();
  const { error: verifyError } = await adminClient
    .from("document_signing_tokens")
    .update({
      verification_code_hash: null,
      verification_code_sent_at: null,
      verification_code_expires_at: null,
      verification_attempt_count: 0,
      verified_at: verifiedAt,
    })
    .eq("id", tokenRow.id);

  if (verifyError) {
    throw new AppError(500, verifyError.message);
  }

  const document = await requireDocumentBundle(documentId);
  const signer = document.signers.find((candidate) => candidate.id === tokenRow.signer_id);

  await appendAuditEvent(
    documentId,
    signer ? `guest:${signer.email}` : "system",
    "field.completed",
    "Verified guest signing session by email code",
    {
      verificationOnly: true,
      signerId: tokenRow.signer_id,
    },
  );

  const refreshedTokenRow = await requireValidSigningToken(token, documentId);
  return {
    verification: toSigningVerificationState(refreshedTokenRow),
  };
}

export async function resolveSigningTokenSession(token: string, documentId: string) {
  const tokenRow = await requireValidSigningToken(token, documentId);
  const document = await requireDocumentBundle(documentId);

  const signer = document.signers.find((s) => s.id === tokenRow.signer_id);

  if (!signer) {
    throw new AppError(403, "The signer associated with this link is no longer on this document.");
  }

  await markSigningTokenViewed(tokenRow);

  // Build a document response with the guest signer's context
  const baseResponse = toWorkflowDocumentResponse(document, "");
  const waitingOn = getWorkflowWaitingOn(document);
  const signerResponse = {
    ...baseResponse,
    currentUserRole: "signer" as AccessRole,
    currentUserIsSigner: true,
    currentUserSignerId: signer.id,
    waitingOn,
  };

  // Generate a short-lived signed URL for the raw PDF so the guest can view it
  const { signedUrl: previewUrl } = await createSourceDocumentSignedUrl(document.storagePath, 60 * 60);

  return {
    signerToken: token,
    signerId: signer.id,
    signerEmail: signer.email,
    signerName: signer.name,
    documentId,
    document: signerResponse,
    previewUrl,
    verification: toSigningVerificationState(tokenRow),
  };
}

const placeSignatureInputSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive().max(800),
  height: z.number().positive().max(400),
  page: z.number().int().positive(),
  savedSignatureId: z.string().uuid().optional().nullable(),
  signingReason: z.string().trim().min(1).max(80).nullable().default(null),
  signingLocation: z.string().trim().min(1).max(120).nullable().default(null),
  label: z.string().max(80).optional(),
});

/**
 * Creates a new signature field at the signer's chosen position and immediately
 * completes it. Used when a document has no pre-placed field for this signer.
 */
export async function placeAndCompleteSignatureFieldForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = placeSignatureInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);

  if (!isDocumentSignable(document)) {
    throw new AppError(400, "This document is not open for signing.");
  }

  const signer = ensureSignerCanRespondToWorkflow(document, user);

  let appliedSavedSignature: SavedSignatureRow | null = null;

  if (parsed.savedSignatureId) {
    const { data: signatureRow, error: signatureError } = await adminClient
      .from("saved_signatures")
      .select("id, user_id, label, title_text, signature_type, typed_text, storage_path, is_default, created_at")
      .eq("id", parsed.savedSignatureId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (signatureError) throw new AppError(500, signatureError.message);
    if (!signatureRow) throw new AppError(404, "Saved signature not found.");
    appliedSavedSignature = signatureRow as SavedSignatureRow;
  }

  const completionValue =
    appliedSavedSignature?.signature_type === "typed"
      ? appliedSavedSignature.typed_text
      : appliedSavedSignature?.storage_path ?? signer.name ?? "Signed";

  const fieldLabel = parsed.label?.trim() || `Signature — ${signer.name}`;
  const completedAt = new Date().toISOString();

  const { data: fieldData, error: fieldError } = await adminClient
    .from("document_fields")
    .insert({
      document_id: documentId,
      page: parsed.page,
      kind: "signature",
      label: fieldLabel,
      required: false,
      assignee_signer_id: signer.id,
      source: "manual",
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      value: completionValue,
      applied_saved_signature_id: appliedSavedSignature?.id ?? null,
      completed_at: completedAt,
      completed_by_signer_id: signer.id,
    })
    .select("id")
    .single();

  if (fieldError || !fieldData) {
    throw new AppError(500, fieldError?.message ?? "Unable to place signature field.");
  }

  await appendAuditEvent(documentId, user.id, "field.completed", `${signer.name} placed and signed a free-form signature field`, {
    page: parsed.page,
    usedSavedSignature: Boolean(appliedSavedSignature),
    freePlaced: true,
    ...(parsed.signingReason ? { signingReason: parsed.signingReason } : {}),
    ...(parsed.signingLocation ? { signingLocation: parsed.signingLocation } : {}),
  });

  const updatedDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(updatedDocument, user.id) };
}

export async function completeFieldForSigningToken(
  token: string,
  documentId: string,
  fieldId: string,
  input: unknown = {},
  appOrigin?: string,
) {
  const tokenRow = await requireValidSigningToken(token, documentId);
  const parsedInput = completeFieldTokenInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);

  const signer = document.signers.find((s) => s.id === tokenRow.signer_id);

  if (!signer) {
    throw new AppError(403, "The signer associated with this link is no longer on this document.");
  }

  if (document.workflowStatus !== "active") {
    throw new AppError(409, "This workflow is paused or closed. Ask the initiator to resume it before continuing.");
  }

  const eligibleSignerIds = getEligibleSignerIdsForNotifications(document);

  if (!eligibleSignerIds.includes(signer.id)) {
    throw new AppError(409, "This signer is not active yet. Complete the current stage before continuing.");
  }

  const field = document.fields.find((candidate) => candidate.id === fieldId);

  if (!field) {
    throw new AppError(404, "Field not found.");
  }

  if (field.assigneeSignerId !== signer.id) {
    throw new AppError(403, "This field is assigned to another signer.");
  }

  await ensureSigningVerificationForAction(tokenRow, field.kind);

  // Guest signers do not have saved signatures — value defaults to field value or "completed"
  const completionValue = parsedInput.value ?? field.value ?? "completed";
  const completedAt = new Date().toISOString();

  const { error } = await adminClient
    .from("document_fields")
    .update({
      value: completionValue,
      applied_saved_signature_id: null,
      completed_at: completedAt,
      completed_by_signer_id: signer.id,
    })
    .eq("id", fieldId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await adminClient
    .from("document_signing_tokens")
    .update({ last_completed_at: completedAt })
    .eq("id", tokenRow.id);

  await appendAuditEvent(documentId, `guest:${signer.email}`, "field.completed", `Completed field ${field.label} (guest signer)`, {
    page: field.page,
    guestSigner: true,
    ...(parsedInput.signingReason ? { signingReason: parsedInput.signingReason } : {}),
    ...(parsedInput.signingLocation ? { signingLocation: parsedInput.signingLocation } : {}),
  });

  const updatedDocument = await requireDocumentBundle(documentId);
  const eligibleSignerIdsAfter = getEligibleSignerIdsForNotifications(updatedDocument);

  if (
    updatedDocument.deliveryMode === "platform_managed" &&
    updatedDocument.notifyOriginatorOnEachSignature &&
    isActionFieldKind(field.kind)
  ) {
    const originator = await getProfileById(updatedDocument.uploadedByUserId);

    if (originator?.email) {
      await queueNotification(documentId, "signature_progress", originator.email, {
        recipientUserId: originator.id,
        recipientSignerId: signer.id,
        metadata: {
          ...(appOrigin ? { appOrigin } : {}),
          signerName: signer.name,
          actionLabel: getActionLabelForFieldKind(field.kind),
          fieldLabel: field.label,
          fieldKind: field.kind,
        },
      });
    }
  }

  const eligibleSignerIdsBefore = eligibleSignerIds;
  const newlyEligibleSignerIds = eligibleSignerIdsAfter.filter(
    (signerId) => !eligibleSignerIdsBefore.includes(signerId),
  );

  if (newlyEligibleSignerIds.length > 0) {
    // For newly eligible signers, look up their tokens if they are external
    const signerTokens = new Map<string, string>();
    const newlyEligibleExternal = updatedDocument.signers.filter(
      (s) => newlyEligibleSignerIds.includes(s.id) && s.participantType === "external",
    );

    for (const nextSigner of newlyEligibleExternal) {
      const expiresAt = updatedDocument.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const nextToken = await getOrReuseSigningToken(documentId, nextSigner.id, nextSigner.email, expiresAt);
      signerTokens.set(nextSigner.id, nextToken);
    }

    await queueEligibleSignerNotifications(updatedDocument, `guest:${signer.email}`, newlyEligibleSignerIds, {
      reason: "previous_signer_completed",
      actorLabel: signer.name,
      appOrigin,
      signerTokens,
    });
  }

  const workflowState = deriveWorkflowState(updatedDocument);

  if (workflowState === "completed") {
    const completionTimestamp = updatedDocument.completedAt ?? new Date().toISOString();
    await adminClient
      .from("documents")
      .update({
        completed_at: completionTimestamp,
        purge_scheduled_at:
          updatedDocument.retentionMode === "temporary"
            ? addDaysToTimestamp(completionTimestamp, COMPLETED_DOCUMENT_PURGE_GRACE_DAYS)
            : null,
        locked_at: null,
        locked_by_user_id: null,
      })
      .eq("id", documentId);
    await appendVersion(documentId, `guest:${signer.email}`, "Completed document", "All required assigned action fields completed");
    await appendAuditEvent(
      documentId,
      `guest:${signer.email}`,
      "document.completed",
      "Completed all required assigned action fields (guest signer)",
    );
  }

  const finalDocument = await requireDocumentBundle(documentId);
  const signerStillPending = getPendingRequiredAssignedFields(finalDocument).some(
    (candidate) => candidate.assigneeSignerId === signer.id,
  );

  if (!signerStillPending) {
    await invalidateSigningTokensForSigner(documentId, signer.id, "completed");
  }

  const verificationState = signerStillPending
    ? toSigningVerificationState(await requireValidSigningToken(token, documentId))
    : {
        required: true,
        verified: true,
        verifiedAt: completedAt,
        codeSentAt: null,
        codeExpiresAt: null,
        retryAvailableAt: null,
        attemptsRemaining: SIGNING_VERIFICATION_MAX_ATTEMPTS,
        emailHint: maskEmailAddress(signer.email),
      };

  const baseResponse = toWorkflowDocumentResponse(finalDocument, "");
  return {
    document: {
      ...baseResponse,
      currentUserRole: "signer" as AccessRole,
      currentUserIsSigner: true,
      currentUserSignerId: signer.id,
    },
    verification: verificationState,
  };
}

export async function remindDocumentSignersForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  appOrigin?: string,
  signerIds?: string[],
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "send_document");
  const document = await requireDocumentBundle(documentId);

  if (document.deliveryMode !== "platform_managed") {
    throw new AppError(400, "Reminders are only available for platform-managed documents.");
  }

  assertNotificationEmailReady();

  if (!document.sentAt) {
    throw new AppError(400, "Document has not been sent yet.");
  }

  const workflowState = deriveWorkflowState(document);

  if (workflowState === "completed") {
    throw new AppError(400, "Document workflow is already complete.");
  }

  if (document.workflowStatus === "canceled" || document.workflowStatus === "rejected") {
    throw new AppError(400, "Cannot send reminders for a canceled or rejected workflow.");
  }

  const allEligibleSignerIds = getEligibleSignerIdsForNotifications(document);
  const eligibleSignerIds = signerIds
    ? allEligibleSignerIds.filter((id) => signerIds.includes(id))
    : allEligibleSignerIds;

  if (eligibleSignerIds.length === 0) {
    throw new AppError(400, "No pending signers to remind.");
  }

  // For external signers, reuse or refresh their signing token so the reminder link still works
  const signerTokens = new Map<string, string>();
  const externalEligible = document.signers.filter(
    (s) => eligibleSignerIds.includes(s.id) && s.participantType === "external",
  );

  for (const signer of externalEligible) {
    const expiresAt = document.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const token = await getOrReuseSigningToken(document.id, signer.id, signer.email, expiresAt);
    signerTokens.set(signer.id, token);
  }

  await queueEligibleSignerNotifications(document, user.id, eligibleSignerIds, {
    reason: "reminder",
    actorLabel: user.name,
    appOrigin,
    signerTokens,
  });

  const finalDocument = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(finalDocument, user.id) };
}

export async function processQueuedNotifications(limit = 10) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_notifications")
    .select(
      "id, document_id, event_type, channel, status, provider, recipient_email, recipient_user_id, recipient_signer_id, queued_at, delivered_at, metadata",
    )
    .eq("status", "queued")
    .eq("channel", "email")
    .order("queued_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new AppError(500, error.message);
  }

  const deliveredNotifications: string[] = [];

  for (const notification of (data ?? []) as NotificationRow[]) {
    const result = await deliverNotificationRow(notification);

    if (result.delivered) {
      deliveredNotifications.push(notification.id);
    }
  }

  return {
    deliveredNotifications,
  };
}
