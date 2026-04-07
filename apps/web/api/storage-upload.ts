import type { VercelRequest, VercelResponse } from "@vercel/node";

import { readServerEnv } from "../../../packages/workflow-service/src/env.js";
import { AppError, resolveAuthenticatedUser } from "../../../packages/workflow-service/src/index.js";
import { createServiceRoleClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, readAuthorizationHeader, readRawBody, sendError } from "./_utils.js";

function readSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    enforceRateLimit(request, response, {
      key: "api:storage-upload",
      limit: 20,
      windowMs: 60_000,
    });

    const authHeader = readAuthorizationHeader(request);
    const user = await resolveAuthenticatedUser(authHeader);
    const env = readServerEnv();
    const bucket = readSingleQueryValue(request.query.bucket);
    const path = readSingleQueryValue(request.query.path);
    const contentType = request.headers["content-type"];
    const normalizedContentType = Array.isArray(contentType) ? contentType[0] : contentType;

    if (!bucket || !path) {
      return response.status(400).json({ message: "Missing upload bucket or path." });
    }

    const allowedBuckets = new Set([env.SUPABASE_DOCUMENT_BUCKET, env.SUPABASE_SIGNATURE_BUCKET]);
    if (!allowedBuckets.has(bucket)) {
      throw new AppError(400, "That upload bucket is not allowed.");
    }

    if (!path.startsWith(`${user.id}/`)) {
      throw new AppError(403, "Uploads must stay inside the current user's workspace path.");
    }

    const body = await readRawBody(request);
    if (!body.length) {
      return response.status(400).json({ message: "Upload body was empty." });
    }

    const storage = createServiceRoleClient().storage.from(bucket);
    const { error } = await storage.upload(path, body, {
      contentType: normalizedContentType || "application/octet-stream",
      upsert: false,
    });

    if (error) {
      throw new AppError(500, error.message);
    }

    return response.status(200).json({ uploaded: true, bucket, path });
  } catch (error) {
    return sendError(response, error);
  }
}
