import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  AppError,
  acceptWorkspaceInvitationForAuthorizationHeader,
  changeWorkspaceMemberRoleForAuthorizationHeader,
  createWorkspaceInvitationForAuthorizationHeader,
  getWorkspaceInvitationDetails,
  getWorkspaceTeamForAuthorizationHeader,
  listAccessibleWorkspacesForAuthorizationHeader,
  removeWorkspaceMemberForAuthorizationHeader,
  resendWorkspaceInvitationForAuthorizationHeader,
  revokeWorkspaceInvitationForAuthorizationHeader,
  sendWorkspaceMemberPasswordResetForAuthorizationHeader,
  updateWorkspaceNameForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

function readWorkspaceIdHeader(request: FastifyRequest) {
  const workspaceId = request.headers["x-easydraft-workspace"];

  if (Array.isArray(workspaceId)) {
    return workspaceId[0] ?? null;
  }

  return typeof workspaceId === "string" && workspaceId.trim().length > 0
    ? workspaceId.trim()
    : null;
}

export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.get("/workspaces", async (request, reply) => {
    try {
      return await listAccessibleWorkspacesForAuthorizationHeader(
        request.headers.authorization,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/workspace-team", async (request, reply) => {
    try {
      return await getWorkspaceTeamForAuthorizationHeader(
        request.headers.authorization,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/workspace-invite", async (request, reply) => {
    try {
      return await createWorkspaceInvitationForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/workspace-invite", async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const invitationId = query["invitationId"];

      if (!invitationId) {
        return reply.code(400).send({ message: "Missing invitationId." });
      }

      return await revokeWorkspaceInvitationForAuthorizationHeader(
        request.headers.authorization,
        invitationId,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/workspace-invite-resend", async (request, reply) => {
    try {
      const body = request.body as { invitationId?: string };

      if (!body?.invitationId) {
        return reply.code(400).send({ message: "Missing invitationId." });
      }

      return await resendWorkspaceInvitationForAuthorizationHeader(
        request.headers.authorization,
        body.invitationId,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/workspace-invite-accept", async (request, reply) => {
    try {
      const body = request.body as { token?: string };

      if (!body?.token) {
        return reply.code(400).send({ message: "Missing invite token." });
      }

      return await acceptWorkspaceInvitationForAuthorizationHeader(
        request.headers.authorization,
        body.token,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/workspace-invite-details", async (request, reply) => {
    try {
      const body = request.body as { token?: string };

      if (!body?.token) {
        return reply.code(400).send({ message: "Missing invite token." });
      }

      return await getWorkspaceInvitationDetails(body.token);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/workspace-update", async (request, reply) => {
    try {
      return await updateWorkspaceNameForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/workspace-member-reset", async (request, reply) => {
    try {
      return await sendWorkspaceMemberPasswordResetForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/workspace-member-role", async (request, reply) => {
    try {
      return await changeWorkspaceMemberRoleForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/workspace-member", async (request, reply) => {
    try {
      return await removeWorkspaceMemberForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        readWorkspaceIdHeader(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
