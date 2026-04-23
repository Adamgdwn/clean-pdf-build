import type { VercelRequest, VercelResponse } from "@vercel/node";

import { prepareDocumentForInternalSignatureForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, readAuthorizationHeader, sendError } from "./_utils.js";

type PrepareInternalSignatureRequestBody = {
  documentId?: string;
} & Record<string, unknown>;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:signatures-internal-prepare",
      limit: 12,
      windowMs: 60_000,
    });

    const { documentId, ...rest } = (request.body ?? {}) as PrepareInternalSignatureRequestBody;

    if (!documentId) {
      return response.status(400).json({ message: "documentId is required." });
    }

    return response
      .status(200)
      .json(
        await prepareDocumentForInternalSignatureForAuthorizationHeader(
          readAuthorizationHeader(request),
          documentId,
          rest,
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
