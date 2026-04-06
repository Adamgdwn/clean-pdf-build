import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  AppError,
  createBillingPortalSessionForAuthorizationHeader,
  createCheckoutSessionForAuthorizationHeader,
  createTokenCheckoutSessionForAuthorizationHeader,
  getBillingOverviewForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
  function getOrigin(request: FastifyRequest) {
    return request.headers.origin ?? `${request.protocol}://${request.host}`;
  }

  app.get("/billing-overview", async (request, reply) => {
    try {
      return await getBillingOverviewForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/billing-checkout", async (request, reply) => {
    try {
      return await createCheckoutSessionForAuthorizationHeader(
        request.headers.authorization,
        request.body,
        getOrigin(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/billing-portal", async (request, reply) => {
    try {
      return await createBillingPortalSessionForAuthorizationHeader(
        request.headers.authorization,
        getOrigin(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/billing-token-checkout", async (request, reply) => {
    try {
      return await createTokenCheckoutSessionForAuthorizationHeader(
        request.headers.authorization,
        getOrigin(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
