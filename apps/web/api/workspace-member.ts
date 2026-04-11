import type { VercelRequest, VercelResponse } from "@vercel/node";

import { removeWorkspaceMemberForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, readAuthorizationHeader, readWorkspaceIdHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "DELETE") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:workspace-member",
      limit: 10,
      windowMs: 60_000,
    });

    return response.status(200).json(
      await removeWorkspaceMemberForAuthorizationHeader(
        readAuthorizationHeader(request),
        request.body,
        readWorkspaceIdHeader(request),
      ),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
