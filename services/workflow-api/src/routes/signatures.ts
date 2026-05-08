import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  createSignatureIdentityForAuthorizationHeader,
  listSignatureIdentitiesForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const signatureRoutes: FastifyPluginAsync = async (app) => {
  app.get("/signature-identities", async (request, reply) => {
    try {
      return await listSignatureIdentitiesForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/signature-identities", async (request, reply) => {
    try {
      return await createSignatureIdentityForAuthorizationHeader(request.headers.authorization, request.body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
