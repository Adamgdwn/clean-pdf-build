import type { VercelRequest, VercelResponse } from "@vercel/node";

import { sendSigningTokenVerificationCode } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:signing-token-verification-send",
      limit: 5,
      windowMs: 10 * 60_000,
    });

    const { token, documentId } = request.body as { token: string; documentId: string };

    if (!token || !documentId) {
      return response.status(400).json({ message: "token and documentId are required." });
    }

    return response.status(200).json(await sendSigningTokenVerificationCode(token, documentId));
  } catch (error) {
    return sendError(response, error);
  }
}
