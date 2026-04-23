import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  return response.status(503).json({
    message: "Blockchain signatures are not available yet in this build.",
  });
}
