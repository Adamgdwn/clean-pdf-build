import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createAuthClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:auth-password",
      limit: 10,
      windowMs: 10 * 60_000,
    });

    const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";

    if (!email || !password) {
      return response.status(400).json({ message: "Email and password are required." });
    }

    const authClient = createAuthClient();
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return response.status(401).json({ message: error?.message ?? "Unable to sign in." });
    }

    return response.status(200).json({ session: data.session });
  } catch (error) {
    return sendError(response, error);
  }
}
