import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getSessionFromAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response
      .status(200)
      .json(await getSessionFromAuthorizationHeader(readAuthorizationHeader(request)));
  } catch (error) {
    return sendError(response, error);
  }
}
