import type { VercelRequest, VercelResponse } from "@vercel/node";

import { verifySigningTokenCode } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:signing-token-verification-check",
      limit: 10,
      windowMs: 10 * 60_000,
    });

    const { token, documentId, code } = request.body as {
      token: string;
      documentId: string;
      code: string;
    };

    if (!token || !documentId || !code) {
      return response.status(400).json({ message: "token, documentId, and code are required." });
    }

    return response.status(200).json(await verifySigningTokenCode(token, documentId, code));
  } catch (error) {
    return sendError(response, error);
  }
}
