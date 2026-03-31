import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  createDocumentForAuthorizationHeader,
  listDocumentsForAuthorizationHeader,
} from "../../../packages/workflow-service/src/index.js";

import { readAuthorizationHeader, sendError } from "./_utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method === "GET") {
      return response
        .status(200)
        .json(await listDocumentsForAuthorizationHeader(readAuthorizationHeader(request)));
    }

    if (request.method === "POST") {
      return response
        .status(200)
        .json(
          await createDocumentForAuthorizationHeader(readAuthorizationHeader(request), request.body),
        );
    }

    return response.status(405).json({ message: "Method not allowed." });
  } catch (error) {
    return sendError(response, error);
  }
}
