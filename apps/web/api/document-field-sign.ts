import type { VercelRequest, VercelResponse } from "@vercel/node";

import { placeAndCompleteSignatureFieldForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  const { documentId, ...rest } = request.body as { documentId?: string; [key: string]: unknown };

  if (!documentId) {
    return response.status(400).json({ message: "documentId is required." });
  }

  try {
    return response
      .status(200)
      .json(
        await placeAndCompleteSignatureFieldForAuthorizationHeader(
          readAuthorizationHeader(request),
          documentId,
          rest,
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
