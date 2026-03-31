import type { FastifyPluginAsync } from "fastify";

import { AppError, getSessionFromAuthorizationHeader } from "@clean-pdf/workflow-service";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/session", async (request, reply) => {
    try {
      return await getSessionFromAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });
};
