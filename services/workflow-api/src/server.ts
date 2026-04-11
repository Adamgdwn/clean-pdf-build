import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  AppError,
  captureServerException,
  consumeRateLimit,
  type RateLimitPolicy,
} from "@clean-pdf/workflow-service";

import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { billingRoutes } from "./routes/billing";
import { documentRoutes } from "./routes/documents";
import { sessionRoutes } from "./routes/session";
import { signatureRoutes } from "./routes/signatures";
import { teamRoutes } from "./routes/team";

function resolveRateLimitPolicy(method: string, path: string): RateLimitPolicy | null {
  if (method === "GET" && path === "/session") {
    return { key: "workflow-api:session", limit: 60, windowMs: 60_000 };
  }

  if (path === "/signing-token-session" || /\/field-complete-token$/.test(path)) {
    return { key: "workflow-api:signing", limit: 10, windowMs: 5 * 60_000 };
  }

  if (
    path === "/billing-checkout" ||
    path === "/billing-token-checkout" ||
    path === "/admin-user-reset" ||
    path === "/admin-user-invite"
  ) {
    return { key: `workflow-api:${path}`, limit: 8, windowMs: 60_000 };
  }

  if (path === "/workspace-invite" || /\/send$/.test(path) || /\/remind$/.test(path)) {
    return { key: `workflow-api:${path}`, limit: 10, windowMs: 60_000 };
  }

  if ((path === "/documents" && method === "POST") || /\/processing\//.test(path)) {
    return { key: `workflow-api:${path}`, limit: 20, windowMs: 10 * 60_000 };
  }

  return null;
}

export function buildWorkflowServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.raw.url?.split("?")[0] ?? request.url;
    const policy = resolveRateLimitPolicy(request.method, path);

    if (!policy) {
      return;
    }

    const result = await consumeRateLimit(request.ip, policy);
    reply.header("X-RateLimit-Limit", String(result.limit));
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    reply.header("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));

    if (!result.allowed) {
      reply.header("Retry-After", String(result.retryAfterSeconds));
      throw new AppError(429, "Too many requests. Please wait a moment and try again.");
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "workflow-api",
  }));

  app.register(accountRoutes);
  app.register(adminRoutes);
  app.register(sessionRoutes);
  app.register(signatureRoutes);
  app.register(billingRoutes);
  app.register(teamRoutes);
  app.register(documentRoutes);

  app.setErrorHandler((error, _, reply) => {
    const typedError = error as AppError;
    if ((typedError.statusCode ?? 500) >= 500) {
      captureServerException(error, {
        scope: "workflow-api",
        statusCode: typedError.statusCode ?? 500,
      });
    }

    reply.code(typedError.statusCode ?? 500).send({ message: typedError.message ?? "Unexpected error" });
  });

  return app;
}
