import { z } from "zod";

export const workflowStateSchema = z.enum([
  "draft",
  "prepared",
  "sent",
  "partially_signed",
  "completed",
  "reopened",
]);

export const accessRoleSchema = z.enum(["owner", "editor", "signer", "viewer"]);
export const routingStrategySchema = z.enum(["sequential", "parallel"]);
export const fieldKindSchema = z.enum([
  "text",
  "image",
  "signature",
  "initial",
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
  "document.exported",
  "field.created",
  "field.assigned",
  "field.completed",
  "processing.ocr.requested",
  "processing.ocr.completed",
  "processing.field_detection.requested",
  "processing.field_detection.completed",
]);

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
  userId: z.string(),
  name: z.string(),
  email: z.string().email(),
  required: z.boolean().default(true),
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
  completedAt: z.string().datetime().nullable().default(null),
  completedBySignerId: z.string().nullable().default(null),
});

export const documentVersionSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string(),
  note: z.string(),
});

export const auditEventSchema = z.object({
  id: z.string(),
  type: auditEventTypeSchema,
  createdAt: z.string().datetime(),
  actorUserId: z.string(),
  summary: z.string(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const documentSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileName: z.string(),
  storagePath: z.string(),
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
  access: z.array(documentAccessSchema),
  signers: z.array(signerSchema),
  fields: z.array(fieldSchema),
  versions: z.array(documentVersionSchema),
  auditTrail: z.array(auditEventSchema),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type AccessRole = z.infer<typeof accessRoleSchema>;
export type RoutingStrategy = z.infer<typeof routingStrategySchema>;
export type FieldKind = z.infer<typeof fieldKindSchema>;
export type User = z.infer<typeof userSchema>;
export type DocumentAccess = z.infer<typeof documentAccessSchema>;
export type Signer = z.infer<typeof signerSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
