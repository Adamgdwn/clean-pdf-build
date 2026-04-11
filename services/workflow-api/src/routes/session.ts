import type { FastifyPluginAsync } from "fastify";

import {
  AppError,
  createFeedbackRequest,
  getSessionFromAuthorizationHeader,
} from "@clean-pdf/workflow-service";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/session", async (request, reply) => {
    try {
      return await getSessionFromAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });

  app.post("/feedback", async (request, reply) => {
    try {
      return await createFeedbackRequest(request.headers.authorization, request.body);
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });
};
