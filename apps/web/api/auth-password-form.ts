import type { Session } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createAuthClient } from "../../../packages/workflow-service/src/supabase.js";

import { enforceRateLimit, sendError } from "./_utils.js";

function escapeForScript(value: string) {
  return JSON.stringify(value);
}

function renderRedirectPage(response: VercelResponse, session: Session) {
  const serializedSession = JSON.stringify(session).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Signing you in…</title>
  </head>
  <body>
    <p>Signing you in…</p>
    <script>
      try {
        localStorage.setItem("easydraft_session", ${escapeForScript(serializedSession)});
      } catch (error) {
        console.error(error);
      }
      window.location.replace("/?signedIn=1");
    </script>
  </body>
</html>`;

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  return response.status(200).send(html);
}

function renderErrorRedirect(response: VercelResponse, message: string) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sign-in error</title>
  </head>
  <body>
    <script>
      window.location.replace("/?authError=" + encodeURIComponent(${escapeForScript(message)}));
    </script>
  </body>
</html>`;

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  return response.status(200).send(html);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    await enforceRateLimit(request, response, {
      key: "api:auth-password-form",
      limit: 10,
      windowMs: 10 * 60_000,
    });

    const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";

    if (!email || !password) {
      return renderErrorRedirect(response, "Email and password are required.");
    }

    const authClient = createAuthClient();
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return renderErrorRedirect(response, error?.message ?? "Unable to sign in.");
    }

    return renderRedirectPage(response, data.session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in.";
    return renderErrorRedirect(response, message);
  }
}
