import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleStripeWebhook } from "@clean-pdf/workflow-service";

import { readRawBody, sendError } from "./_utils";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    const rawBody = await readRawBody(request);
    const signatureHeader = request.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    return response.status(200).json(await handleStripeWebhook(rawBody, signature));
  } catch (error) {
    return sendError(response, error);
  }
}
