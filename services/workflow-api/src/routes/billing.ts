import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  createBillingPortalSessionForAuthorizationHeader,
  createCheckoutSessionForAuthorizationHeader,
  createTokenCheckoutSessionForAuthorizationHeader,
  getCanonicalAppOrigin,
  getBillingOverviewForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
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
        getCanonicalAppOrigin(),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/billing-portal", async (request, reply) => {
    try {
      return await createBillingPortalSessionForAuthorizationHeader(
        request.headers.authorization,
        getCanonicalAppOrigin(),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/billing-token-checkout", async (request, reply) => {
    try {
      return await createTokenCheckoutSessionForAuthorizationHeader(
        request.headers.authorization,
        getCanonicalAppOrigin(),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
