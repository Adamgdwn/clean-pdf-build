import type { VercelRequest, VercelResponse } from "@vercel/node";

import { requestDocumentChangesForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { getRequestOrigin, readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response
      .status(200)
      .json(
        await requestDocumentChangesForAuthorizationHeader(
          readAuthorizationHeader(request),
          request.body.documentId,
          request.body,
          getRequestOrigin(request),
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
