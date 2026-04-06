import Fastify from "fastify";
import cors from "@fastify/cors";

import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { billingRoutes } from "./routes/billing";
import { documentRoutes } from "./routes/documents";
import { sessionRoutes } from "./routes/session";
import { signatureRoutes } from "./routes/signatures";
import { teamRoutes } from "./routes/team";

export function buildWorkflowServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: true,
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

  return app;
}
