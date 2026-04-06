import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  createWorkspaceInvitationForAuthorizationHeader,
  revokeWorkspaceInvitationForAuthorizationHeader,
} from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const auth = readAuthorizationHeader(request);

  try {
    if (request.method === "POST") {
      return response.status(200).json(
        await createWorkspaceInvitationForAuthorizationHeader(auth, request.body),
      );
    }

    if (request.method === "DELETE") {
      const invitationId = request.query["invitationId"];

      if (!invitationId || typeof invitationId !== "string") {
        return response.status(400).json({ message: "Missing invitationId." });
      }

      return response.status(200).json(
        await revokeWorkspaceInvitationForAuthorizationHeader(auth, invitationId),
      );
    }

    return response.status(405).json({ message: "Method not allowed." });
  } catch (error) {
    return sendError(response, error);
  }
}
