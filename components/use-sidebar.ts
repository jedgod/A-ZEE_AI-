"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NavGroup } from "@/components/sidebar-nav";

// Browser side of /api/sidebar, /api/projects and /api/chats. "server" mode: the signed-in
// local account's projects and chat titles live in PostgreSQL (messages stay in this browser).
// "local" mode: anyone else (401) or no database; the page keeps its localStorage sidebar.

export type SidebarMode = "loading" | "server" | "local";
export type ProjectDetails = { id: string; name: string; description: string; instructions: string; defaultMode: "chat" | "code" | "research" };
export type SidebarQuery = { project: string | null; allChats: boolean; allProjects: boolean };
type LocalData = { projects: { id: string; name: string }[]; chats: { id: string; title: string; projectId?: string; mode?: string; messages?: unknown[] }[] };
export type ChatSummary = { id: string; title: string; projectId: string | null; pinned: boolean; mode: string; messageCount: number; updatedAt: string };

// v2: the import also uploads messages, so chats open from the account (v1 imported titles only).
const IMPORTED = "az-sidebar-imported-v2";

async function call<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { status: response.status });
  return data.data as T;
}

export function useServerSidebar(query: SidebarQuery, readLocal: () => LocalData, onImported: (projectIds: Record<string, string>) => void) {
  const [mode, setMode] = useState<SidebarMode>("loading");
  const [groups, setGroups] = useState<NavGroup[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const readLocalRef = useRef(readLocal);
  readLocalRef.current = readLocal;
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const params = new URLSearchParams();
  if (query.project) params.set("project", query.project);
  if (query.allChats) params.set("chats", "all");
  if (query.allProjects) params.set("projects", "all");
  const qs = params.toString();

  const refresh = useCallback(async () => {
    try {
      const [nextGroups, nextProjects] = await Promise.all([
        call<NavGroup[]>(`/api/sidebar${qs ? `?${qs}` : ""}`),
        call<{ id: string; name: string }[]>("/api/projects"),
      ]);
      setGroups(nextGroups);
      setProjects(nextProjects);
      setMode("server");
      return true;
    } catch (error) {
      // 401 (not this machine's account) or 503 (no database): the browser-only sidebar.
      setMode(m => (m === "server" && (error as { status?: number }).status === undefined ? m : "local"));
      return false;
    }
  }, [qs]);

  // First load: fetch, then import what this browser already had (once), then refetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await refresh()) || cancelled) return;
      let done = false;
      try { done = localStorage.getItem(IMPORTED) === "1"; } catch {}
      if (done) return;
      const local = readLocalRef.current();
      if (local.projects.length || local.chats.length) {
        try {
          const result = await call<{ projectIds: Record<string, string> }>("/api/sidebar/import", "POST", local);
          onImportedRef.current(result.projectIds);
        } catch { return; }   // retry next load
      }
      try { localStorage.setItem(IMPORTED, "1"); } catch {}
      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Query changes (project filter, see all) refetch once the server mode is known.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (mode === "server") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const server = mode === "server";
  const mutate = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (!server) return undefined;
    try { return await work(); }
    finally { refresh(); }
  }, [server, refresh]);

  return {
    mode, groups, projects, refresh,
    createProject: (name: string, id?: string) => mutate(() => call<{ id: string; name: string }>("/api/projects", "POST", { name, ...(id ? { id } : {}) })),
    renameProject: (id: string, name: string) => mutate(() => call(`/api/projects/${id}`, "PATCH", { name })),
    /** Edit and Settings: name, description, instructions, default mode. */
    getProject: (id: string) => call<ProjectDetails>(`/api/projects/${id}`),
    updateProject: (id: string, patch: Partial<Omit<ProjectDetails, "id">>) => mutate(() => call<ProjectDetails>(`/api/projects/${id}`, "PATCH", patch)),
    deleteProject: (id: string) => mutate(() => call(`/api/projects/${id}`, "DELETE")),
    saveChat: (id: string, chat: { title: string; projectId?: string; mode: string; messages?: unknown[] }) => mutate(() => call(`/api/chats/${id}`, "PUT", chat)),
    /** A saved chat with its messages (GET /api/chats/:id). */
    getChat: (id: string) => call<ChatSummary & { messages: unknown[] }>(`/api/chats/${encodeURIComponent(id)}`),
    /** All chats, or one project's (GET /api/chats?projectId=). */
    listChats: (projectId?: string) => call<ChatSummary[]>(`/api/chats${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
    updateChat: (id: string, patch: { title?: string; pinned?: boolean; projectId?: string }) => mutate(() => call(`/api/chats/${id}`, "PATCH", patch)),
    deleteChat: (id: string) => mutate(() => call(`/api/chats/${id}`, "DELETE")),
  };
}
