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
  type DocumentRecord,
  type DocumentNotification,
  type DocumentVersion,
  type Field,
  type LockPolicy,
  type ParticipantType,
  type SavedSignature,
  type Signer,
  type User,
  type WorkflowOperationalStatus,
} from "../../domain/src/index.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

import { readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import { deliverNotificationEmail, getConfiguredNotificationEmailProvider } from "./notifications.js";
import { createAuthClient, createServiceRoleClient } from "./supabase.js";

type DocumentRow = {
  id: string;
  name: string;
  file_name: string;
  storage_path: string;
  workspace_id: string | null;
  editor_history_index: number;
  delivery_mode: DeliveryMode;
  distribution_target: string | null;
  lock_policy: LockPolicy;
  notify_originator_on_each_signature: boolean;
  due_at: string | null;
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
  avatar_url: string | null;
  company_name: string | null;
  job_title: string | null;
  locale: string | null;
  timezone: string | null;
  marketing_opt_in: boolean;
  product_updates_opt_in: boolean;
  last_seen_at: string | null;
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
  provider: "easy_draft_remote" | "qualified_remote" | "organization_hsm";
  assurance_level: string;
  status: "setup_required" | "requested" | "verified" | "rejected";
  certificate_fingerprint: string | null;
  provider_reference: string | null;
  created_at: string;
  updated_at: string;
};

type ProcessingJobType = "ocr" | "field_detection";
type ProcessingJobStatus = "queued" | "running" | "completed" | "failed";
type ProcessingJobRow = {
  id: string;
  document_id: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
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
    avatarUrl: string | null;
    companyName: string | null;
    jobTitle: string | null;
    locale: string | null;
    timezone: string | null;
    marketingOptIn: boolean;
    productUpdatesOptIn: boolean;
    lastSeenAt: string | null;
  };
};

type DigitalSignatureProfileResponse = {
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

type AdminManagedUserResponse = {
  id: string;
  email: string;
  displayName: string;
  companyName: string | null;
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
};

const createDocumentInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  fileName: z.string().min(1).max(200),
  storagePath: z.string().min(1),
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
  provider: z.enum(["easy_draft_remote", "qualified_remote", "organization_hsm"]),
  assuranceLevel: z.string().trim().min(1).max(40).default("advanced"),
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

export async function ensureDefaultWorkspaceForUser(user: AuthenticatedUser) {
  const adminClient = createServiceRoleClient();
  const { data: existingWorkspace, error: existingWorkspaceError } = await adminClient
    .from("workspaces")
    .select("id, name, slug, workspace_type, owner_user_id, billing_email")
    .eq("owner_user_id", user.id)
    .eq("workspace_type", "personal")
    .maybeSingle();

  if (existingWorkspaceError) {
    throw new AppError(500, existingWorkspaceError.message);
  }

  if (existingWorkspace) {
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

  const workspaceName = user.name?.trim() ? `${user.name.trim()}'s workspace` : "My workspace";
  const workspaceSlug = [slugify(user.name || user.email.split("@")[0]), user.id.slice(0, 8)]
    .filter(Boolean)
    .join("-");

  const { data: createdWorkspace, error: createWorkspaceError } = await adminClient
    .from("workspaces")
    .insert({
      name: workspaceName,
      slug: workspaceSlug,
      workspace_type: "personal",
      owner_user_id: user.id,
      billing_email: user.email,
    })
    .select("id, name, slug, workspace_type, owner_user_id, billing_email")
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
    avatarUrl: row.avatar_url,
    companyName: row.company_name,
    jobTitle: row.job_title,
    locale: row.locale,
    timezone: row.timezone,
    marketingOptIn: row.marketing_opt_in,
    productUpdatesOptIn: row.product_updates_opt_in,
    lastSeenAt: row.last_seen_at,
  };
}

function mapDigitalSignatureProfile(
  row: DigitalSignatureProfileRow,
): DigitalSignatureProfileResponse {
  return {
    id: row.id,
    label: row.label,
    titleText: row.title_text,
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
    deliveryMode: row.delivery_mode,
    distributionTarget: row.distribution_target,
    lockPolicy: row.lock_policy,
    notifyOriginatorOnEachSignature: row.notify_originator_on_each_signature,
    dueAt: row.due_at,
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

  const user: AuthenticatedUser = {
    id: data.user.id,
    email: data.user.email,
    rawEmail: data.user.email,
    name:
      data.user.user_metadata.full_name ??
      data.user.user_metadata.name ??
      data.user.email.split("@")[0],
  };
  const normalizedEmail = normalizeEmailAddress(user.rawEmail);

  await adminClient.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      display_name: user.name,
      last_seen_at: new Date().toISOString(),
    },
    {
      onConflict: "id",
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
      .select("id, document_id, label, created_at, created_by_user_id, note")
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
    const { data: profileRows, error: profileError } = await adminClient
      .from("profiles")
      .select(
        "id, email, display_name, avatar_url, company_name, job_title, locale, timezone, marketing_opt_in, product_updates_opt_in, last_seen_at",
      )
      .in("id", accessUserIds);

    if (profileError) {
      throw new AppError(500, profileError.message);
    }

    accessProfiles = (profileRows ?? []) as ProfileRow[];
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

function getNotificationActionOrigin(notification: NotificationRow) {
  const env = readServerEnv();
  const metadataOrigin =
    typeof notification.metadata?.appOrigin === "string" ? notification.metadata.appOrigin.trim() : "";
  const candidateOrigin = metadataOrigin || env.EASYDRAFT_APP_ORIGIN;

  return candidateOrigin.replace(/\/+$/, "");
}

function buildNotificationEmailContent(notification: NotificationRow, document: DocumentRecord) {
  const actionUrl = `${getNotificationActionOrigin(notification)}?documentId=${encodeURIComponent(document.id)}`;
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

  if (!configuredProvider) {
    return { delivered: false, reason: "provider_not_configured" } as const;
  }

  const document = await requireDocumentBundle(notification.document_id);
  const emailContent = buildNotificationEmailContent(notification, document);
  const adminClient = createServiceRoleClient();

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
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, email, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return data as { id: string; email: string; display_name: string } | null;
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
  options: { reason: string; actorLabel: string; appOrigin?: string },
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
    signersToNotify.map((signer) =>
      queueNotification(document.id, "signature_request", signer.email, {
        recipientUserId: signer.userId || null,
        recipientSignerId: signer.id,
        metadata: {
          ...(options.appOrigin ? { appOrigin: options.appOrigin } : {}),
          signerName: signer.name,
          actionLabel,
          reason: options.reason,
        },
      }),
    ),
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

async function renderDocumentExportToStorage(document: DocumentRecord) {
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const { data: sourceBlob, error: sourceDownloadError } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .download(document.storagePath);

  if (sourceDownloadError || !sourceBlob) {
    throw new AppError(500, sourceDownloadError?.message ?? "Unable to load the source PDF.");
  }

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

  const exportBytes = await pdfDocument.save();
  const exportPath = `${document.uploadedByUserId}/${document.id}/exports/latest.pdf`;
  const { error: uploadError } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .upload(exportPath, Buffer.from(exportBytes), {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new AppError(500, uploadError.message);
  }

  return exportPath;
}

async function createExportSignedUrl(document: DocumentRecord, expiresInSeconds: number) {
  const env = readServerEnv();
  const adminClient = createServiceRoleClient();
  const exportPath = await renderDocumentExportToStorage(document);
  const { data, error } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .createSignedUrl(exportPath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new AppError(500, error?.message ?? "Unable to create a signed document URL.");
  }

  return {
    signedUrl: data.signedUrl,
    exportPath,
  };
}

async function appendVersion(
  documentId: string,
  createdByUserId: string,
  label: string,
  note: string,
) {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_versions").insert({
    document_id: documentId,
    created_by_user_id: createdByUserId,
    label,
    note,
  });

  if (error) {
    throw new AppError(500, error.message);
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

export async function getProfileForAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("profiles")
    .select(
      "id, email, display_name, avatar_url, company_name, job_title, locale, timezone, marketing_opt_in, product_updates_opt_in, last_seen_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to load account profile.");
  }

  return {
    profile: mapProfile(data as ProfileRow),
  };
}

export async function updateProfileForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = updateProfileInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const payload = {
    display_name: parsed.displayName,
    company_name: parsed.companyName?.trim() || null,
    job_title: parsed.jobTitle?.trim() || null,
    locale: parsed.locale?.trim() || null,
    timezone: parsed.timezone?.trim() || null,
    marketing_opt_in: parsed.marketingOptIn,
    product_updates_opt_in: parsed.productUpdatesOptIn,
  };

  const { data, error } = await adminClient
    .from("profiles")
    .update(payload)
    .eq("id", user.id)
    .select(
      "id, email, display_name, avatar_url, company_name, job_title, locale, timezone, marketing_opt_in, product_updates_opt_in, last_seen_at",
    )
    .single();

  if (error || !data) {
    throw new AppError(500, error?.message ?? "Unable to update account profile.");
  }

  return {
    profile: mapProfile(data as ProfileRow),
  };
}

export async function listDigitalSignatureProfilesForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("digital_signature_profiles")
    .select(
      "id, user_id, label, title_text, provider, assurance_level, status, certificate_fingerprint, provider_reference, created_at, updated_at",
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
      provider: parsed.provider,
      assurance_level: parsed.assuranceLevel,
      status: providerConnected ? "setup_required" : "requested",
      provider_reference: providerConnected ? `${parsed.provider}-${crypto.randomUUID()}` : null,
    })
    .select(
      "id, user_id, label, title_text, provider, assurance_level, status, certificate_fingerprint, provider_reference, created_at, updated_at",
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
  const [
    profilesCount,
    workspacesCount,
    documentsCount,
    sentDocumentsCount,
    completedDocumentsCount,
    pendingNotificationsCount,
    queuedJobsCount,
    subscriptionsResponse,
    billingCustomersCount,
    workspacesResponse,
  ] = await Promise.all([
    adminClient.from("profiles").select("*", { count: "exact", head: true }),
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
      .from("document_processing_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "running"]),
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
    profilesCount,
    workspacesCount,
    documentsCount,
    sentDocumentsCount,
    completedDocumentsCount,
    pendingNotificationsCount,
    queuedJobsCount,
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
    .select("key, name, monthly_price_usd")
    .eq("active", true);

  if (planRowsResponse.error) {
    throw new AppError(500, planRowsResponse.error.message);
  }

  const planPriceByKey = new Map(
    ((planRowsResponse.data ?? []) as Array<{ key: string; name: string; monthly_price_usd: number }>).map(
      (plan) => [plan.key, plan.monthly_price_usd],
    ),
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
    .reduce((sum, subscription) => sum + (planPriceByKey.get(subscription.billing_plan_key) ?? 0), 0);

  return {
    metrics: {
      totalUsers: profilesCount.count ?? 0,
      totalWorkspaces: workspacesCount.count ?? 0,
      totalDocuments: documentsCount.count ?? 0,
      sentDocuments: sentDocumentsCount.count ?? 0,
      completedDocuments: completedDocumentsCount.count ?? 0,
      pendingNotifications: pendingNotificationsCount.count ?? 0,
      queuedProcessingJobs: queuedJobsCount.count ?? 0,
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

  const [profilesResponse, membershipsResponse, documentsResponse] = await Promise.all([
    adminClient
      .from("profiles")
      .select("id, email, display_name, avatar_url, company_name, job_title, locale, timezone, marketing_opt_in, product_updates_opt_in, last_seen_at")
      .in("id", userIds),
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

  for (const response of [profilesResponse, membershipsResponse, documentsResponse]) {
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

  const profileById = new Map(
    ((profilesResponse.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
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
        companyName: profile?.company_name ?? null,
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
    redirectTo: parsed.redirectTo ?? readServerEnv().EASYDRAFT_APP_ORIGIN,
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    email: authUser.email,
    redirectTo: parsed.redirectTo ?? readServerEnv().EASYDRAFT_APP_ORIGIN,
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
      redirectTo: parsed.redirectTo ?? readServerEnv().EASYDRAFT_APP_ORIGIN,
    };
  }

  const redirectTo = parsed.redirectTo ?? readServerEnv().EASYDRAFT_APP_ORIGIN;
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(parsed.email, {
    redirectTo,
    data: {
      full_name: parsed.displayName?.trim() || parsed.email.split("@")[0],
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

  const { error: profileDeleteError } = await adminClient.from("profiles").delete().eq("id", parsed.userId);

  if (profileDeleteError) {
    throw new AppError(500, profileDeleteError.message);
  }

  return {
    deletedUserId: parsed.userId,
    email: authUser.email,
  };
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

export async function listDocumentsForAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("document_access")
    .select("document_id")
    .eq("user_id", user.id);

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
  const document = await requireDocumentBundle(documentId);

  return {
    document: toWorkflowDocumentResponse(document, user.id),
  };
}

export async function createDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const parsed = createDocumentInputSchema.parse(input);
  const workspace = await ensureDefaultWorkspaceForUser(user);

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
    delivery_mode: parsed.deliveryMode,
    distribution_target: parsed.distributionTarget?.trim() ? parsed.distributionTarget.trim() : null,
    lock_policy: parsed.lockPolicy,
    notify_originator_on_each_signature: parsed.notifyOriginatorOnEachSignature,
    due_at: parsed.dueAt,
    workflow_status: "active" as const,
    workflow_status_reason: null,
    workflow_status_updated_at: null,
    workflow_status_updated_by_user_id: null,
    page_count: parsed.pageCount,
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

export async function addSignerForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user, "manage_signers");
  const parsed = addSignerInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
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

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
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

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
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
  );

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
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

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
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

  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      prepared_at: now,
      sent_at: now,
      completed_at: null,
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
    await queueEligibleSignerNotifications(document, user.id, eligibleSignerIds, {
      reason: "document_sent",
      actorLabel: user.name,
      appOrigin,
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
  const document = await requireDocumentBundle(documentId);
  const signer = ensureSignerCanRespondToWorkflow(document, user);

  await updateDocumentWorkflowStatus(documentId, user.id, "rejected", parsed.note);
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

  await updateDocumentWorkflowStatus(documentId, user.id, "canceled", parsed.note);
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

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
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
  const env = readServerEnv();
  const { data: fileBlob, error: downloadError } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .download(sourceDocument.storagePath);

  if (downloadError || !fileBlob) {
    throw new AppError(500, downloadError?.message ?? "Unable to copy the source PDF.");
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const { error: uploadError } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
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
    editor_history_index: 0,
    delivery_mode: sourceDocument.deliveryMode,
    distribution_target: sourceDocument.distributionTarget,
    lock_policy: sourceDocument.lockPolicy,
    notify_originator_on_each_signature: sourceDocument.notifyOriginatorOnEachSignature,
    due_at: sourceDocument.dueAt,
    workflow_status: "active" as const,
    workflow_status_reason: null,
    workflow_status_updated_at: null,
    workflow_status_updated_by_user_id: null,
    page_count: sourceDocument.pageCount,
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
  await appendAuditEvent(documentId, user.id, "document.exported", "Document soft deleted from workspace");
  await appendVersion(documentId, user.id, "Deleted document", "Document removed from active workspace view");

  const { error } = await adminClient
    .from("documents")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: user.id,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  return {
    deleted: true,
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
