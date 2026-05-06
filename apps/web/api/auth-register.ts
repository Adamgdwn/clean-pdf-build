import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getCanonicalAppOrigin, readServerEnv } from "../../../packages/workflow-service/src/env.js";
import { buildWelcomeEmail, deliverNotificationEmail } from "../../../packages/workflow-service/src/notifications.js";
import {
  deriveUsername,
  inferCompanyName,
  inferProfileKind,
} from "../../../packages/workflow-service/src/profile-identity.js";
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
    const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const accountType =
      request.body?.accountType === "corporate"
        ? "corporate"
        : request.body?.accountType === "individual"
          ? "individual"
          : "";
    const profileKind = inferProfileKind(
      email,
      request.body?.profileKind === "easydraft_user" || request.body?.profileKind === "easydraft_staff"
        ? request.body.profileKind
        : null,
    );
    const workspaceName =
      typeof request.body?.workspaceName === "string" ? request.body.workspaceName.trim() : "";
    const companyNameInput =
      typeof request.body?.companyName === "string" ? request.body.companyName.trim() : "";
    const jobTitle = typeof request.body?.jobTitle === "string" ? request.body.jobTitle.trim() : "";
    const locale = typeof request.body?.locale === "string" ? request.body.locale.trim() : "";
    const timezone = typeof request.body?.timezone === "string" ? request.body.timezone.trim() : "";
    const marketingOptIn = request.body?.marketingOptIn === true;
    const productUpdatesOptIn = request.body?.productUpdatesOptIn !== false;
    const normalizedUsername = deriveUsername(email, username);
    const companyName = inferCompanyName({
      email,
      accountType: accountType || null,
      preferredCompanyName: companyNameInput,
      workspaceName,
      profileKind,
    });

    if (
      !email ||
      !password ||
      !fullName ||
      !username ||
      !accountType ||
      !workspaceName ||
      !companyNameInput ||
      !jobTitle ||
      !locale ||
      !timezone
    ) {
      return response.status(400).json({
        message:
          "Full name, username, account type, workspace name, company or account name, role/title, locale, timezone, email, and password are required.",
      });
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
          username: normalizedUsername,
          company_name: companyName ?? companyNameInput,
          account_type: accountType,
          profile_kind: profileKind,
          workspace_name: workspaceName,
          job_title: jobTitle,
          locale,
          timezone,
          marketing_opt_in: marketingOptIn,
          product_updates_opt_in: productUpdatesOptIn,
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
