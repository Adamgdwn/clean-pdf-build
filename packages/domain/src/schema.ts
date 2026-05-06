import { z } from "zod";

export const workflowStateSchema = z.enum([
  "draft",
  "prepared",
  "sent",
  "partially_signed",
  "completed",
  "reopened",
]);
export const workflowOperationalStatusSchema = z.enum([
  "active",
  "changes_requested",
  "rejected",
  "canceled",
]);
export const documentChangeImpactSchema = z.enum([
  "non_material",
  "review_required",
  "resign_required",
]);
export const documentRetentionModeSchema = z.enum(["temporary", "retained"]);
export const signaturePathSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const signatureStatusSchema = z.enum(["pending", "sent", "signed", "rejected", "archived"]);

export const accessRoleSchema = z.enum(["document_admin", "editor", "signer", "viewer"]);
export const routingStrategySchema = z.enum(["sequential", "parallel"]);
export const participantTypeSchema = z.enum(["internal", "external"]);
export const lockPolicySchema = z.enum([
  "document_admin_only",
  "document_admin_and_editors",
  "document_admin_editors_and_active_signer",
]);
export const deliveryModeSchema = z.enum(["self_managed", "internal_use_only", "platform_managed"]);
export const fieldKindSchema = z.enum([
  "text",
  "image",
  "signature",
  "initial",
  "approval",
  "date",
  "checkbox",
]);
export const fieldSourceSchema = z.enum(["manual", "auto_detected"]);
export const auditEventTypeSchema = z.enum([
  "document.uploaded",
  "document.prepared",
  "document.sent",
  "document.completed",
  "document.locked",
  "document.reopened",
  "document.changes_requested",
  "document.rejected",
  "document.canceled",
  "document.signer_reassigned",
  "document.due_date.updated",
  "document.renamed",
  "document.exported",
  "document.retention.updated",
  "document.purged",
  "field.created",
  "field.assigned",
  "field.completed",
  "processing.ocr.requested",
  "processing.ocr.completed",
  "processing.field_detection.requested",
  "processing.field_detection.completed",
  "document.delivery_mode.updated",
  "document.change_impact.assessed",
  "document.resign_required",
  "notification.queued",
  "notification.sent",
]);
export const notificationEventTypeSchema = z.enum([
  "signature_request",
  "signature_progress",
  "workflow_update",
]);
export const notificationChannelSchema = z.enum(["email", "in_app"]);
export const notificationStatusSchema = z.enum(["queued", "sent", "failed", "skipped"]);
export const savedSignatureTypeSchema = z.enum(["typed", "uploaded"]);

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

export const documentAccessSchema = z.object({
  userId: z.string(),
  role: accessRoleSchema,
});

export const signerSchema = z.object({
  id: z.string(),
  userId: z.string().nullable().default(null),
  name: z.string(),
  email: z.string().email(),
  participantType: participantTypeSchema.default("external"),
  required: z.boolean().default(true),
  routingStage: z.number().int().positive().default(1),
  signingOrder: z.number().int().nullable().default(null),
});

export const fieldSchema = z.object({
  id: z.string(),
  page: z.number().int().min(1),
  kind: fieldKindSchema,
  label: z.string(),
  required: z.boolean().default(false),
  assigneeSignerId: z.string().nullable().default(null),
  source: fieldSourceSchema,
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  value: z.string().nullable().default(null),
  appliedSavedSignatureId: z.string().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  completedBySignerId: z.string().nullable().default(null),
});

export const documentVersionSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string(),
  note: z.string(),
  changeImpact: documentChangeImpactSchema.nullable().default(null),
  changeImpactSummary: z.string().nullable().default(null),
});

export const auditEventSchema = z.object({
  id: z.string(),
  type: auditEventTypeSchema,
  createdAt: z.string().datetime(),
  actorUserId: z.string(),
  summary: z.string(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const documentNotificationSchema = z.object({
  id: z.string(),
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  recipientEmail: z.string().email(),
  recipientUserId: z.string().nullable().default(null),
  recipientSignerId: z.string().nullable().default(null),
  queuedAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable().default(null),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const savedSignatureSchema = z.object({
  id: z.string(),
  label: z.string(),
  titleText: z.string().nullable().default(null),
  signatureType: savedSignatureTypeSchema,
  typedText: z.string().nullable().default(null),
  storagePath: z.string().nullable().default(null),
  previewUrl: z.string().nullable().default(null),
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime(),
});

export const documentSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileName: z.string(),
  storagePath: z.string(),
  workspaceId: z.string().nullable().default(null),
  signaturePath: signaturePathSchema.default(1),
  status: signatureStatusSchema.default("pending"),
  deliveryMode: deliveryModeSchema.default("self_managed"),
  distributionTarget: z.string().nullable().default(null),
  lockPolicy: lockPolicySchema.default("document_admin_only"),
  notifyOriginatorOnEachSignature: z.boolean().default(true),
  dueAt: z.string().datetime().nullable().default(null),
  retentionMode: documentRetentionModeSchema.default("temporary"),
  retentionDays: z.number().int().positive().default(30),
  purgeScheduledAt: z.string().datetime().nullable().default(null),
  purgedAt: z.string().datetime().nullable().default(null),
  purgedByUserId: z.string().nullable().default(null),
  purgeReason: z.string().nullable().default(null),
  workflowStatus: workflowOperationalStatusSchema.default("active"),
  workflowStatusReason: z.string().nullable().default(null),
  workflowStatusUpdatedAt: z.string().datetime().nullable().default(null),
  workflowStatusUpdatedByUserId: z.string().nullable().default(null),
  pageCount: z.number().int().positive().nullable(),
  uploadedAt: z.string().datetime(),
  uploadedByUserId: z.string(),
  preparedAt: z.string().datetime().nullable().default(null),
  sentAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  reopenedAt: z.string().datetime().nullable().default(null),
  reopenedByUserId: z.string().nullable().default(null),
  lockedAt: z.string().datetime().nullable().default(null),
  lockedByUserId: z.string().nullable().default(null),
  routingStrategy: routingStrategySchema,
  isScanned: z.boolean().default(false),
  isOcrComplete: z.boolean().default(false),
  isFieldDetectionComplete: z.boolean().default(false),
  sourceStorageBytes: z.number().int().nonnegative().default(0),
  exportStorageBytes: z.number().int().nonnegative().default(0),
  exportSha256: z.string().nullable().default(null),
  latestChangeImpact: documentChangeImpactSchema.nullable().default(null),
  latestChangeImpactSummary: z.string().nullable().default(null),
  latestChangeImpactAt: z.string().datetime().nullable().default(null),
  access: z.array(documentAccessSchema),
  signers: z.array(signerSchema),
  fields: z.array(fieldSchema),
  versions: z.array(documentVersionSchema),
  auditTrail: z.array(auditEventSchema),
  notifications: z.array(documentNotificationSchema),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowOperationalStatus = z.infer<typeof workflowOperationalStatusSchema>;
export type DocumentChangeImpact = z.infer<typeof documentChangeImpactSchema>;
export type DocumentRetentionMode = z.infer<typeof documentRetentionModeSchema>;
export type SignaturePath = z.infer<typeof signaturePathSchema>;
export type SignatureStatus = z.infer<typeof signatureStatusSchema>;
export type AccessRole = z.infer<typeof accessRoleSchema>;
export type RoutingStrategy = z.infer<typeof routingStrategySchema>;
export type ParticipantType = z.infer<typeof participantTypeSchema>;
export type LockPolicy = z.infer<typeof lockPolicySchema>;
export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type FieldKind = z.infer<typeof fieldKindSchema>;
export type User = z.infer<typeof userSchema>;
export type DocumentAccess = z.infer<typeof documentAccessSchema>;
export type Signer = z.infer<typeof signerSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type DocumentNotification = z.infer<typeof documentNotificationSchema>;
export type SavedSignature = z.infer<typeof savedSignatureSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
