import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createFeedbackRequest } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:feedback",
      limit: 5,
      windowMs: 60_000,
    });

    return response.status(200).json(
      await createFeedbackRequest(readAuthorizationHeader(request), request.body),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
