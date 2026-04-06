import type { VercelRequest, VercelResponse } from "@vercel/node";

import { resendWorkspaceInvitationForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  const invitationId =
    typeof request.body?.invitationId === "string" ? request.body.invitationId : null;

  if (!invitationId) {
    return response.status(400).json({ message: "Missing invitationId." });
  }

  try {
    return response.status(200).json(
      await resendWorkspaceInvitationForAuthorizationHeader(
        readAuthorizationHeader(request),
        invitationId,
      ),
    );
  } catch (error) {
    return sendError(response, error);
  }
}
