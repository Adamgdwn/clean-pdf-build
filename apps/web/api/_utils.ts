import type { VercelRequest, VercelResponse } from "@vercel/node";

import { AppError } from "@clean-pdf/workflow-service";

export function readAuthorizationHeader(request: VercelRequest) {
  const authorization = request.headers.authorization;

  if (Array.isArray(authorization)) {
    return authorization[0];
  }

  return authorization;
}

export function getRequestOrigin(request: VercelRequest) {
  const originHeader = request.headers.origin;
  const explicitOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  if (explicitOrigin) {
    return explicitOrigin;
  }

  const protocolHeader = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
  const hostHeader = request.headers["x-forwarded-host"] ?? request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  if (!host) {
    throw new AppError(400, "Unable to determine request origin.");
  }

  return `${protocol ?? "https"}://${host}`;
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
