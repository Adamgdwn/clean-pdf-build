import type { VercelRequest, VercelResponse } from "@vercel/node";

import type { AccountClass } from "../../../packages/domain/src/index.js";
import { getCanonicalAppOrigin, readServerEnv } from "../../../packages/workflow-service/src/env.js";
import { buildWelcomeEmail, deliverNotificationEmail } from "../../../packages/workflow-service/src/notifications.js";
import {
  deriveUsername,
  getVerifiedCorporateEmailDomain,
  inferCompanyName,
  inferProfileKind,
} from "../../../packages/workflow-service/src/profile-identity.js";
import { createAuthClient, createServiceRoleClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, sendError } from "./_utils.js";

function normalizeLookupValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

type RegistrationInviteContext = {
  id: string;
  workspaceId: string;
  organizationId: string | null;
  accountClass: AccountClass;
};

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
    const workspaceInviteToken =
      typeof request.body?.workspaceInviteToken === "string" ? request.body.workspaceInviteToken.trim() : "";
    const marketingOptIn = request.body?.marketingOptIn === true;
    const productUpdatesOptIn = request.body?.productUpdatesOptIn !== false;
    const normalizedUsername = deriveUsername(email, username);
    const resolvedLocale = locale || "en-CA";
    const resolvedTimezone = timezone || "Etc/UTC";
    const verifiedCorporateEmailDomain = getVerifiedCorporateEmailDomain(email);
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
      !accountType ||
      !workspaceName ||
      !jobTitle
    ) {
      return response.status(400).json({
        message:
          "Full name, account type, workspace or organization name, role/title, email, and password are required.",
      });
    }

    const env = readServerEnv();
    const adminClient = createServiceRoleClient();
    let inviteContext: RegistrationInviteContext | null = null;

    if (workspaceInviteToken) {
      const { data: invitation, error: invitationError } = await adminClient
        .from("account_invitations")
        .select("id, workspace_id, email, account_class, expires_at, accepted_at, workspaces(id, organization_id)")
        .eq("token", workspaceInviteToken)
        .maybeSingle();

      if (invitationError) {
        return response.status(400).json({ message: invitationError.message });
      }

      const workspace = Array.isArray(invitation?.workspaces)
        ? invitation?.workspaces[0] ?? null
        : invitation?.workspaces ?? null;
      const hasValidWorkspaceInvite = Boolean(
        invitation &&
          invitation.accepted_at === null &&
          new Date(invitation.expires_at).getTime() > Date.now() &&
          normalizeLookupValue(invitation.email) === normalizeLookupValue(email),
      );

      if (!hasValidWorkspaceInvite) {
        return response.status(403).json({
          message:
            "This invitation is expired, already accepted, or does not match the email address you entered.",
        });
      }

      if (!invitation) {
        return response.status(404).json({ message: "Invitation not found." });
      }

      if (!workspace) {
        return response.status(404).json({ message: "The invited workspace no longer exists." });
      }

      inviteContext = {
        id: invitation.id,
        workspaceId: invitation.workspace_id,
        organizationId: workspace.organization_id ?? null,
        accountClass: invitation.account_class,
      };
    }

    if (accountType === "corporate" && !inviteContext) {
      if (!verifiedCorporateEmailDomain) {
        return response.status(400).json({
          message:
            "Use your organization email address to create a corporate account. Public email addresses can join by invitation only.",
        });
      }

      const { data: existingOrganization, error: existingOrganizationError } = await adminClient
        .from("organizations")
        .select("id")
        .eq("account_type", "corporate")
        .ilike("name", escapeLikePattern(workspaceName))
        .limit(1)
        .maybeSingle();

      if (existingOrganizationError) {
        return response.status(400).json({ message: existingOrganizationError.message });
      }

      if (existingOrganization) {
        return response.status(409).json({
          message:
            "An organization with that name already exists in EasyDraft. Ask an existing account admin to invite you instead.",
        });
      }

      const { data: existingDomainOrganization, error: existingDomainOrganizationError } = await adminClient
        .from("organizations")
        .select("id")
        .eq("account_type", "corporate")
        .eq("verified_email_domain", verifiedCorporateEmailDomain)
        .limit(1)
        .maybeSingle();

      if (existingDomainOrganizationError) {
        return response.status(400).json({ message: existingDomainOrganizationError.message });
      }

      if (existingDomainOrganization) {
        return response.status(409).json({
          message:
            "That organization email domain is already tied to an EasyDraft organization. Ask an existing account admin to invite you.",
        });
      }
    }

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
          corporate_email_domain: accountType === "corporate" ? verifiedCorporateEmailDomain : undefined,
          profile_kind: profileKind,
          workspace_name: workspaceName,
          job_title: jobTitle,
          locale: resolvedLocale,
          timezone: resolvedTimezone,
          marketing_opt_in: marketingOptIn,
          product_updates_opt_in: productUpdatesOptIn,
        },
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        return response.status(409).json({
          message:
            "That email is still registered in Supabase Auth. Sign in, reset the password, or delete the user from Authentication > Users before recreating the test account.",
        });
      }

      return response.status(400).json({ message: error.message });
    }

    if (data.user && inviteContext) {
      if (inviteContext.organizationId) {
        const { data: accountContext, error: accountContextError } = await adminClient
          .from("workspaces")
          .select("id, workspace_type, organizations(id, account_type, owner_user_id)")
          .eq("id", inviteContext.workspaceId)
          .maybeSingle();

        if (accountContextError) {
          return response.status(500).json({ message: accountContextError.message });
        }

        const organization = Array.isArray(accountContext?.organizations)
          ? accountContext?.organizations[0] ?? null
          : accountContext?.organizations ?? null;

        if (organization) {
          const { error: accountMemberError } = await adminClient.from("account_members").upsert(
            {
              account_id: organization.id,
              workspace_id: inviteContext.workspaceId,
              user_id: data.user.id,
              account_class: inviteContext.accountClass,
              is_primary_admin: organization.owner_user_id === data.user.id,
            },
            { onConflict: "account_id,user_id" },
          );

          if (accountMemberError) {
            return response.status(500).json({ message: accountMemberError.message });
          }
        }
      }

      const { error: invitationAcceptError } = await adminClient
        .from("account_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", inviteContext.id)
        .is("accepted_at", null);

      if (invitationAcceptError) {
        return response.status(500).json({ message: invitationAcceptError.message });
      }
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
