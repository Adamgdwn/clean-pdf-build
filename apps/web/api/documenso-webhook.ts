import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleDocumensoWebhook } from "../../../packages/workflow-service/src/index.js";

import { readRawBody, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    const rawBody = await readRawBody(request);
    const secretHeader = request.headers["x-documenso-secret"];
    const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;

    return response.status(200).json(await handleDocumensoWebhook(rawBody, secret));
  } catch (error) {
    return sendError(response, error);
  }
}
