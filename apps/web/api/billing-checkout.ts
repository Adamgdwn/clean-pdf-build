import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createCheckoutSessionForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import {
  enforceRateLimit,
  getRequestOrigin,
  readAuthorizationHeader,
  readWorkspaceIdHeader,
  sendError,
} from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:billing-checkout",
      limit: 8,
      windowMs: 60_000,
    });

    return response.status(200).json(
      await createCheckoutSessionForAuthorizationHeader(
        readAuthorizationHeader(request),
        request.body,
        getRequestOrigin(request),
        readWorkspaceIdHeader(request),
      ),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
