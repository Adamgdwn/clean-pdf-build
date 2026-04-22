import type { VercelRequest, VercelResponse } from "@vercel/node";

import adminOverviewHandler from "../apps/web/api/admin-overview.js";
import adminFeedbackHandler from "../apps/web/api/admin-feedback.js";
import adminUsersHandler from "../apps/web/api/admin-users.js";
import authPasswordHandler from "../apps/web/api/auth-password.js";
import authPasswordFormHandler from "../apps/web/api/auth-password-form.js";
import authPasswordResetHandler from "../apps/web/api/auth-password-reset.js";
import authRegisterHandler from "../apps/web/api/auth-register.js";
import billingCheckoutHandler from "../apps/web/api/billing-checkout.js";
import billingOverviewHandler from "../apps/web/api/billing-overview.js";
import billingPortalHandler from "../apps/web/api/billing-portal.js";
import adminUserInviteHandler from "../apps/web/api/admin-user-invite.js";
import digitalSignaturesHandler from "../apps/web/api/digital-signatures.js";
import documentAccessHandler from "../apps/web/api/document-access.js";
import documentClearHandler from "../apps/web/api/document-clear.js";
import documentCancelHandler from "../apps/web/api/document-cancel.js";
import documentDeleteHandler from "../apps/web/api/document-delete.js";
import documentDownloadHandler from "../apps/web/api/document-download.js";
import documentDuplicateHandler from "../apps/web/api/document-duplicate.js";
import documentFieldCompleteHandler from "../apps/web/api/document-field-complete.js";
import documentFieldsHandler from "../apps/web/api/document-fields.js";
import documentLockHandler from "../apps/web/api/document-lock.js";
import documentProcessingHandler from "../apps/web/api/document-processing.js";
import documentRejectHandler from "../apps/web/api/document-reject.js";
import documentRedoHandler from "../apps/web/api/document-redo.js";
import documentReopenHandler from "../apps/web/api/document-reopen.js";
import documentRequestChangesHandler from "../apps/web/api/document-request-changes.js";
import documentRoutingHandler from "../apps/web/api/document-routing.js";
import documentSendHandler from "../apps/web/api/document-send.js";
import documentShareHandler from "../apps/web/api/document-share.js";
import documentSignerReassignHandler from "../apps/web/api/document-signer-reassign.js";
import documentSignersHandler from "../apps/web/api/document-signers.js";
import documentUndoHandler from "../apps/web/api/document-undo.js";
import documentWorkflowHandler from "../apps/web/api/document-workflow.js";
import documentHandler from "../apps/web/api/document.js";
import documentsListHandler from "../apps/web/api/documents-list.js";
import documentsHandler from "../apps/web/api/documents.js";
import feedbackHandler from "../apps/web/api/feedback.js";
import healthHandler from "../apps/web/api/health.js";
import profileHandler from "../apps/web/api/profile.js";
import savedSignaturesHandler from "../apps/web/api/saved-signatures.js";
import sessionHandler from "../apps/web/api/session.js";
import storageUploadHandler from "../apps/web/api/storage-upload.js";
import stripeWebhookHandler from "../apps/web/api/stripe-webhook.js";
import processorRunHandler from "../apps/web/api/processor-run.js";
import workspaceInviteAcceptHandler from "../apps/web/api/workspace-invite-accept.js";
import workspaceInviteResendHandler from "../apps/web/api/workspace-invite-resend.js";
import workspaceInviteHandler from "../apps/web/api/workspace-invite.js";
import workspaceMemberResetHandler from "../apps/web/api/workspace-member-reset.js";
import workspaceTeamHandler from "../apps/web/api/workspace-team.js";
import workspaceUpdateHandler from "../apps/web/api/workspace-update.js";

type RouteHandler = (request: VercelRequest, response: VercelResponse) => Promise<unknown> | unknown;

const routeHandlers: Record<string, RouteHandler> = {
  "admin-overview": adminOverviewHandler,
  "admin-feedback": adminFeedbackHandler,
  "admin-user-invite": adminUserInviteHandler,
  "admin-users": adminUsersHandler,
  "auth-password": authPasswordHandler,
  "auth-password-form": authPasswordFormHandler,
  "auth-password-reset": authPasswordResetHandler,
  "auth-register": authRegisterHandler,
  "billing-checkout": billingCheckoutHandler,
  "billing-overview": billingOverviewHandler,
  "billing-portal": billingPortalHandler,
  "digital-signatures": digitalSignaturesHandler,
  "document-access": documentAccessHandler,
  "document-clear": documentClearHandler,
  "document-cancel": documentCancelHandler,
  "document-delete": documentDeleteHandler,
  "document-download": documentDownloadHandler,
  "document-duplicate": documentDuplicateHandler,
  "document-field-complete": documentFieldCompleteHandler,
  "document-fields": documentFieldsHandler,
  "document-lock": documentLockHandler,
  "document-processing": documentProcessingHandler,
  "document-reject": documentRejectHandler,
  "document-redo": documentRedoHandler,
  "document-reopen": documentReopenHandler,
  "document-request-changes": documentRequestChangesHandler,
  "document-routing": documentRoutingHandler,
  "document-send": documentSendHandler,
  "document-share": documentShareHandler,
  "document-signer-reassign": documentSignerReassignHandler,
  "document-signers": documentSignersHandler,
  "document-undo": documentUndoHandler,
  "document-workflow": documentWorkflowHandler,
  document: documentHandler,
  "documents-list": documentsListHandler,
  documents: documentsHandler,
  feedback: feedbackHandler,
  health: healthHandler,
  "processor-run": processorRunHandler,
  profile: profileHandler,
  "saved-signatures": savedSignaturesHandler,
  session: sessionHandler,
  "storage-upload": storageUploadHandler,
  "stripe-webhook": stripeWebhookHandler,
  "workspace-invite": workspaceInviteHandler,
  "workspace-invite-accept": workspaceInviteAcceptHandler,
  "workspace-invite-resend": workspaceInviteResendHandler,
  "workspace-member-reset": workspaceMemberResetHandler,
  "workspace-team": workspaceTeamHandler,
  "workspace-update": workspaceUpdateHandler,
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const requestUrl = request.url ?? "/";
  const pathname = requestUrl.startsWith("http")
    ? new URL(requestUrl).pathname
    : requestUrl.split("?")[0] ?? "/";
  const route = pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const routeHandler = routeHandlers[route];

  if (!routeHandler) {
    return response.status(404).json({ message: "Endpoint not found." });
  }

  return routeHandler(request, response);
}
