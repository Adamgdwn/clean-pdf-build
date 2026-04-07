import type { VercelRequest, VercelResponse } from "@vercel/node";

import { sendAdminUserInviteForAuthorizationHeader } from "../../../packages/workflow-service/src/index.js";

import { enforceRateLimit, getRequestOrigin, readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:admin-user-invite",
      limit: 5,
      windowMs: 10 * 60_000,
    });

    return response
      .status(200)
      .json(
        await sendAdminUserInviteForAuthorizationHeader(readAuthorizationHeader(request), {
          ...request.body,
          redirectTo: getRequestOrigin(request),
        }),
      );
  } catch (error) {
    return sendError(response, error);
  }
}
