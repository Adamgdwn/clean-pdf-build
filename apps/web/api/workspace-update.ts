import type { VercelRequest, VercelResponse } from "@vercel/node";

import { updateWorkspaceNameForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, readWorkspaceIdHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "PATCH") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    return response.status(200).json(
      await updateWorkspaceNameForAuthorizationHeader(
        readAuthorizationHeader(request),
        request.body,
        readWorkspaceIdHeader(request),
      ),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
