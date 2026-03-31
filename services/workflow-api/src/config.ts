export const config = {
  authSecret: process.env.AUTH_SECRET ?? "change-me-for-real-auth",
  port: Number(process.env.WORKFLOW_API_PORT ?? 4000),
};
