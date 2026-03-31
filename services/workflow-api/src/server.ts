import Fastify from "fastify";
import cors from "@fastify/cors";

import { billingRoutes } from "./routes/billing";
import { documentRoutes } from "./routes/documents";
import { sessionRoutes } from "./routes/session";

export function buildWorkflowServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "workflow-api",
  }));

  app.register(sessionRoutes);
  app.register(billingRoutes);
  app.register(documentRoutes);

  return app;
}
