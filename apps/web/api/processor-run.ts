import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  captureServerException,
  processDueDocumentPurges,
  processQueuedJobs,
  processQueuedNotifications,
  readServerEnv,
  shouldRequireProcessorSecret,
} from "../../../packages/workflow-service/src/index.js";

function isAuthorized(request: VercelRequest): boolean {
  const env = readServerEnv();
  const configuredSecret = env.EASYDRAFT_PROCESSOR_SECRET?.trim();

  // In environments where the secret is not required, allow the call.
  if (!configuredSecret) {
    if (shouldRequireProcessorSecret(env)) {
      return false;
    }
    return true;
  }

  const headerSecret = request.headers["x-processor-secret"];
  const sharedSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  if (sharedSecret === configuredSecret) return true;

  const authHeader = request.headers.authorization;
  const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : undefined;
  return token === configuredSecret;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  if (!isAuthorized(request)) {
    return response.status(401).json({ message: "Missing or invalid processor secret." });
  }

  const results = {
    notifications: { delivered: 0, error: null as string | null },
    jobs: { processed: 0, error: null as string | null },
    purges: { purged: 0, error: null as string | null },
  };

  // Run each job type independently so a failure in one does not prevent the others.
  try {
    const outcome = await processQueuedNotifications();
    results.notifications.delivered = outcome.deliveredNotifications.length;
  } catch (error) {
    results.notifications.error = (error as Error).message;
    captureServerException(error, { scope: "processor-run", task: "notifications" });
  }

  try {
    const outcome = await processQueuedJobs();
    results.jobs.processed = outcome.processedJobs.length;
  } catch (error) {
    results.jobs.error = (error as Error).message;
    captureServerException(error, { scope: "processor-run", task: "jobs" });
  }

  try {
    const outcome = await processDueDocumentPurges();
    results.purges.purged = outcome.purgedDocumentIds.length;
  } catch (error) {
    results.purges.error = (error as Error).message;
    captureServerException(error, { scope: "processor-run", task: "purges" });
  }

  const hasErrors = Object.values(results).some((r) => r.error !== null);

  return response.status(hasErrors ? 207 : 200).json({
    ok: !hasErrors,
    results,
  });
}
