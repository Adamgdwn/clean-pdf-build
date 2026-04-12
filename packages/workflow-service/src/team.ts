import { z } from "zod";

import { getCanonicalAppOrigin, readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import { deliverNotificationEmail } from "./notifications.js";
import {
  ensureDefaultWorkspaceForUser,
  ensureOrganizationForWorkspace,
  getOrganizationById,
  getOrganizationMembershipRole,
  listAccessibleWorkspacesForUser,
  resolveAuthenticatedUser,
  resolveWorkspaceForUser,
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
  profiles: {
    id: string;
    display_name: string | null;
    email: string;
  } | null;
};

type WorkspaceMemberResetRow = {
  user_id: string;
  role: string;
  profiles:
    | {
        email: string;
      }
    | Array<{
        email: string;
      }>
    | null;
};

type WorkspaceInvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getMembershipEmail(
  profiles: WorkspaceMemberResetRow["profiles"],
): string | null {
  if (!profiles) {
    return null;
  }

  return Array.isArray(profiles) ? profiles[0]?.email ?? null : profiles.email;
}

async function requireWorkspaceWithRole(
  user: AuthenticatedUser,
  allowedRoles: string[],
  preferredWorkspaceId?: string | null,
): Promise<{ workspace: WorkspaceRow; memberRole: string }> {
  const workspace = (await resolveWorkspaceForUser(user, preferredWorkspaceId)) as WorkspaceRow;
  const adminClient = createServiceRoleClient();

  const { data: membership, error } = await adminClient
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new AppError(500, error.message);

  const role = membership?.role ?? null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AppError(403, "You do not have permission to manage this workspace.");
  }

  return { workspace, memberRole: role };
}

async function getOrganizationForWorkspace(workspace: WorkspaceRow) {
  const organization = await ensureOrganizationForWorkspace(workspace);
  return organization as OrganizationRow;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["owner", "member", "admin", "billing_admin"]).default("member"),
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
  role: z.enum(["owner", "member", "admin", "billing_admin"]),
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
  const organizationMembershipRole = await getOrganizationMembershipRole(organization.id, user.id);
  const adminClient = createServiceRoleClient();

  const [membersResult, invitationsResult] = await Promise.all([
    adminClient
      .from("workspace_memberships")
      .select("workspace_id, user_id, role, created_at, profiles(id, display_name, email)")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true }),

    adminClient
      .from("workspace_invitations")
      .select("id, workspace_id, email, role, invited_by_user_id, expires_at, accepted_at, created_at")
      .eq("workspace_id", workspace.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }),
  ]);

  if (membersResult.error) throw new AppError(500, membersResult.error.message);
  if (invitationsResult.error) throw new AppError(500, invitationsResult.error.message);

  const members = (membersResult.data ?? []) as unknown as WorkspaceMemberRow[];
  const invitations = (invitationsResult.data ?? []) as WorkspaceInvitationRow[];

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      accountType: organization.account_type,
      membershipRole: organizationMembershipRole,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      organizationId: organization.id,
    },
    members: members.map((m) => ({
      userId: m.user_id,
      role: m.role,
      displayName: m.profiles?.display_name ?? m.profiles?.email ?? "Unknown",
      email: m.profiles?.email ?? null,
      isCurrentUser: m.user_id === user.id,
      joinedAt: m.created_at,
    })),
    pendingInvitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
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
  const { workspace, memberRole } = await requireWorkspaceWithRole(
    user,
    ["owner", "admin"],
    preferredWorkspaceId,
  );
  const parsed = createInvitationSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();

  if (parsed.role === "owner" && memberRole !== "owner") {
    throw new AppError(403, "Only the workspace owner can invite another owner.");
  }

  // Check if already a member
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingProfile?.id) {
    const { data: existingMembership } = await adminClient
      .from("workspace_memberships")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (existingMembership) {
      throw new AppError(409, `${email} is already a member of this workspace.`);
    }
  }

  // Check for existing pending invite
  const { data: existingInvite } = await adminClient
    .from("workspace_invitations")
    .select("id")
    .eq("workspace_id", workspace.id)
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
    .from("workspace_invitations")
    .insert({
      workspace_id: workspace.id,
      email,
      role: parsed.role,
      invited_by_user_id: user.id,
      token,
      expires_at: expiresAt,
    })
    .select("id, email, role, expires_at")
    .single();

  if (insertError || !invitation) {
    throw new AppError(500, insertError?.message ?? "Failed to create invitation.");
  }

  await sendInviteEmail(env, {
    toEmail: email,
    inviterName: user.name ?? user.email,
    workspaceName: workspace.name,
    role: parsed.role,
    token,
    appOrigin: env.EASYDRAFT_APP_ORIGIN,
  });

  // Seat count advisory: count current members + pending invites after this one
  const { count: memberCount } = await adminClient
    .from("workspace_memberships")
    .select("*", { head: true, count: "exact" })
    .eq("workspace_id", workspace.id);

  const { count: pendingCount } = await adminClient
    .from("workspace_invitations")
    .select("*", { head: true, count: "exact" })
    .eq("workspace_id", workspace.id)
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
      role: invitation.role,
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
  const { workspace } = await requireWorkspaceWithRole(user, ["owner", "admin"], preferredWorkspaceId);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();

  const { data: invitation, error } = await adminClient
    .from("workspace_invitations")
    .select("id, email, role, token, expires_at, accepted_at")
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
    .from("workspace_invitations")
    .update({ expires_at: newExpiresAt })
    .eq("id", invitationId);

  await sendInviteEmail(env, {
    toEmail: invitation.email,
    inviterName: user.name ?? user.email,
    workspaceName: workspace.name,
    role: invitation.role,
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
  const { workspace } = await requireWorkspaceWithRole(user, ["owner", "admin"], preferredWorkspaceId);
  const adminClient = createServiceRoleClient();

  const { error } = await adminClient
    .from("workspace_invitations")
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
    .from("workspace_invitations")
    .select("id, workspace_id, email, role, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !invitation) {
    throw new AppError(404, "Invitation not found or has expired.");
  }

  if (invitation.accepted_at) {
    // Already accepted — just make sure they're in the workspace and return success
    const { data: existingMembership } = await adminClient
      .from("workspace_memberships")
      .select("role")
      .eq("workspace_id", invitation.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMembership) {
      const { data: workspace } = await adminClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("id", invitation.workspace_id)
        .maybeSingle();

      return {
        joined: true,
        alreadyMember: true,
        workspace: workspace
          ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
          : null,
        role: invitation.role,
      };
    }
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new AppError(410, "This invitation has expired. Ask your team admin to send a new one.");
  }

  // Check if already a member of this workspace (e.g. joined another way)
  const { data: existingMembership } = await adminClient
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", invitation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingMembership) {
    const { error: membershipError } = await adminClient.from("workspace_memberships").insert({
      workspace_id: invitation.workspace_id,
      user_id: user.id,
      role: invitation.role,
    });

    if (membershipError) throw new AppError(500, membershipError.message);
  }

  // Mark as accepted
  await adminClient
    .from("workspace_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Fetch the workspace for the success message
  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("id, name, slug, workspace_type, organization_id, owner_user_id")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  if (workspace?.organization_id) {
    const { error: orgMembershipError } = await adminClient.from("organization_memberships").upsert(
      {
        organization_id: workspace.organization_id,
        user_id: user.id,
        role: invitation.role,
      },
      { onConflict: "organization_id,user_id" },
    );

    if (orgMembershipError) {
      throw new AppError(500, orgMembershipError.message);
    }
  }

  return {
    joined: true,
    alreadyMember: false,
    workspace: workspace
      ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
      : null,
    role: invitation.role,
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
  const { workspace } = await requireWorkspaceWithRole(user, ["owner"], preferredWorkspaceId);
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
  const { workspace, memberRole } = await requireWorkspaceWithRole(
    user,
    ["owner", "admin"],
    preferredWorkspaceId,
  );
  const parsed = sendWorkspacePasswordResetSchema.parse(input);
  const adminClient = createServiceRoleClient();

  const { data: membership, error } = await adminClient
    .from("workspace_memberships")
    .select("user_id, role, profiles(email)")
    .eq("workspace_id", workspace.id)
    .eq("user_id", parsed.userId)
    .maybeSingle();
  const typedMembership = membership as WorkspaceMemberResetRow | null;

  if (error) throw new AppError(500, error.message);
  if (!typedMembership) {
    throw new AppError(404, "That user is not a member of this workspace.");
  }

  const targetRole = typedMembership.role;
  const targetEmail = getMembershipEmail(typedMembership.profiles);

  if (!targetEmail) {
    throw new AppError(404, "That user does not have a sign-in email on file.");
  }

  if (targetRole === "owner" && memberRole !== "owner" && typedMembership.user_id !== user.id) {
    throw new AppError(403, "Only the workspace owner can reset another owner's password.");
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
  const { workspace, memberRole } = await requireWorkspaceWithRole(
    user,
    ["owner", "admin"],
    preferredWorkspaceId,
  );
  const parsed = changeMemberRoleSchema.parse(input);
  const adminClient = createServiceRoleClient();

  if (parsed.userId === user.id) {
    throw new AppError(400, "You cannot change your own role.");
  }

  // Only owners can assign or remove the owner role
  if (parsed.role === "owner" && memberRole !== "owner") {
    throw new AppError(403, "Only the workspace owner can assign the owner role.");
  }

  // Check the target is actually a member and get their current role
  const { data: membership, error: fetchError } = await adminClient
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (fetchError) throw new AppError(500, fetchError.message);
  if (!membership) throw new AppError(404, "That user is not a member of this workspace.");

  // Admins cannot change the role of owners
  if (membership.role === "owner" && memberRole !== "owner") {
    throw new AppError(403, "Only the workspace owner can change another owner's role.");
  }

  const { error } = await adminClient
    .from("workspace_memberships")
    .update({ role: parsed.role })
    .eq("workspace_id", workspace.id)
    .eq("user_id", parsed.userId);

  if (error) throw new AppError(500, error.message);

  if (workspace.organization_id) {
    const { error: organizationError } = await adminClient
      .from("organization_memberships")
      .update({ role: parsed.role })
      .eq("organization_id", workspace.organization_id)
      .eq("user_id", parsed.userId);

    if (organizationError) {
      throw new AppError(500, organizationError.message);
    }
  }

  return { updated: true, userId: parsed.userId, role: parsed.role };
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
  const { workspace, memberRole } = await requireWorkspaceWithRole(
    user,
    ["owner", "admin"],
    preferredWorkspaceId,
  );
  const parsed = removeMemberSchema.parse(input);
  const adminClient = createServiceRoleClient();

  if (parsed.userId === user.id) {
    throw new AppError(400, "You cannot remove yourself from the workspace.");
  }

  // Check the target is a member and get their role
  const { data: membership, error: fetchError } = await adminClient
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (fetchError) throw new AppError(500, fetchError.message);
  if (!membership) throw new AppError(404, "That user is not a member of this workspace.");

  // Admins cannot remove owners
  if (membership.role === "owner" && memberRole !== "owner") {
    throw new AppError(403, "Only the workspace owner can remove another owner.");
  }

  const { error } = await adminClient
    .from("workspace_memberships")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("user_id", parsed.userId);

  if (error) throw new AppError(500, error.message);

  if (workspace.organization_id) {
    const { count, error: remainingMembershipsError } = await adminClient
      .from("workspace_memberships")
      .select("workspace_id", { head: true, count: "exact" })
      .eq("user_id", parsed.userId)
      .in(
        "workspace_id",
        (
          await adminClient
            .from("workspaces")
            .select("id")
            .eq("organization_id", workspace.organization_id)
        ).data?.map((entry) => entry.id) ?? [],
      );

    if (remainingMembershipsError) {
      throw new AppError(500, remainingMembershipsError.message);
    }

    if ((count ?? 0) === 0) {
      const { error: organizationError } = await adminClient
        .from("organization_memberships")
        .delete()
        .eq("organization_id", workspace.organization_id)
        .eq("user_id", parsed.userId);

      if (organizationError) {
        throw new AppError(500, organizationError.message);
      }
    }
  }

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
  const organizationRoleById = new Map(
    await Promise.all(
      organizationIds.map(async (organizationId) => [
        organizationId,
        await getOrganizationMembershipRole(organizationId, user.id),
      ] as const),
    ),
  );
  const currentOrganization = organizationById.get(currentWorkspace.organization_id);

  return {
    currentWorkspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      slug: currentWorkspace.slug,
      workspaceType: currentWorkspace.workspace_type,
      role: workspaces.find((entry) => entry.workspace.id === currentWorkspace.id)?.role ?? null,
      organization: currentOrganization
        ? {
            id: currentOrganization.id,
            name: currentOrganization.name,
            slug: currentOrganization.slug,
            accountType: currentOrganization.account_type,
            role: organizationRoleById.get(currentOrganization.id) ?? null,
          }
        : null,
    },
    workspaces: workspaces.map((entry) => ({
      id: entry.workspace.id,
      name: entry.workspace.name,
      slug: entry.workspace.slug,
      workspaceType: entry.workspace.workspace_type,
      role: entry.role,
      organization: organizationById.get(entry.workspace.organization_id)
        ? {
            id: organizationById.get(entry.workspace.organization_id)?.id ?? entry.workspace.organization_id,
            name: organizationById.get(entry.workspace.organization_id)?.name ?? entry.workspace.name,
            slug: organizationById.get(entry.workspace.organization_id)?.slug ?? entry.workspace.slug,
            accountType: organizationById.get(entry.workspace.organization_id)?.account_type ?? "individual",
            role: organizationRoleById.get(entry.workspace.organization_id) ?? null,
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
    role?: string;
    token: string;
    appOrigin: string;
  },
) {
  const acceptUrl = `${opts.appOrigin}?invite=${encodeURIComponent(opts.token)}`;
  const roleLabel =
    opts.role === "owner"
      ? "Owner"
      : opts.role === "admin"
        ? "Admin"
        : opts.role === "billing_admin"
          ? "Billing admin"
          : "Member";

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
