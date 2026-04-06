import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  createDigitalSignatureProfileForAuthorizationHeader,
  deleteOwnAccountForAuthorizationHeader,
  getProfileForAuthorizationHeader,
  listDigitalSignatureProfilesForAuthorizationHeader,
  updateProfileForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get("/profile", async (request, reply) => {
    try {
      return await getProfileForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/profile", async (request, reply) => {
    try {
      return await updateProfileForAuthorizationHeader(request.headers.authorization, request.body);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/digital-signatures", async (request, reply) => {
    try {
      return await listDigitalSignatureProfilesForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/digital-signatures", async (request, reply) => {
    try {
      return await createDigitalSignatureProfileForAuthorizationHeader(
        request.headers.authorization,
        request.body,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/account-delete", async (request, reply) => {
    try {
      const { confirmEmail } = request.body as { confirmEmail?: string };
      if (!confirmEmail) {
        return reply.code(400).send({ message: "confirmEmail is required." });
      }
      return await deleteOwnAccountForAuthorizationHeader(request.headers.authorization, confirmEmail);
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
