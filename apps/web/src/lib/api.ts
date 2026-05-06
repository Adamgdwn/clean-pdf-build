import type { Session } from "@supabase/supabase-js";

import { loadStoredWorkspaceId } from "./session-storage";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

export async function apiFetch<T>(
  path: string,
  session: Session | null,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    const activeWorkspaceId =
      typeof window !== "undefined" ? loadStoredWorkspaceId() : null;
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(activeWorkspaceId ? { "X-EasyDraft-Workspace": activeWorkspaceId } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new Error(`Network error calling ${path}: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = payload?.message ?? "Request failed";
    throw new Error(`${message} (${response.status} ${path})`);
  }

  return (await response.json()) as T;
}
