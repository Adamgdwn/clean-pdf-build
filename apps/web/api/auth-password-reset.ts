import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createAuthClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, getRequestOrigin, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:auth-password-reset",
      limit: 5,
      windowMs: 10 * 60_000,
    });

    const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    if (!email) {
      return response.status(400).json({ message: "Email is required." });
    }

    const authClient = createAuthClient();
    const { error } = await authClient.auth.resetPasswordForEmail(email, {
      redirectTo: getRequestOrigin(request),
    });

    if (error) {
      return response.status(400).json({ message: error.message });
    }

    return response.status(200).json({ sent: true, email });
  } catch (error) {
    return sendError(response, error);
  }
}
