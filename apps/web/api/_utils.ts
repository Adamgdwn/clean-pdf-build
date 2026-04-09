import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  AppError,
  consumeRateLimit,
  getCanonicalAppOrigin,
  type RateLimitPolicy,
} from "../../../packages/workflow-service/src/index.js";

export function readAuthorizationHeader(request: VercelRequest) {
  const authorization = request.headers.authorization;

  if (Array.isArray(authorization)) {
    return authorization[0];
  }

  return authorization;
}

export function readWorkspaceIdHeader(request: VercelRequest) {
  const workspaceId = request.headers["x-easydraft-workspace"];

  if (Array.isArray(workspaceId)) {
    return workspaceId[0] ?? null;
  }

  return typeof workspaceId === "string" && workspaceId.trim().length > 0 ? workspaceId.trim() : null;
}

export function getRequestOrigin(_: VercelRequest) {
  return getCanonicalAppOrigin();
}

export async function readRawBody(request: VercelRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function sendError(response: VercelResponse, error: unknown) {
  const typedError = error as AppError;

  return response.status(typedError.statusCode ?? 500).json({
    message: typedError.message ?? "Unexpected error",
  });
}

function setRateLimitHeaders(response: VercelResponse, limit: number, remaining: number, resetAt: number) {
  response.setHeader("X-RateLimit-Limit", String(limit));
  response.setHeader("X-RateLimit-Remaining", String(remaining));
  response.setHeader("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));
}

function getClientIdentifier(request: VercelRequest) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIp = headerValue?.split(",")[0]?.trim();

  return forwardedIp || request.socket.remoteAddress || "unknown";
}

export function enforceRateLimit(
  request: VercelRequest,
  response: VercelResponse,
  policy: RateLimitPolicy,
) {
  const result = consumeRateLimit(getClientIdentifier(request), policy);
  setRateLimitHeaders(response, result.limit, result.remaining, result.resetAt);

  if (!result.allowed) {
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    throw new AppError(429, "Too many requests. Please wait a moment and try again.");
  }
}
