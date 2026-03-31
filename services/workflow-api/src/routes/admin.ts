import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { AppError, getAdminOverviewForAuthorizationHeader } from "@clean-pdf/workflow-service";

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
};
