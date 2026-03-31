const port = Number(process.env.PROCESSOR_PORT ?? 4010);

import { buildDocumentProcessorServer } from "./server";

const app = buildDocumentProcessorServer();

app
  .listen({
    port,
    host: "0.0.0.0",
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
