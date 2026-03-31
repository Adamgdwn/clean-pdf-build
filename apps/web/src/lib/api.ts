import type { Session } from "@supabase/supabase-js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_WORKFLOW_API_URL ?? "/api";

export async function apiFetch<T>(
  path: string,
  session: Session | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Request failed");
  }

  return (await response.json()) as T;
}
