import { z } from "zod";

import type { AccountClass } from "../../domain/src/index.js";
import { getCanonicalAppOrigin, readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import { deliverNotificationEmail } from "./notifications.js";
import {
  ensureDefaultWorkspaceForUser,
  ensureOrganizationForWorkspace,
  getAccountClassForUser,
  findProfileIdentityByEmail,
  getOrganizationById,
  getProfileIdentitiesById,
  listAccessibleWorkspacesForUser,
  resolveAuthenticatedUser,
  resolveWorkspaceForUser,
  syncProfileIdentity,
  type AuthenticatedUser,
} from "./service.js";
import { createAuthClient, createServiceRoleClient } from "./supabase.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

type WorkspaceInvitationRow = {
  id: string;
  account_id?: string;
  workspace_id: string | null;
  email: string;
  account_class: AccountClass;
  invited_by_user_id: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  workspace_type: string;
  organization_id: string;
  owner_user_id: string;
  billing_email: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  account_type: "individual" | "corporate";
  owner_user_id: string;
  billing_email: string | null;
  status?: "pending_verification" | "active" | "payment_required" | "suspended" | "closing" | "closed";
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function mapInvitationStatus(invitation: Pick<WorkspaceInvitationRow, "accepted_at" | "expires_at">) {
  if (invitation.accepted_at) {
    return "accepted" as const;
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return "expired" as const;
  }

  return "pending" as const;
}

async function requireWorkspaceWithRole(
  user: AuthenticatedUser,
  allowedAccountClasses: AccountClass[],
  preferredWorkspaceId?: string | null,
): Promise<{ workspace: WorkspaceRow; accountClass: AccountClass }> {
  const workspace = (await resolveWorkspaceForUser(user, preferredWorkspaceId)) as WorkspaceRow;
  const organization = await getOrganizationForWorkspace(workspace);
  const accountClass = await getAccountClassForUser({
    accountId: organization.id,
    userId: user.id,
    organization,
    workspace,
  });

  if (!allowedAccountClasses.includes(accountClass)) {
    throw new AppError(403, "You do not have permission to manage this workspace.");
  }

  return { workspace, accountClass };
}

async function getOrganizationForWorkspace(workspace: WorkspaceRow) {
  const organization = await ensureOrganizationForWorkspace(workspace);
  return organization as OrganizationRow;
}

function assertOrganizationCanManagePeople(organization: OrganizationRow) {
  const status = organization.status ?? "active";

  if (["pending_verification", "suspended", "closing", "closed"].includes(status)) {
    throw new AppError(
      409,
      `${organization.name} is ${status.replaceAll("_", " ")}. Resolve the account status before inviting or changing team access.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  accountClass: z.enum(["corporate_admin", "corporate_member"]).default("corporate_member"),
});

const updateWorkspaceNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const sendWorkspacePasswordResetSchema = z.object({
  userId: z.string().uuid(),
  redirectTo: z.string().trim().url().optional(),
});

const changeMemberRoleSchema = z.object({
  userId: z.string().uuid(),
  accountClass: z.enum(["corporate_admin", "corporate_member"]),
});

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Public API: list team members + pending invitations
// ---------------------------------------------------------------------------

export async function getWorkspaceTeamForAuthorizationHeader(
  authorizationHeader: string | undefined,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const workspace = (await resolveWorkspaceForUser(user, preferredWorkspaceId)) as WorkspaceRow;
  const organization = await getOrganizationForWorkspace(workspace);
  const accountClass = await getAccountClassForUser({
    accountId: organization.id,
    userId: user.id,
    organization,
    workspace,
  });
  const adminClient = createServiceRoleClient();

  const [membersResult, invitationsResult] = await Promise.all([
    adminClient
      .from("account_members")
      .select("workspace_id, user_id, account_class, created_at")
      .eq("account_id", organization.id)
      .order("created_at", { ascending: true }),

    adminClient
      .from("account_invitations")
      .select("id, account_id, workspace_id, email, account_class, invited_by_user_id, expires_at, accepted_at, created_at")
      .eq("account_id", organization.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }),
  ]);

  if (membersResult.error) throw new AppError(500, membersResult.error.message);
  if (invitationsResult.error) throw new AppError(500, invitationsResult.error.message);

  const members = (membersResult.data ?? []) as unknown as Array<{
    workspace_id: string | null;
    user_id: string;
    account_class: AccountClass;
    created_at: string;
  }>;
  const invitations = (invitationsResult.data ?? []) as WorkspaceInvitationRow[];
  const profilesById = await getProfileIdentitiesById(
    adminClient,
    members.map((member) => member.user_id),
  );

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      accountType: organization.account_type,
      accountClass,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      organizationId: organization.id,
    },
    members: members.map((m) => {
      const profile = profilesById.get(m.user_id);

      return {
        userId: m.user_id,
        accountClass: m.account_class,
        displayName: profile?.display_name ?? profile?.email ?? "Unknown",
        email: profile?.email ?? null,
        isCurrentUser: m.user_id === user.id,
        joinedAt: m.created_at,
      };
    }),
    pendingInvitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      accountClass: inv.account_class,
      expiresAt: inv.expires_at,
      createdAt: inv.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API: create invitation
// ---------------------------------------------------------------------------

export async function createWorkspaceInvitationForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(
    user,
    ["corporate_admin"],
    preferredWorkspaceId,
  );
  const organization = await getOrganizationForWorkspace(workspace);
  assertOrganizationCanManagePeople(organization);
  const parsed = createInvitationSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();

  // Check if already a member
  const existingProfile = await findProfileIdentityByEmail(adminClient, email);

  if (existingProfile?.id) {
    const { data: existingMembership } = await adminClient
      .from("account_members")
      .select("account_class")
      .eq("account_id", organization.id)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (existingMembership) {
      throw new AppError(409, `${email} is already a member of this workspace.`);
    }
  }

  // Check for existing pending invite
  const { data: existingInvite } = await adminClient
    .from("account_invitations")
    .select("id")
    .eq("account_id", organization.id)
    .ilike("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existingInvite) {
    throw new AppError(409, `A pending invitation for ${email} already exists. You can resend it instead.`);
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: insertError } = await adminClient
    .from("account_invitations")
    .insert({
      account_id: organization.id,
      workspace_id: workspace.id,
      email,
      account_class: parsed.accountClass,
      invited_by_user_id: user.id,
      token,
      expires_at: expiresAt,
    })
    .select("id, email, account_class, expires_at")
    .single();

  if (insertError || !invitation) {
    throw new AppError(500, insertError?.message ?? "Failed to create invitation.");
  }

  await sendInviteEmail(env, {
    toEmail: email,
    inviterName: user.name ?? user.email,
    workspaceName: workspace.name,
    accountClass: parsed.accountClass,
    token,
    appOrigin: env.EASYDRAFT_APP_ORIGIN,
  });

  // Seat count advisory: count current members + pending invites after this one
  const { count: memberCount } = await adminClient
    .from("account_members")
    .select("*", { head: true, count: "exact" })
    .eq("account_id", organization.id);

  const { count: pendingCount } = await adminClient
    .from("account_invitations")
    .select("*", { head: true, count: "exact" })
    .eq("account_id", organization.id)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());

  const { data: subscription } = await adminClient
    .from("workspace_subscriptions")
    .select("seat_count, status")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalOccupied = (memberCount ?? 0) + (pendingCount ?? 0);
  const seatCount = subscription?.seat_count ?? 0;
  const isActiveSubscription = subscription && ["active", "trialing"].includes(subscription.status);
  const seatWarning =
    isActiveSubscription && totalOccupied > seatCount
      ? `You now have ${totalOccupied} seats in use but your subscription covers ${seatCount}. Visit Billing to update your seat count.`
      : null;

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      accountClass: invitation.account_class,
      expiresAt: invitation.expires_at,
    },
    seatWarning,
  };
}

// ---------------------------------------------------------------------------
// Public API: resend invitation
// ---------------------------------------------------------------------------

export async function resendWorkspaceInvitationForAuthorizationHeader(
  authorizationHeader: string | undefined,
  invitationId: string,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["corporate_admin"], preferredWorkspaceId);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();

  const { data: invitation, error } = await adminClient
    .from("account_invitations")
    .select("id, email, account_class, token, expires_at, accepted_at")
    .eq("id", invitationId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error || !invitation) {
    throw new AppError(404, "Invitation not found.");
  }

  if (invitation.accepted_at) {
    throw new AppError(409, "This invitation has already been accepted.");
  }

  // Extend expiry
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await adminClient
    .from("account_invitations")
    .update({ expires_at: newExpiresAt })
    .eq("id", invitationId);

  await sendInviteEmail(env, {
    toEmail: invitation.email,
    inviterName: user.name ?? user.email,
    workspaceName: workspace.name,
    accountClass: invitation.account_class,
    token: invitation.token,
    appOrigin: env.EASYDRAFT_APP_ORIGIN,
  });

  return { resent: true };
}

// ---------------------------------------------------------------------------
// Public API: revoke invitation
// ---------------------------------------------------------------------------

export async function revokeWorkspaceInvitationForAuthorizationHeader(
  authorizationHeader: string | undefined,
  invitationId: string,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["corporate_admin"], preferredWorkspaceId);
  const adminClient = createServiceRoleClient();

  const { error } = await adminClient
    .from("account_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("workspace_id", workspace.id);

  if (error) throw new AppError(500, error.message);

  return { revoked: true };
}

// ---------------------------------------------------------------------------
// Public API: accept invitation
// ---------------------------------------------------------------------------

export async function acceptWorkspaceInvitationForAuthorizationHeader(
  authorizationHeader: string | undefined,
  token: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const adminClient = createServiceRoleClient();

  const { data: invitation, error } = await adminClient
    .from("account_invitations")
    .select("id, account_id, workspace_id, email, account_class, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !invitation) {
    throw new AppError(404, "Invitation not found or has expired.");
  }

  const invitedEmail = normalizeEmail(invitation.email);
  const currentUserEmail = normalizeEmail(user.rawEmail);

  if (invitedEmail !== currentUserEmail) {
    throw new AppError(
      409,
      `This invitation was sent to ${invitation.email}, but you're signed in as ${user.email}. Sign in with the invited address to join this workspace.`,
    );
  }

  if (!invitation.workspace_id) {
    throw new AppError(409, "This invitation is not attached to a workspace.");
  }

  if (invitation.accepted_at) {
    // Already accepted — just make sure they're in the workspace and return success
    const { data: existingMembership } = await adminClient
      .from("account_members")
      .select("account_class")
      .eq("account_id", invitation.account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMembership) {
      const { data: workspace } = await adminClient
        .from("workspaces")
        .select("id, name, slug, workspace_type, organization_id, owner_user_id")
        .eq("id", invitation.workspace_id)
        .maybeSingle();

      if (workspace?.organization_id) {
        const organization = await getOrganizationById(workspace.organization_id);
        if (organization) {
          const { error: accountMemberError } = await adminClient.from("account_members").upsert(
            {
              account_id: workspace.organization_id,
              workspace_id: workspace.id,
              user_id: user.id,
              account_class: invitation.account_class,
              is_primary_admin: workspace.owner_user_id === user.id,
            },
            { onConflict: "account_id,user_id" },
          );

          if (accountMemberError) {
            throw new AppError(500, accountMemberError.message);
          }
        }
      }

      return {
        joined: true,
        alreadyMember: true,
        workspace: workspace
          ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
          : null,
        accountClass: invitation.account_class,
      };
    }
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new AppError(410, "This invitation has expired. Ask your team admin to send a new one.");
  }

  // Check if already a member of this workspace (e.g. joined another way)
  const { data: existingMembership } = await adminClient
    .from("account_members")
    .select("account_class")
    .eq("account_id", invitation.account_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingMembership) {
    const { error: accountMemberError } = await adminClient.from("account_members").upsert(
      {
        account_id: invitation.account_id,
        workspace_id: invitation.workspace_id,
        user_id: user.id,
        account_class: invitation.account_class,
        is_primary_admin: false,
      },
      { onConflict: "account_id,user_id" },
    );

    if (accountMemberError) throw new AppError(500, accountMemberError.message);
  }

  // Mark as accepted
  await adminClient
    .from("account_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Fetch the workspace for the success message
  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("id, name, slug, workspace_type, organization_id, owner_user_id")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  if (workspace?.organization_id) {
    const organization = await getOrganizationById(workspace.organization_id);
    if (organization) {
      const { error: accountMemberError } = await adminClient.from("account_members").upsert(
        {
          account_id: workspace.organization_id,
          workspace_id: workspace.id,
          user_id: user.id,
          account_class: invitation.account_class,
          is_primary_admin: workspace.owner_user_id === user.id,
        },
        { onConflict: "account_id,user_id" },
      );

      if (accountMemberError) {
        throw new AppError(500, accountMemberError.message);
      }
    }
  }

  await syncProfileIdentity({
    id: user.id,
    email: user.email,
    displayName: user.name ?? user.email,
    accountType: workspace?.workspace_type === "team" ? "corporate" : "individual",
    workspaceName: workspace?.name ?? null,
    companyName: workspace?.workspace_type === "team" ? workspace?.name ?? null : null,
  });

  return {
    joined: true,
    alreadyMember: false,
    workspace: workspace
      ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
      : null,
    accountClass: invitation.account_class,
  };
}

export async function getWorkspaceInvitationDetails(token: string) {
  const adminClient = createServiceRoleClient();
  const { data: invitation, error } = await adminClient
    .from("account_invitations")
    .select("id, account_id, workspace_id, email, account_class, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !invitation) {
    throw new AppError(404, "Invitation not found.");
  }

  const { data: workspace, error: workspaceError } = await adminClient
    .from("workspaces")
    .select("id, name, slug")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  if (workspaceError) {
    throw new AppError(500, workspaceError.message);
  }

  return {
    invitation: {
      email: invitation.email,
      accountClass: invitation.account_class,
      expiresAt: invitation.expires_at,
      acceptedAt: invitation.accepted_at,
      status: mapInvitationStatus(invitation),
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
          }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API: update workspace name
// ---------------------------------------------------------------------------

export async function updateWorkspaceNameForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["personal", "corporate_admin"], preferredWorkspaceId);
  const parsed = updateWorkspaceNameSchema.parse(input);
  const adminClient = createServiceRoleClient();
  const organization = await getOrganizationForWorkspace(workspace);

  const { error } = await adminClient
    .from("workspaces")
    .update({ name: parsed.name })
    .eq("id", workspace.id);

  if (error) throw new AppError(500, error.message);

  if (organization.account_type === "corporate") {
    const { error: organizationError } = await adminClient
      .from("organizations")
      .update({ name: parsed.name })
      .eq("id", organization.id);

    if (organizationError) {
      throw new AppError(500, organizationError.message);
    }
  }

  const { data: memberProfiles, error: memberProfilesError } = await adminClient
    .from("account_members")
    .select("user_id")
    .eq("account_id", organization.id);

  if (memberProfilesError) {
    throw new AppError(500, memberProfilesError.message);
  }

  const workspaceMemberIds = ((memberProfiles ?? []) as Array<{ user_id: string }>).map(
    (entry) => entry.user_id,
  );
  const profilesById = await getProfileIdentitiesById(adminClient, workspaceMemberIds);

  await Promise.all(
    workspaceMemberIds.map(async (userId) => {
      const profile = profilesById.get(userId);
      if (!profile?.email) {
        return;
      }

      await syncProfileIdentity({
        id: userId,
        email: profile.email,
        displayName: profile.display_name,
        username: profile.username,
        profileKind: profile.profile_kind,
        accountType: organization.account_type,
        workspaceName: parsed.name,
        companyName: organization.account_type === "corporate" ? parsed.name : null,
      });
    }),
  );

  return { updated: true, name: parsed.name };
}

// ---------------------------------------------------------------------------
// Public API: send password reset for a workspace member
// ---------------------------------------------------------------------------

export async function sendWorkspaceMemberPasswordResetForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(
    user,
    ["corporate_admin"],
    preferredWorkspaceId,
  );
  const parsed = sendWorkspacePasswordResetSchema.parse(input);
  const adminClient = createServiceRoleClient();

  const { data: membership, error } = await adminClient
    .from("account_members")
    .select("user_id, account_class")
    .eq("account_id", workspace.organization_id)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (error) throw new AppError(500, error.message);
  if (!membership) {
    throw new AppError(404, "That user is not a member of this workspace.");
  }

  const typedMembership = membership as { user_id: string; account_class: AccountClass };
  const targetProfile = (await getProfileIdentitiesById(adminClient, [parsed.userId])).get(parsed.userId);
  const targetEmail = targetProfile?.email ?? null;

  if (!targetEmail) {
    throw new AppError(404, "That user does not have a sign-in email on file.");
  }

  if (typedMembership.account_class === "corporate_admin" && typedMembership.user_id !== user.id) {
    throw new AppError(403, "Only an account admin can reset another account admin's password.");
  }

  const authClient = createAuthClient();
  const redirectTo = parsed.redirectTo ?? getCanonicalAppOrigin();
  const { error: resetError } = await authClient.auth.resetPasswordForEmail(targetEmail, {
    redirectTo,
  });

  if (resetError) {
    throw new AppError(500, resetError.message);
  }

  return {
    email: targetEmail,
    redirectTo,
    sent: true,
  };
}

// ---------------------------------------------------------------------------
// Public API: change a workspace member's role
// ---------------------------------------------------------------------------

export async function changeWorkspaceMemberRoleForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(
    user,
    ["corporate_admin"],
    preferredWorkspaceId,
  );
  const parsed = changeMemberRoleSchema.parse(input);
  const adminClient = createServiceRoleClient();

  if (parsed.userId === user.id) {
    throw new AppError(400, "You cannot change your own role.");
  }

  // Check the target is actually a member and get their current account class.
  const { data: membership, error: fetchError } = await adminClient
    .from("account_members")
    .select("account_class")
    .eq("account_id", workspace.organization_id)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (fetchError) throw new AppError(500, fetchError.message);
  if (!membership) throw new AppError(404, "That user is not a member of this workspace.");

  const { error: accountMemberError } = await adminClient
    .from("account_members")
    .update({
      account_class: parsed.accountClass,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", workspace.organization_id)
    .eq("user_id", parsed.userId);

  if (accountMemberError) throw new AppError(500, accountMemberError.message);

  return {
    updated: true,
    userId: parsed.userId,
    accountClass: parsed.accountClass,
  };
}

// ---------------------------------------------------------------------------
// Public API: remove a workspace member
// ---------------------------------------------------------------------------

export async function removeWorkspaceMemberForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(
    user,
    ["corporate_admin"],
    preferredWorkspaceId,
  );
  const parsed = removeMemberSchema.parse(input);
  const adminClient = createServiceRoleClient();

  if (parsed.userId === user.id) {
    throw new AppError(400, "You cannot remove yourself from the workspace.");
  }

  // Check the target is a member and get their account class.
  const { data: membership, error: fetchError } = await adminClient
    .from("account_members")
    .select("account_class")
    .eq("account_id", workspace.organization_id)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (fetchError) throw new AppError(500, fetchError.message);
  if (!membership) throw new AppError(404, "That user is not a member of this workspace.");

  if (membership.account_class === "corporate_admin") {
    throw new AppError(403, "Corporate admins cannot be removed until their account class is changed.");
  }

  const { error: accountMemberError } = await adminClient
    .from("account_members")
    .delete()
    .eq("account_id", workspace.organization_id)
    .eq("user_id", parsed.userId);

  if (accountMemberError) throw new AppError(500, accountMemberError.message);

  return { removed: true, userId: parsed.userId };
}

export async function listAccessibleWorkspacesForAuthorizationHeader(
  authorizationHeader: string | undefined,
  preferredWorkspaceId?: string | null,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const [workspaces, currentWorkspace] = await Promise.all([
    listAccessibleWorkspacesForUser(user),
    resolveWorkspaceForUser(user, preferredWorkspaceId),
  ]);
  const organizationIds = Array.from(
    new Set(
      [currentWorkspace.organization_id, ...workspaces.map((entry) => entry.workspace.organization_id)].filter(Boolean),
    ),
  );
  const organizations = await Promise.all(
    organizationIds.map(async (organizationId) => [organizationId, await getOrganizationById(organizationId)] as const),
  );
  const organizationById = new Map(organizations.filter(([, organization]) => organization).map(([id, organization]) => [id, organization as OrganizationRow]));
  const currentOrganization = organizationById.get(currentWorkspace.organization_id);
  const currentWorkspaceAccountClass =
    workspaces.find((entry) => entry.workspace.id === currentWorkspace.id)?.accountClass ??
    await getAccountClassForUser({
      accountId: currentWorkspace.organization_id,
      userId: user.id,
      organization: currentOrganization,
      workspace: currentWorkspace,
    });

  return {
    currentWorkspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      slug: currentWorkspace.slug,
      workspaceType: currentWorkspace.workspace_type,
      accountClass: currentWorkspaceAccountClass,
      organization: currentOrganization
        ? {
            id: currentOrganization.id,
            name: currentOrganization.name,
            slug: currentOrganization.slug,
            accountType: currentOrganization.account_type,
            accountClass: currentWorkspaceAccountClass,
          }
        : null,
    },
    workspaces: workspaces.map((entry) => ({
      id: entry.workspace.id,
      name: entry.workspace.name,
      slug: entry.workspace.slug,
      workspaceType: entry.workspace.workspace_type,
      accountClass: entry.accountClass,
      organization: organizationById.get(entry.workspace.organization_id)
        ? {
            id: organizationById.get(entry.workspace.organization_id)?.id ?? entry.workspace.organization_id,
            name: organizationById.get(entry.workspace.organization_id)?.name ?? entry.workspace.name,
            slug: organizationById.get(entry.workspace.organization_id)?.slug ?? entry.workspace.slug,
            accountType: organizationById.get(entry.workspace.organization_id)?.account_type ?? "individual",
            accountClass: entry.accountClass,
          }
        : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Email helper
// ---------------------------------------------------------------------------

async function sendInviteEmail(
  env: ReturnType<typeof readServerEnv>,
	opts: {
    toEmail: string;
    inviterName: string;
    workspaceName: string;
    accountClass: AccountClass;
    token: string;
    appOrigin: string;
  },
) {
  const acceptUrl = `${opts.appOrigin}?invite=${encodeURIComponent(opts.token)}`;
  const roleLabel =
    opts.accountClass === "corporate_admin"
      ? "Corporate admin"
      : opts.accountClass === "personal"
        ? "Personal"
        : "Corporate member";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #111; max-width: 520px; margin: 40px auto; padding: 0 20px;">
  <h2 style="font-size: 20px; margin-bottom: 8px;">You've been invited to ${escapeHtml(opts.workspaceName)}</h2>
  <p style="color: #555; margin-bottom: 24px;">
    ${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.workspaceName)}</strong> on EasyDraftDocs.
  </p>
  <p style="color: #555; margin-bottom: 16px; line-height: 1.6;">
    EasyDraftDocs is a private document workflow workspace for teams. You'll be able to review documents, participate in signing workflows, and work inside your organization's shared audit trail.
  </p>
  <p style="color: #555; margin-bottom: 24px; line-height: 1.6;">
    Initial access level: <strong>${roleLabel}</strong>.
  </p>
  <a href="${acceptUrl}"
     style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
            border-radius: 6px; text-decoration: none; font-weight: 600;">
    Accept invitation
  </a>
  <p style="color: #666; margin-top: 24px; line-height: 1.6;">
    If you already have an EasyDraftDocs account, accepting will add this workspace to your access. If you're new, you'll sign up first and then continue into the workspace.
  </p>
  <p style="color: #999; font-size: 13px; margin-top: 32px;">
    This invitation expires in 7 days. If you didn't expect this email, you can ignore it.
  </p>
  <p style="color: #bbb; font-size: 12px;">
    Or copy this link: ${acceptUrl}
  </p>
</body>
</html>`;

  await deliverNotificationEmail(env, {
    to: opts.toEmail,
    subject: `${opts.inviterName} invited you to ${opts.workspaceName} on EasyDraftDocs`,
    html,
  });
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
