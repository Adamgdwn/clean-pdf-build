import type { VercelRequest, VercelResponse } from "@vercel/node";

import accountDeleteHandler from "../apps/web/api/account-delete.js";
import adminFeedbackHandler from "../apps/web/api/admin-feedback.js";
import adminOverviewHandler from "../apps/web/api/admin-overview.js";
import adminUserDeleteHandler from "../apps/web/api/admin-user-delete.js";
import adminUserInviteHandler from "../apps/web/api/admin-user-invite.js";
import adminUserResetHandler from "../apps/web/api/admin-user-reset.js";
import adminUsersHandler from "../apps/web/api/admin-users.js";
import authPasswordHandler from "../apps/web/api/auth-password.js";
import authPasswordFormHandler from "../apps/web/api/auth-password-form.js";
import authPasswordResetHandler from "../apps/web/api/auth-password-reset.js";
import authRegisterHandler from "../apps/web/api/auth-register.js";
import billingCheckoutHandler from "../apps/web/api/billing-checkout.js";
import billingOverviewHandler from "../apps/web/api/billing-overview.js";
import billingPortalHandler from "../apps/web/api/billing-portal.js";
import billingTokenCheckoutHandler from "../apps/web/api/billing-token-checkout.js";
import digitalSignaturesHandler from "../apps/web/api/digital-signatures.js";
import documensoEnvelopeHandler from "../apps/web/api/documenso-envelope.js";
import documensoWebhookHandler from "../apps/web/api/documenso-webhook.js";
import documentHandler from "../apps/web/api/document.js";
import documentAccessHandler from "../apps/web/api/document-access.js";
import documentCancelHandler from "../apps/web/api/document-cancel.js";
import documentClearHandler from "../apps/web/api/document-clear.js";
import documentDeleteHandler from "../apps/web/api/document-delete.js";
import documentDownloadHandler from "../apps/web/api/document-download.js";
import documentDuplicateHandler from "../apps/web/api/document-duplicate.js";
import documentFieldCompleteHandler from "../apps/web/api/document-field-complete.js";
import documentFieldCompleteTokenHandler from "../apps/web/api/document-field-complete-token.js";
import documentFieldSignHandler from "../apps/web/api/document-field-sign.js";
import documentFieldsHandler from "../apps/web/api/document-fields.js";
import documentLockHandler from "../apps/web/api/document-lock.js";
import documentProcessingHandler from "../apps/web/api/document-processing.js";
import documentRedoHandler from "../apps/web/api/document-redo.js";
import documentRejectHandler from "../apps/web/api/document-reject.js";
import documentRemindHandler from "../apps/web/api/document-remind.js";
import documentRenameHandler from "../apps/web/api/document-rename.js";
import documentReopenHandler from "../apps/web/api/document-reopen.js";
import documentRequestChangesHandler from "../apps/web/api/document-request-changes.js";
import documentRetentionHandler from "../apps/web/api/document-retention.js";
import documentRoutingHandler from "../apps/web/api/document-routing.js";
import documentSendHandler from "../apps/web/api/document-send.js";
import documentShareHandler from "../apps/web/api/document-share.js";
import documentSignerReassignHandler from "../apps/web/api/document-signer-reassign.js";
import documentSignersHandler from "../apps/web/api/document-signers.js";
import documentUndoHandler from "../apps/web/api/document-undo.js";
import documentWorkflowHandler from "../apps/web/api/document-workflow.js";
import documentsHandler from "../apps/web/api/documents.js";
import documentsListHandler from "../apps/web/api/documents-list.js";
import feedbackHandler from "../apps/web/api/feedback.js";
import healthHandler from "../apps/web/api/health.js";
import onboardingCompleteHandler from "../apps/web/api/onboarding-complete.js";
import processorRunHandler from "../apps/web/api/processor-run.js";
import profileHandler from "../apps/web/api/profile.js";
import savedSignaturesHandler from "../apps/web/api/saved-signatures.js";
import sessionHandler from "../apps/web/api/session.js";
import signatureEventsHandler from "../apps/web/api/signature-events.js";
import signaturesBlockchainHandler from "../apps/web/api/signatures-blockchain.js";
import signaturesInternalPrepareHandler from "../apps/web/api/signatures-internal-prepare.js";
import signaturesInternalSignHandler from "../apps/web/api/signatures-internal-sign.js";
import signingTokenSessionHandler from "../apps/web/api/signing-token-session.js";
import signingTokenVerificationCheckHandler from "../apps/web/api/signing-token-verification-check.js";
import signingTokenVerificationSendHandler from "../apps/web/api/signing-token-verification-send.js";
import storageUploadHandler from "../apps/web/api/storage-upload.js";
import stripeWebhookHandler from "../apps/web/api/stripe-webhook.js";
import workspaceInviteHandler from "../apps/web/api/workspace-invite.js";
import workspaceInviteAcceptHandler from "../apps/web/api/workspace-invite-accept.js";
import workspaceInviteDetailsHandler from "../apps/web/api/workspace-invite-details.js";
import workspaceInviteResendHandler from "../apps/web/api/workspace-invite-resend.js";
import workspaceMemberHandler from "../apps/web/api/workspace-member.js";
import workspaceMemberResetHandler from "../apps/web/api/workspace-member-reset.js";
import workspaceMemberRoleHandler from "../apps/web/api/workspace-member-role.js";
import workspaceTeamHandler from "../apps/web/api/workspace-team.js";
import workspaceUpdateHandler from "../apps/web/api/workspace-update.js";
import workspacesHandler from "../apps/web/api/workspaces.js";

type RouteHandler = (request: VercelRequest, response: VercelResponse) => Promise<unknown> | unknown;

const routeHandlers: Record<string, RouteHandler> = {
  "account-delete": accountDeleteHandler,
  "admin-feedback": adminFeedbackHandler,
  "admin-overview": adminOverviewHandler,
  "admin-user-delete": adminUserDeleteHandler,
  "admin-user-invite": adminUserInviteHandler,
  "admin-user-reset": adminUserResetHandler,
  "admin-users": adminUsersHandler,
  "auth-password": authPasswordHandler,
  "auth-password-form": authPasswordFormHandler,
  "auth-password-reset": authPasswordResetHandler,
  "auth-register": authRegisterHandler,
  "billing-checkout": billingCheckoutHandler,
  "billing-overview": billingOverviewHandler,
  "billing-portal": billingPortalHandler,
  "billing-token-checkout": billingTokenCheckoutHandler,
  "digital-signatures": digitalSignaturesHandler,
  "documenso-envelope": documensoEnvelopeHandler,
  "documenso-webhook": documensoWebhookHandler,
  document: documentHandler,
  "document-access": documentAccessHandler,
  "document-cancel": documentCancelHandler,
  "document-clear": documentClearHandler,
  "document-delete": documentDeleteHandler,
  "document-download": documentDownloadHandler,
  "document-duplicate": documentDuplicateHandler,
  "document-field-complete": documentFieldCompleteHandler,
  "document-field-complete-token": documentFieldCompleteTokenHandler,
  "document-field-sign": documentFieldSignHandler,
  "document-fields": documentFieldsHandler,
  "document-lock": documentLockHandler,
  "document-processing": documentProcessingHandler,
  "document-redo": documentRedoHandler,
  "document-reject": documentRejectHandler,
  "document-remind": documentRemindHandler,
  "document-rename": documentRenameHandler,
  "document-reopen": documentReopenHandler,
  "document-request-changes": documentRequestChangesHandler,
  "document-retention": documentRetentionHandler,
  "document-routing": documentRoutingHandler,
  "document-send": documentSendHandler,
  "document-share": documentShareHandler,
  "document-signer-reassign": documentSignerReassignHandler,
  "document-signers": documentSignersHandler,
  "document-undo": documentUndoHandler,
  "document-workflow": documentWorkflowHandler,
  documents: documentsHandler,
  "documents-list": documentsListHandler,
  feedback: feedbackHandler,
  health: healthHandler,
  "onboarding-complete": onboardingCompleteHandler,
  "processor-run": processorRunHandler,
  profile: profileHandler,
  "saved-signatures": savedSignaturesHandler,
  session: sessionHandler,
  "signature-events": signatureEventsHandler,
  "signatures-blockchain": signaturesBlockchainHandler,
  "signatures-internal-prepare": signaturesInternalPrepareHandler,
  "signatures-internal-sign": signaturesInternalSignHandler,
  "signing-token-session": signingTokenSessionHandler,
  "signing-token-verification-check": signingTokenVerificationCheckHandler,
  "signing-token-verification-send": signingTokenVerificationSendHandler,
  "storage-upload": storageUploadHandler,
  "stripe-webhook": stripeWebhookHandler,
  "workspace-invite": workspaceInviteHandler,
  "workspace-invite-accept": workspaceInviteAcceptHandler,
  "workspace-invite-details": workspaceInviteDetailsHandler,
  "workspace-invite-resend": workspaceInviteResendHandler,
  "workspace-member": workspaceMemberHandler,
  "workspace-member-reset": workspaceMemberResetHandler,
  "workspace-member-role": workspaceMemberRoleHandler,
  "workspace-team": workspaceTeamHandler,
  "workspace-update": workspaceUpdateHandler,
  workspaces: workspacesHandler,
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
