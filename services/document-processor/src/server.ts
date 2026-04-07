import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";

import {
  AppError,
  markProcessingJobCompleted,
  processQueuedJobs,
  processQueuedNotifications,
  readServerEnv,
  shouldRequireProcessorSecret,
} from "@clean-pdf/workflow-service";

const completeJobSchema = z.object({
  jobId: z.string().uuid(),
  result: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export function buildDocumentProcessorServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onRequest", async (request) => {
    const path = request.raw.url?.split("?")[0] ?? request.url;

    if (path === "/health") {
      return;
    }

    const env = readServerEnv();
    const configuredSecret = env.EASYDRAFT_PROCESSOR_SECRET?.trim();
    const headerSecret = request.headers["x-processor-secret"];
    const sharedSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
    const authHeader = request.headers.authorization;
    const bearerToken = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const normalizedBearer = bearerToken?.startsWith("Bearer ")
      ? bearerToken.slice("Bearer ".length).trim()
      : undefined;

    if (!configuredSecret) {
      if (shouldRequireProcessorSecret(env)) {
        throw new AppError(
          503,
          "Processor authentication is required in this environment. Configure EASYDRAFT_PROCESSOR_SECRET.",
        );
      }

      return;
    }

    if (sharedSecret === configuredSecret || normalizedBearer === configuredSecret) {
      return;
    }

    throw new AppError(401, "Missing or invalid processor secret.");
  });

  app.get("/health", async () => ({
    ok: true,
    service: "document-processor",
  }));

  app.post("/jobs/run-queued", async (_, reply) => {
    try {
      return await processQueuedJobs();
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });

  app.post("/notifications/run-queued", async (_, reply) => {
    try {
      return await processQueuedNotifications();
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });

  app.post("/jobs/complete", async (request, reply) => {
    try {
      const payload = completeJobSchema.parse(request.body);
      return await markProcessingJobCompleted(payload.jobId, payload.result);
    } catch (error) {
      const typedError = error as AppError;
      return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
    }
  });

  return app;
}
