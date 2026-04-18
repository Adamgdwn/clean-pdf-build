import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getWorkspaceInvitationDetails } from "../../../packages/workflow-service/src/index.js";

import { sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  const token = typeof request.body?.token === "string" ? request.body.token : null;

  if (!token) {
    return response.status(400).json({ message: "Missing invite token." });
  }

  try {
    return response.status(200).json(await getWorkspaceInvitationDetails(token));
  } catch (error) {
    return sendError(response, error);
  }
}
