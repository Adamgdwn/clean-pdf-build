import type { VercelRequest, VercelResponse } from "@vercel/node";

import { sendDocumentForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, getRequestOrigin, readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:document-send",
      limit: 12,
      windowMs: 60_000,
    });

    return response
      .status(200)
      .json(
        await sendDocumentForAuthorizationHeader(
          readAuthorizationHeader(request),
          request.body.documentId,
          getRequestOrigin(request),
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
