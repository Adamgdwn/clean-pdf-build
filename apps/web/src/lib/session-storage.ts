import type { Session } from "@supabase/supabase-js";

const SESSION_STORAGE_KEY = "easydraft_session";
const WORKSPACE_STORAGE_KEY = "easydraft_active_workspace";

export function loadStoredSession() {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Session;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function persistSession(session: Session) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
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
