import type { VercelRequest, VercelResponse } from "@vercel/node";

import billingCheckoutHandler from "../apps/web/api/billing-checkout.js";
import billingOverviewHandler from "../apps/web/api/billing-overview.js";
import billingPortalHandler from "../apps/web/api/billing-portal.js";
import documentAccessHandler from "../apps/web/api/document-access.js";
import documentDownloadHandler from "../apps/web/api/document-download.js";
import documentFieldCompleteHandler from "../apps/web/api/document-field-complete.js";
import documentFieldsHandler from "../apps/web/api/document-fields.js";
import documentLockHandler from "../apps/web/api/document-lock.js";
import documentProcessingHandler from "../apps/web/api/document-processing.js";
import documentReopenHandler from "../apps/web/api/document-reopen.js";
import documentSendHandler from "../apps/web/api/document-send.js";
import documentSignersHandler from "../apps/web/api/document-signers.js";
import documentHandler from "../apps/web/api/document.js";
import documentsHandler from "../apps/web/api/documents.js";
import healthHandler from "../apps/web/api/health.js";
import savedSignaturesHandler from "../apps/web/api/saved-signatures.js";
import sessionHandler from "../apps/web/api/session.js";
import stripeWebhookHandler from "../apps/web/api/stripe-webhook.js";

type RouteHandler = (request: VercelRequest, response: VercelResponse) => Promise<unknown> | unknown;

const routeHandlers: Record<string, RouteHandler> = {
  "billing-checkout": billingCheckoutHandler,
  "billing-overview": billingOverviewHandler,
  "billing-portal": billingPortalHandler,
  "document-access": documentAccessHandler,
  "document-download": documentDownloadHandler,
  "document-field-complete": documentFieldCompleteHandler,
  "document-fields": documentFieldsHandler,
  "document-lock": documentLockHandler,
  "document-processing": documentProcessingHandler,
  "document-reopen": documentReopenHandler,
  "document-send": documentSendHandler,
  "document-signers": documentSignersHandler,
  document: documentHandler,
  documents: documentsHandler,
  health: healthHandler,
  "saved-signatures": savedSignaturesHandler,
  session: sessionHandler,
  "stripe-webhook": stripeWebhookHandler,
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
