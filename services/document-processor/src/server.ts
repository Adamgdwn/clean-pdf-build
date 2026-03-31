import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";

import {
  AppError,
  markProcessingJobCompleted,
  processQueuedJobs,
  processQueuedNotifications,
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
