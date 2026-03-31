import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  createSavedSignatureForAuthorizationHeader,
  listSavedSignaturesForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const signatureRoutes: FastifyPluginAsync = async (app) => {
  app.get("/saved-signatures", async (request, reply) => {
    try {
      return await listSavedSignaturesForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/saved-signatures", async (request, reply) => {
    try {
      return await createSavedSignatureForAuthorizationHeader(request.headers.authorization, request.body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
