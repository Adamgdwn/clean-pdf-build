import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  deleteAdminUserForAuthorizationHeader,
  getAdminOverviewForAuthorizationHeader,
  listAdminUsersForAuthorizationHeader,
  sendAdminPasswordResetForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin-overview", async (request, reply) => {
    try {
      return await getAdminOverviewForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/admin-users", async (request, reply) => {
    try {
      return await listAdminUsersForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/admin-user-reset", async (request, reply) => {
    try {
      return await sendAdminPasswordResetForAuthorizationHeader(request.headers.authorization, {
        ...(request.body as Record<string, unknown>),
        redirectTo:
          ((request.headers.origin as string | undefined) ?? "").trim() || "http://localhost:5173",
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/admin-user-delete", async (request, reply) => {
    try {
      return await deleteAdminUserForAuthorizationHeader(request.headers.authorization, request.body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
