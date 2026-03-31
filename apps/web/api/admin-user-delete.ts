import type { VercelRequest, VercelResponse } from "@vercel/node";

import { deleteAdminUserForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response
      .status(200)
      .json(await deleteAdminUserForAuthorizationHeader(readAuthorizationHeader(request), request.body));
  } catch (error) {
    return sendError(response, error);
  }
}
