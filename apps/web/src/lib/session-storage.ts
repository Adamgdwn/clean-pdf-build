import type { Session } from "@supabase/supabase-js";

const SESSION_HANDOFF_KEY = "easydraft_session";
const WORKSPACE_STORAGE_KEY = "easydraft_active_workspace";

/**
 * Reads the session written by the server-side login handler, clears it, and
 * returns it. Called exactly once per sign-in cycle to hydrate the browser
 * Supabase client via auth.setSession(). Returns null if no handoff is present.
 */
export function consumeHandoffSession(): Session | null {
  const raw = window.localStorage.getItem(SESSION_HANDOFF_KEY);
  if (!raw) return null;
  window.localStorage.removeItem(SESSION_HANDOFF_KEY);
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function loadStoredWorkspaceId() {
  return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

export function persistWorkspaceId(workspaceId: string) {
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
}

export function clearStoredWorkspaceId() {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
