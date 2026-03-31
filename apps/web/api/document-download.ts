import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getDocumentDownloadUrlForAuthorizationHeader } from "@clean-pdf/workflow-service";

import { readAuthorizationHeader, sendError } from "./_utils";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  const documentId = request.query.documentId;

  if (typeof documentId !== "string") {
    return response.status(400).json({ message: "documentId is required." });
  }

  try {
    return response
      .status(200)
      .json(
        await getDocumentDownloadUrlForAuthorizationHeader(
          readAuthorizationHeader(request),
          documentId,
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
