import { z } from "zod";

import { readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import { deliverNotificationEmail } from "./notifications.js";
import {
  ensureDefaultWorkspaceForUser,
  resolveAuthenticatedUser,
  type AuthenticatedUser,
} from "./service.js";
import { createServiceRoleClient } from "./supabase.js";

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
  owner_user_id: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function requireWorkspaceWithRole(
  user: AuthenticatedUser,
  allowedRoles: string[],
): Promise<{ workspace: WorkspaceRow; memberRole: string }> {
  const workspace = (await ensureDefaultWorkspaceForUser(user)) as WorkspaceRow;
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

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["member", "admin", "billing_admin"]).default("member"),
});

const updateWorkspaceNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// ---------------------------------------------------------------------------
// Public API: list team members + pending invitations
// ---------------------------------------------------------------------------

export async function getWorkspaceTeamForAuthorizationHeader(
  authorizationHeader: string | undefined,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const workspace = (await ensureDefaultWorkspaceForUser(user)) as WorkspaceRow;
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
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
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
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["owner", "admin"]);
  const parsed = createInvitationSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const adminClient = createServiceRoleClient();
  const env = readServerEnv();

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
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["owner", "admin"]);
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
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["owner", "admin"]);
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
      return { joined: true, alreadyMember: true };
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

  // Fetch the workspace name for the success message
  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("name")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  return {
    joined: true,
    alreadyMember: false,
    workspaceName: workspace?.name ?? "your team",
  };
}

// ---------------------------------------------------------------------------
// Public API: update workspace name
// ---------------------------------------------------------------------------

export async function updateWorkspaceNameForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace } = await requireWorkspaceWithRole(user, ["owner"]);
  const parsed = updateWorkspaceNameSchema.parse(input);
  const adminClient = createServiceRoleClient();

  const { error } = await adminClient
    .from("workspaces")
    .update({ name: parsed.name })
    .eq("id", workspace.id);

  if (error) throw new AppError(500, error.message);

  return { updated: true, name: parsed.name };
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
    token: string;
    appOrigin: string;
  },
) {
  const acceptUrl = `${opts.appOrigin}?invite=${encodeURIComponent(opts.token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #111; max-width: 520px; margin: 40px auto; padding: 0 20px;">
  <h2 style="font-size: 20px; margin-bottom: 8px;">You've been invited to ${escapeHtml(opts.workspaceName)}</h2>
  <p style="color: #555; margin-bottom: 24px;">
    ${escapeHtml(opts.inviterName)} invited you to collaborate on EasyDraftDocs.
  </p>
  <a href="${acceptUrl}"
     style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
            border-radius: 6px; text-decoration: none; font-weight: 600;">
    Accept invitation
  </a>
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
