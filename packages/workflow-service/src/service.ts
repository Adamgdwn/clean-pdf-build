import {
  canPerformDocumentAction,
  deriveWorkflowState,
  getDocumentCompletionSummary,
  isDocumentSignable,
  type AccessRole,
  type AuditEvent,
  type DocumentRecord,
  type DocumentVersion,
  type Field,
  type Signer,
  type User,
} from "@clean-pdf/domain";
import { z } from "zod";

import { readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import { createAuthClient, createServiceRoleClient } from "./supabase.js";

type DocumentRow = {
  id: string;
  name: string;
  file_name: string;
  storage_path: string;
  workspace_id: string | null;
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
  required: boolean;
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
  workflowState: ReturnType<typeof deriveWorkflowState>;
  signable: boolean;
  completionSummary: ReturnType<typeof getDocumentCompletionSummary>;
};

export type AuthenticatedUser = User & {
  rawEmail: string;
};

const createDocumentInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  fileName: z.string().min(1).max(200),
  storagePath: z.string().min(1),
  pageCount: z.number().int().positive().nullable().default(null),
  routingStrategy: z.enum(["sequential", "parallel"]).default("sequential"),
  isScanned: z.boolean().default(false),
});

const addSignerInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  required: z.boolean().default(true),
  signingOrder: z.number().int().positive().nullable().default(null),
});

const addFieldInputSchema = z.object({
  page: z.number().int().positive(),
  kind: z.enum(["text", "image", "signature", "initial", "date", "checkbox"]),
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
  email: z.string().email(),
  role: z.enum(["editor", "viewer", "signer"]),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
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
    userId: row.user_id ?? "",
    name: row.name,
    email: row.email,
    required: row.required,
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

function mapDocumentRecord(
  row: DocumentRow,
  accessRows: DocumentAccessRow[],
  signerRows: SignerRow[],
  fieldRows: FieldRow[],
  versionRows: DocumentVersionRow[],
  auditRows: AuditEventRow[],
): DocumentRecord {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    storagePath: row.storage_path,
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
    signers: signerRows
      .slice()
      .sort((left, right) => (left.signing_order ?? 999) - (right.signing_order ?? 999))
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
    .ilike("email", user.rawEmail);

  if (invites && invites.length > 0) {
    await Promise.all(
      invites.map(async (invite) => {
        const typedInvite = invite as DocumentInviteRow;

        await adminClient.from("document_access").upsert(
          {
            document_id: typedInvite.document_id,
            user_id: user.id,
            role: typedInvite.role,
          },
          {
            onConflict: "document_id,user_id",
          },
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
            .ilike("email", user.rawEmail)
            .is("user_id", null);
        }
      }),
    );
  }

  const { data: signerRows } = await adminClient
    .from("document_signers")
    .select("id, document_id, user_id, name, email, required, signing_order")
    .ilike("email", user.rawEmail)
    .is("user_id", null);

  if (signerRows && signerRows.length > 0) {
    await Promise.all(
      signerRows.map(async (row) => {
        const signer = row as SignerRow;
        await adminClient
          .from("document_signers")
          .update({ user_id: user.id })
          .eq("id", signer.id);

        await adminClient.from("document_access").upsert(
          {
            document_id: signer.document_id,
            user_id: user.id,
            role: "signer",
          },
          {
            onConflict: "document_id,user_id",
          },
        );
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

async function requireDocumentBundle(documentId: string) {
  const adminClient = createServiceRoleClient();
  const [
    documentResponse,
    accessResponse,
    signerResponse,
    fieldResponse,
    versionResponse,
    auditResponse,
  ] = await Promise.all([
    adminClient.from("documents").select("*").eq("id", documentId).maybeSingle(),
    adminClient.from("document_access").select("document_id, user_id, role").eq("document_id", documentId),
    adminClient
      .from("document_signers")
      .select("id, document_id, user_id, name, email, required, signing_order")
      .eq("document_id", documentId),
    adminClient
      .from("document_fields")
      .select(
        "id, document_id, page, kind, label, required, assignee_signer_id, source, x, y, width, height, value, completed_at, completed_by_signer_id",
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
  ]);

  if (documentResponse.error) {
    throw new AppError(500, documentResponse.error.message);
  }

  if (!documentResponse.data) {
    throw new AppError(404, "Document not found.");
  }

  for (const response of [accessResponse, signerResponse, fieldResponse, versionResponse, auditResponse]) {
    if (response.error) {
      throw new AppError(500, response.error.message);
    }
  }

  return mapDocumentRecord(
    documentResponse.data as DocumentRow,
    (accessResponse.data ?? []) as DocumentAccessRow[],
    (signerResponse.data ?? []) as SignerRow[],
    (fieldResponse.data ?? []) as FieldRow[],
    (versionResponse.data ?? []) as DocumentVersionRow[],
    (auditResponse.data ?? []) as AuditEventRow[],
  );
}

function toWorkflowDocumentResponse(document: DocumentRecord, userId: string): WorkflowDocumentResponse {
  return {
    ...document,
    currentUserRole: document.access.find((entry) => entry.userId === userId)?.role ?? null,
    workflowState: deriveWorkflowState(document),
    signable: isDocumentSignable(document),
    completionSummary: getDocumentCompletionSummary(document),
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

async function assertPermission(documentId: string, userId: string, action: Parameters<typeof canPerformDocumentAction>[1]) {
  const role = await requireDocumentRole(documentId, userId);

  if (!canPerformDocumentAction(role, action)) {
    throw new AppError(403, "You do not have permission to perform this action.");
  }

  return role;
}

export async function getSessionFromAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
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
  const documents = await Promise.all(documentIds.map((documentId) => requireDocumentBundle(documentId)));

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

  await appendVersion(parsed.id, user.id, "Uploaded original", "Source PDF uploaded to storage");
  await appendAuditEvent(parsed.id, user.id, "document.uploaded", `Uploaded ${parsed.fileName}`);

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
  await assertPermission(documentId, user.id, "manage_signers");
  const parsed = addSignerInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_signers").insert({
    document_id: documentId,
    name: parsed.name,
    email: parsed.email,
    required: parsed.required,
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
    { required: parsed.required, signingOrder: parsed.signingOrder ?? 0 },
  );
  await appendVersion(documentId, user.id, "Updated signer routing", `Added signer ${parsed.email}`);

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function addFieldForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user.id, "edit_document");
  const parsed = addFieldInputSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("document_fields").insert({
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
  });

  if (error) {
    throw new AppError(500, error.message);
  }

  await adminClient
    .from("documents")
    .update({ prepared_at: new Date().toISOString() })
    .eq("id", documentId);

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
  await assertPermission(documentId, user.id, "manage_access");
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
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user.id, "send_document");
  const adminClient = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("documents")
    .update({
      prepared_at: now,
      sent_at: now,
      completed_at: null,
      reopened_at: null,
      reopened_by_user_id: null,
    })
    .eq("id", documentId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendVersion(documentId, user.id, "Sent for signing", "Document sent to assigned participants");
  await appendAuditEvent(documentId, user.id, "document.sent", "Sent document for signing");

  const document = await requireDocumentBundle(documentId);
  return { document: toWorkflowDocumentResponse(document, user.id) };
}

export async function lockDocumentForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user.id, "lock_document");
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
  await assertPermission(documentId, user.id, "reopen_document");
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

export async function completeFieldForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  fieldId: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user.id, "complete_assigned_field");
  const adminClient = createServiceRoleClient();
  const document = await requireDocumentBundle(documentId);
  const signer = document.signers.find(
    (candidate) => candidate.userId === user.id || candidate.email.toLowerCase() === user.rawEmail.toLowerCase(),
  );

  if (!signer) {
    throw new AppError(403, "You are not assigned as a signer on this document.");
  }

  const field = document.fields.find((candidate) => candidate.id === fieldId);

  if (!field) {
    throw new AppError(404, "Field not found.");
  }

  if (field.assigneeSignerId !== signer.id) {
    throw new AppError(403, "This field is assigned to another signer.");
  }

  const completedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("document_fields")
    .update({
      value: field.value ?? "completed",
      completed_at: completedAt,
      completed_by_signer_id: signer.id,
    })
    .eq("id", fieldId);

  if (error) {
    throw new AppError(500, error.message);
  }

  await appendAuditEvent(documentId, user.id, "field.completed", `Completed field ${field.label}`, {
    page: field.page,
  });

  const updatedDocument = await requireDocumentBundle(documentId);
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
    await appendVersion(documentId, user.id, "Completed document", "All required assigned signing fields completed");
    await appendAuditEvent(
      documentId,
      user.id,
      "document.completed",
      "Completed all required assigned signing fields",
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
  const env = readServerEnv();
  const document = await requireDocumentBundle(documentId);
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient.storage
    .from(env.SUPABASE_DOCUMENT_BUCKET)
    .createSignedUrl(document.storagePath, 60 * 10);

  if (error || !data?.signedUrl) {
    throw new AppError(500, error?.message ?? "Unable to create a signed document URL.");
  }

  return {
    signedUrl: data.signedUrl,
  };
}

export async function requestProcessingJobForAuthorizationHeader(
  authorizationHeader: string | undefined,
  documentId: string,
  jobType: ProcessingJobType,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  await assertPermission(documentId, user.id, "edit_document");
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
