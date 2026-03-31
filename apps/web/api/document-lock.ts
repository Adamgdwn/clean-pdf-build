import type { VercelRequest, VercelResponse } from "@vercel/node";

import { lockDocumentForAuthorizationHeader } from "@clean-pdf/workflow-service";

import { readAuthorizationHeader, sendError } from "./_utils";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response
      .status(200)
      .json(
        await lockDocumentForAuthorizationHeader(
          readAuthorizationHeader(request),
          request.body.documentId,
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
