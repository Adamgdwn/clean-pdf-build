import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getCanonicalAppOrigin, readServerEnv } from "../../../packages/workflow-service/src/env.js";
import { buildWelcomeEmail, deliverNotificationEmail } from "../../../packages/workflow-service/src/notifications.js";
import { createAuthClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:auth-register",
      limit: 5,
      windowMs: 10 * 60_000,
    });

    const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const fullName = typeof request.body?.fullName === "string" ? request.body.fullName.trim() : "";
    const accountType =
      request.body?.accountType === "corporate" ? "corporate" : "individual";
    const workspaceName =
      typeof request.body?.workspaceName === "string" ? request.body.workspaceName.trim() : "";

    if (!email || !password || !fullName) {
      return response.status(400).json({ message: "Full name, email, and password are required." });
    }

    const env = readServerEnv();
    const authClient = createAuthClient();
    const { data, error } = await authClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getCanonicalAppOrigin(env),
        data: {
          full_name: fullName,
          account_type: accountType,
          workspace_name: workspaceName || undefined,
        },
      },
    });

    if (error) {
      return response.status(400).json({ message: error.message });
    }

    if (data.user && data.session) {
      const appOrigin = getCanonicalAppOrigin(env);
      deliverNotificationEmail(env, {
        to: email,
        subject: "Welcome to EasyDraftDocs",
        html: buildWelcomeEmail(fullName, appOrigin),
      }).catch(() => null);
    }

    return response.status(200).json({ session: data.session, user: data.user });
  } catch (error) {
    return sendError(response, error);
  }
}
