import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createCheckoutSessionForAuthorizationHeader } from "@clean-pdf/workflow-service";

import { getRequestOrigin, readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response.status(200).json(
      await createCheckoutSessionForAuthorizationHeader(
        readAuthorizationHeader(request),
        request.body,
        getRequestOrigin(request),
      ),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
