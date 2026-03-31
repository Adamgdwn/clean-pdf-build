import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_: VercelRequest, response: VercelResponse) {
  return response.status(200).json({
    ok: true,
    service: "vercel-api",
  });
}
