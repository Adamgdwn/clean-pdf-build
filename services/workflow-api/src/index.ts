import { config } from "./config";
import { buildWorkflowServer } from "./server";

const app = buildWorkflowServer();

app
  .listen({
    port: config.port,
    host: "0.0.0.0",
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
