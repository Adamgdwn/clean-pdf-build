import type { VercelRequest, VercelResponse } from "@vercel/node";

import { completeFieldForSigningToken } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, getRequestOrigin, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:field-complete-token",
      limit: 10,
      windowMs: 5 * 60_000,
    });

    const { token, documentId, fieldId, value } = request.body as {
      token: string;
      documentId: string;
      fieldId: string;
      value?: string | null;
    };

    if (!token || !documentId || !fieldId) {
      return response.status(400).json({ message: "token, documentId, and fieldId are required." });
    }

    return response
      .status(200)
      .json(
        await completeFieldForSigningToken(
          token,
          documentId,
          fieldId,
          { value: value ?? null },
          getRequestOrigin(request),
        ),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
