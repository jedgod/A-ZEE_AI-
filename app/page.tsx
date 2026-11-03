"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowUp, BarChart3, ChevronDown, FolderPlus, MessageSquarePlus, Clock, Code, File, FileText, Image as ImageIcon, Menu, Moon,
  PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles, Square, Sun, X,
} from "lucide-react";
import styles from "./workspace.module.css";
import { AnswerFeedback } from "@/components/answer-feedback";
import { SidebarUserMenu } from "@/components/sidebar-user-menu";
import { SidebarNav, type ItemAction, type NavGroup, type NavItem } from "@/components/sidebar-nav";
import { SidebarDialog, type SidebarDialogState } from "@/components/sidebar-dialog";
import { useServerSidebar } from "@/components/use-sidebar";
import { useAccess } from "@/components/use-access";
import { MessageContent } from "@/components/message-content";
import { DevCanvas } from "@/components/dev-canvas";
import { MoreMenu } from "@/components/more-menu";
import { ShareMenu } from "@/components/share-menu";
import { ANSWER_STYLES, MAX_MESSAGE_CHARACTERS, type AnswerStyle } from "@/lib/chat/contracts";
import { readChatResponse } from "@/lib/chat/sse";
import type { CanvasItem } from "@/lib/code-blocks";
import { addProject, DEFAULT_PROJECT, MAX_PROJECT_NAME, parseProjects, projectOf, type Project } from "@/lib/projects";
import { decodeProjectShare, decodeShare, encodeProjectShare, MAX_SHARED_CHATS, PROJECT_SHARE_PREFIX, ShareTooLargeError, type SharedProject, type SharedProjectBundle } from "@/lib/share";

type Mode = "chat" | "code" | "research";
type Model = "auto" | "reasoning" | "code";
// requestId links an answer to its server-side records so it can be rated (13_FEEDBACK).
// plan (08 reasoning) and notes (warnings, e.g. 10 evidence checks) are shown with the answer,
// as are sources (11 citations: retrieved sources the answer cites).
type Source = { id: string; title: string; url: string | null };
type Message = { role: "user" | "assistant"; content: string; display?: string; requestId?: string; plan?: string[]; notes?: string[]; sources?: Source[] };
const isSource = (s: unknown): s is Source => !!s && typeof (s as Source).id === "string" && typeof (s as Source).title === "string" &&
  ((s as Source).url === null || (typeof (s as Source).url === "string" && /^https?:\/\//i.test((s as Source).url!)));
// 12 streaming: what the pipeline is doing right now, shown under the composer.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_LABELS: Record<string, string> = {
  preprocess: "Reading your message…", search: "Searching your sources…", tools: "Deciding on tools…",
  plan: "Planning the answer…", generate: "Writing the answer…", validate: "Checking the answer…", deliver: "Finishing…",
};
const TOOL_LABELS: Record<string, string> = { calculator: "the calculator", search: "search" };
const STYLE_LABELS: Record<AnswerStyle, string> = { default: "Tone · Default", concise: "Concise", professional: "Professional", friendly: "Friendly", technical: "Technical" };
type HistoryItem = { id: string; title: string; mode: Mode; messages: Message[]; projectId?: string };
type SavedPrompt = { id: string; title: string; mode: Mode; prompt: string };
type Attachment = { name: string; content: string };

const DESCRIPTIONS: Record<Mode, { label: string; placeholder: string }> = {
  chat: { label: "Conversation", placeholder: "Ask anything, or bring your next big idea…" },
  code: { label: "Code workspace", placeholder: "Describe what you’re building, or paste code to explore…" },
  research: { label: "Research", placeholder: "What would you like to understand, compare, or investigate?" },
};

const SUGGESTIONS = [
  {
    mode: "chat" as Mode,
    title: "Make the complex clearer",
    subtitle: "Learn something new",
    prompt: "Help me understand a complex topic. Ask what I want to learn and explain it with a clear example.",
  },
  {
    mode: "code" as Mode,
    title: "Turn an idea into working code",
    subtitle: "Build together",
    prompt: "Help me build a web application. Ask what I want to create, then outline a clean architecture and next steps.",
  },
  {
    mode: "research" as Mode,
    title: "Follow a question deeper",
    subtitle: "Go further",
    prompt: "Help me investigate a decision. Ask what I'm comparing, separate evidence from assumptions, and suggest what to verify.",
  },
];

// Short starters for the "Start here" strip (the first three are also in the workspace menu).
const STARTERS = [
  ...SUGGESTIONS,
  { mode: "chat" as Mode, title: "Summarize a document", subtitle: "", prompt: "Summarize the document I'll paste next in five bullet points, then list open questions." },
  { mode: "code" as Mode, title: "Review my code", subtitle: "", prompt: "Review the code I'll paste next for bugs, security issues and readability. Suggest concrete fixes." },
  { mode: "research" as Mode, title: "Compare two options", subtitle: "", prompt: "Help me compare two options. Ask what they are, then build a table of trade-offs with evidence." },
  { mode: "chat" as Mode, title: "Draft an email", subtitle: "", prompt: "Help me draft a clear, polite email. Ask who it's for and what I need, then write it." },
  { mode: "code" as Mode, title: "Explain an error", subtitle: "", prompt: "Explain the error message I'll paste next, its likely cause, and how to fix it." },
];

export default function WorkspacePage() {
  const [mode, setMode] = useState<Mode>("chat");
  const [model, setModel] = useState<Model>("auto");
  const [style, setStyle] = useState<AnswerStyle>("default");
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<Attachment | null>(null);
  const [uploads, setUploads] = useState<Attachment[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const historyRef = useRef<HTMLDivElement>(null);
  const [expandedProjects, setExpandedProjects] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { const v = JSON.parse(localStorage.getItem("az-expanded-projects") || "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : []; }
    catch { return []; }
  });
  const toggleProject = useCallback((id: string, open?: boolean) => setExpandedProjects(list => {
    const next = (open ?? !list.includes(id)) ? [...new Set([...list, id])] : list.filter(x => x !== id);
    try { localStorage.setItem("az-expanded-projects", JSON.stringify(next)); } catch {}
    return next;
  }), []);
  // "+" on a project starts a chat that is saved into that project.
  const [newChatProject, setNewChatProject] = useState<string | null>(null);
  // A project's "Show all" list (all its chats), keyed by project id.
  const [projectChats, setProjectChats] = useState<Record<string, NavItem[]>>({});
  const [allProjects, setAllProjects] = useState(false);
  const [seeAllChats, setSeeAllChats] = useState(false);
  const [sidebarDialog, setSidebarDialog] = useState<SidebarDialogState>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const stopRef = useRef<AbortController | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>(() => parseProjects([]));
  const [canvasItem, setCanvasItem] = useState<CanvasItem | null>(null);
  const closeCanvas = useCallback(() => { setCanvasOpen(false); setCanvasItem(null); }, []);
  const [toast, setToast] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Server-backed sidebar (/api/sidebar): this account's projects and chat titles in PostgreSQL;
  // messages stay in this browser. Falls back to the browser-only sidebar when not available.
  const sidebar = useServerSidebar(
    { project: null, allChats: seeAllChats, allProjects },
    () => {
      // Read storage directly: the one-time import runs before state may have settled.
      const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
      const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
      const projectsRaw: unknown[] = Array.isArray(read("az-projects")) ? read("az-projects") : [];
      const chatsRaw: unknown[] = Array.isArray(read("az-user-conversations")) ? read("az-user-conversations") : [];
      return {
        projects: projectsRaw.flatMap(x => { const v = x as Project; return v && uuid(v.id) && typeof v.name === "string" ? [{ id: v.id, name: v.name }] : []; }).slice(0, 20),
        chats: chatsRaw.flatMap(x => {
          const v = x as HistoryItem;
          return v && uuid(v.id) && typeof v.title === "string" && v.title.trim()
            ? [{ id: v.id, title: v.title.slice(0, 120), mode: v.mode, ...(uuid(v.projectId) ? { projectId: v.projectId } : {}),
                ...(Array.isArray(v.messages) && v.messages.length ? { messages: v.messages.slice(0, 200) } : {}) }] : [];
        }).slice(0, 100),
      };
    },
    ids => remapProjects(ids),
  );
  const sidebarRef = useRef(sidebar);
  sidebarRef.current = sidebar;
  const serverSidebar = sidebar.mode === "server";
  useEffect(() => {
    if (sidebar.mode === "server") setProjects(parseProjects(sidebar.projects));
  }, [sidebar.mode, sidebar.projects]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("az-user-conversations") || "[]");
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is HistoryItem =>
        item && typeof item.id === "string" && typeof item.title === "string" &&
        ["chat", "code", "research"].includes(item.mode) && Array.isArray(item.messages) &&
        item.messages.every((message: Message) => message &&
          ["user", "assistant"].includes(message.role) && typeof message.content === "string" &&
          (message.display === undefined || typeof message.display === "string") &&
          (message.requestId === undefined || typeof message.requestId === "string") &&
          (message.plan === undefined || (Array.isArray(message.plan) && message.plan.every((p: unknown) => typeof p === "string"))) &&
          (message.notes === undefined || (Array.isArray(message.notes) && message.notes.every((p: unknown) => typeof p === "string"))) &&
          (message.sources === undefined || (Array.isArray(message.sources) && message.sources.every(isSource)))) &&
        (item.projectId === undefined || typeof item.projectId === "string")
      ).slice(0, 30));
    } catch {}
    try { setProjects(parseProjects(JSON.parse(localStorage.getItem("az-projects") || "[]"))); } catch {}
    try {
      const open = JSON.parse(localStorage.getItem("az-expanded-projects") || "[]");
      if (Array.isArray(open)) setExpandedProjects(list => [...new Set([...open.filter((x): x is string => typeof x === "string").slice(0, 50), ...list])]);
    } catch {}
    try {
      const stored = JSON.parse(localStorage.getItem("az-prompts") || "[]");
      if (Array.isArray(stored)) setSavedPrompts(stored.filter((item): item is SavedPrompt =>
        item && typeof item.id === "string" && typeof item.title === "string" &&
        typeof item.prompt === "string" && ["chat", "code", "research"].includes(item.mode)
      ).slice(0, 20));
      setCollapsed(localStorage.getItem("az-sidebar-collapsed") === "true");
      const savedStyle = localStorage.getItem("az-style");
      if (ANSWER_STYLES.includes(savedStyle as AnswerStyle)) setStyle(savedStyle as AnswerStyle);
    } catch {}
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("az-theme") || localStorage.getItem("azee-theme"); } catch {}
    setTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : (prefersDark ? "dark" : "light"));
    setPreferencesLoaded(true);

    // "Open in new tab" from the sidebar: /?chat=<id> or /?project=<id>.
    const params = new URLSearchParams(window.location.search);
    const openChat = params.get("chat"), openProject = params.get("project");
    if (openChat || openProject) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      if (openProject) toggleProject(openProject, true);
      if (openChat) {
        try {
          const found = (JSON.parse(localStorage.getItem("az-user-conversations") || "[]") as HistoryItem[]).find(h => h?.id === openChat);
          if (found && Array.isArray(found.messages)) {
            setMessages(found.messages); setCurrentId(found.id); setMode(found.mode); setModel(found.mode === "code" ? "code" : "auto");
          } else {
            fetch(`/api/chats/${encodeURIComponent(openChat)}`, { cache: "no-store" })
              .then(r => (r.ok ? r.json() : null))
              .then(d => {
                const chat = d?.data;
                if (!chat?.messages?.length) { setStatus("This chat's messages haven't reached your account yet. Open AZ_AI in the browser where you had this chat; it uploads them automatically."); return; }
                const item: HistoryItem = { id: chat.id, title: chat.title, mode: chat.mode, messages: chat.messages, ...(chat.projectId ? { projectId: chat.projectId } : {}) };
                setHistory(prev => [item, ...prev.filter(h => h.id !== item.id)].slice(0, 30));
                setMessages(item.messages); setCurrentId(item.id); setMode(item.mode); setModel(item.mode === "code" ? "code" : "auto");
                setStatus("Loaded from your account.");
              })
              .catch(() => setStatus("Couldn't load this chat."));
          }
        } catch {}
      }
    }
    if (window.location.hash.startsWith(PROJECT_SHARE_PREFIX)) {
      const hash = window.location.hash;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      decodeProjectShare(hash).then(bundle => {
        if (bundle) importSharedProject(bundle);
        else setStatus("This project link is damaged or incomplete.");
      });
    }
    decodeShare(window.location.hash).then(shared => {
      if (!shared) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setMessages(shared.messages);
      setCurrentId(null);
      setMode(shared.mode);
      setModel(shared.mode === "code" ? "code" : "auto");
      if (shared.prompts.length) setSavedPrompts(current => {
        const known = new Set(current.map(p => p.prompt));
        const next = [...current, ...shared.prompts.filter(p => !known.has(p.prompt)).map(p => ({ ...p, id: crypto.randomUUID() }))].slice(0, 20);
        try { localStorage.setItem("az-prompts", JSON.stringify(next)); } catch {}
        return next;
      });
      if (shared.uploads?.length) setUploads(shared.uploads);
      setStatus(`Opened shared project “${shared.title}”. Send a message to continue it as your own copy.`);
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (preferencesLoaded) {
      try { localStorage.setItem("az-theme", theme); } catch {}
    }
  }, [theme, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      try { localStorage.setItem("az-sidebar-collapsed", String(collapsed)); } catch {}
    }
  }, [collapsed, preferencesLoaded]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Workspace menu header: whose workspace this is (this machine's signed-in account, if any).
  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setAccountName(typeof d?.data?.account?.name === "string" ? d.data.account.name : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!menuOpen) { openedByHover.current = false; return; }
    const close = (e: MouseEvent) => {
      const inside = e.composedPath().some(node => node === menuRef.current ||
        (node instanceof Element && node.getAttribute("aria-controls") === "workspace-menu"));
      if (!inside) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuRef.current?.contains(document.activeElement)) switcherButtonRef.current?.focus();
      setMenuOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  useEffect(() => {
    if (threadRef.current && messages.length) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  // Plan entitlements (subscription access rules) for UI hints; the server enforces them.
  const { can, access, refresh: refreshAccess } = useAccess();
  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const persistHistory = useCallback((next: HistoryItem[]) => {
    setHistory(next);
    try { localStorage.setItem("az-user-conversations", JSON.stringify(next)); } catch { notify("Storage unavailable"); }
  }, [notify]);

  /** Local project ids the server resolved to a different (existing, same-name) project. */
  const remapProjects = useCallback((ids: Record<string, string>) => {
    const changed = Object.entries(ids).filter(([from, to]) => from !== to);
    if (!changed.length) return;
    const map = new Map(changed);
    setHistory(prev => {
      const next = prev.map(h => (h.projectId && map.has(h.projectId) ? { ...h, projectId: map.get(h.projectId) } : h));
      try { localStorage.setItem("az-user-conversations", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const saveHistory = useCallback((nextMessages: Message[], nextMode: Mode, id: string | null, projectId?: string) => {
    if (!nextMessages.length) return;
    const cid = id || crypto.randomUUID();
    const title = (nextMessages[0].display || nextMessages[0].content || "Untitled").slice(0, 70);
    const existing = history.find(h => h.id === cid)?.projectId;
    const target = projectId ?? existing ?? (id ? undefined : newChatProject ?? undefined);
    const item: HistoryItem = { id: cid, title, mode: nextMode, messages: nextMessages, ...(target ? { projectId: target } : {}) };
    persistHistory([item, ...history.filter(h => h.id !== cid)].slice(0, 30));
    setCurrentId(cid);
    // Account copy (server sidebar): title, project, mode and messages.
    sidebarRef.current.saveChat(cid, { title, projectId: item.projectId || DEFAULT_PROJECT.id, mode: nextMode, messages: nextMessages }).catch(() => {});
  }, [history, persistHistory, newChatProject]);

  const currentItem = history.find(h => h.id === currentId);
  const currentProject = currentItem ? projectOf(currentItem, projects)
    : projects.find(p => p.id === newChatProject) ?? projectOf(undefined, projects);
  const chatTitle = messages.length ? (currentItem?.title || (messages[0].display || messages[0].content).slice(0, 70)) : null;

  const moveChat = (projectId: string) => {
    const target = projects.find(p => p.id === projectId);
    if (!target || !messages.length) return;
    if (currentItem) {
      persistHistory(history.map(h => h.id === currentItem.id ? { ...h, projectId } : h));
      sidebar.updateChat(currentItem.id, { projectId }).catch(() => notify("Couldn't update the chat on your account"));
    } else saveHistory(messages, mode, null, projectId);
    notify(`Moved to ${target.name}`);
  };

  const createProjectAndMove = (name: string): string | null => {
    const result = addProject(projects, name, crypto.randomUUID());
    if ("error" in result) return result.error;
    setProjects(result.projects);
    try { localStorage.setItem("az-projects", JSON.stringify(result.projects.slice(1))); } catch { notify("Storage unavailable"); }
    const { project } = result;
    const move = () => {
      if (currentItem) {
        persistHistory(history.map(h => h.id === currentItem.id ? { ...h, projectId: project.id } : h));
        sidebar.updateChat(currentItem.id, { projectId: project.id }).catch(() => {});
      } else saveHistory(messages, mode, null, project.id);
    };
    if (serverSidebar && project.id !== DEFAULT_PROJECT.id) {
      // Create on the account first (same id), so the chat can reference it.
      sidebar.createProject(project.name, project.id)
        .then(created => { if (created && created.id !== project.id) remapProjects({ [project.id]: created.id }); move(); })
        .catch(() => notify("Couldn't save the project to your account"));
    } else move();
    notify(`Moved to ${project.name}`);
    return null;
  };

  const deleteChat = () => {
    if (busy) return;
    if (currentItem) {
      persistHistory(history.filter(h => h.id !== currentItem.id));
      sidebar.deleteChat(currentItem.id).catch(() => {});
    }
    setMessages([]);
    setCurrentId(null);
    setFile(null);
    setInput("");
    setStatus("");
    notify("Chat deleted");
  };

  const setModeAndModel = (next: Mode) => {
    if (busy) return;
    setMode(next);
    setModel(next === "code" ? "code" : "auto");
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const content = text + (file ? `\n\nAttached file: ${file.name}\n${file.content}` : "");
    if (content.length > MAX_MESSAGE_CHARACTERS) {
      setStatus(`Message and attachment must total ${MAX_MESSAGE_CHARACTERS.toLocaleString()} characters or fewer.`);
      return;
    }
    const submittedFile = file;
    setBusy(true);
    setStatus("thinking");
    const userMsg: Message = { role: "user", content, display: text + (file ? `\n[Attached: ${file.name}]` : "") };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setFile(null);

    try {
      const stop = new AbortController();
      stopRef.current = stop;
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          model,
          ...(style !== "default" ? { style } : {}),
          ...(serverSidebar && UUID.test(currentItem?.projectId ?? newChatProject ?? "") ? { projectId: currentItem?.projectId ?? newChatProject } : {}),
          messages: nextMessages.slice(-24).map(({ role, content }) => ({ role, content })),
        }),
        signal: AbortSignal.any([AbortSignal.timeout(90000), stop.signal]),
      });

      // Validated answer text streams in after the checks pass; until then, show the stage.
      let streamed = "";
      const { ok, result } = await readChatResponse(res, e => {
        if (e.event === "status") setStatus(STAGE_LABELS[e.data.stage] ?? "thinking");
        else if (e.event === "tool") {
          const tool = TOOL_LABELS[e.data.name] ?? e.data.name;
          setStatus(e.data.status === "running" ? `Using ${tool}…` : e.data.status === "failed" ? `Couldn't use ${tool}; continuing…` : "Writing the answer…");
        } else {
          streamed += e.data.text;
          setMessages([...nextMessages, { role: "assistant", content: streamed }]);
        }
      });

      if (!ok) {
        const map: Record<string, string> = {
          AI_PROVIDER_NOT_CONFIGURED: "Configure your AI provider on the server.",
          AI_PROVIDER_UNAVAILABLE: "AI providers are unavailable. Check the configured provider credentials, model access, and billing, then retry.",
          RATE_LIMITED: "Too many requests. Please wait a minute.",
          INPUT_BLOCKED: "This request was blocked by the safety filter. Rephrase it and try again.",
          OUTPUT_BLOCKED: "The answer was withheld by the safety check. Try rephrasing your request.",
          NOT_PERMITTED: "This feature needs a signed-in account on this server.",
          SESSION_REQUIRED: "Sign in to continue.",
          INVALID_ORIGIN: "Server origin mismatch. Check APP_ORIGIN.",
        };
        if (result.error === "UPGRADE_REQUIRED") {
          const what = result.feature === "attachments" ? "File attachments are" : `${result.feature} is`;
          throw new Error(`${what} included with Plus and above (you're on ${result.plan}). See plans at /pricing.`);
        }
        if (result.error === "PLAN_LIMIT_REACHED") {
          const what = result.feature === "messages" ? "messages" : result.feature === "reasoning" ? "AZ · Reasoning answers" : "research answers";
          throw new Error(`You've used all ${result.limit} ${what} in your ${result.plan} plan this month. Upgrade from the account menu or at /pricing.`);
        }
        throw new Error(map[result.error] || result.error || "Request failed");
      }

      if (typeof result.data?.answer !== "string") throw new Error("Unexpected response format");

      const requestId = typeof result.data.pipeline?.requestId === "string" ? result.data.pipeline.requestId : undefined;
      const pipeline = result.data.pipeline ?? {};
      const plan = Array.isArray(pipeline.plan) ? pipeline.plan.filter((p: unknown): p is string => typeof p === "string") : [];
      const sources: Source[] = Array.isArray(pipeline.sources) ? pipeline.sources.filter(isSource) : [];
      const notes = Array.isArray(pipeline.warnings) ? pipeline.warnings.filter((w: unknown): w is string => typeof w === "string" && !w.startsWith("Moderation service")) : [];
      const withAssistant = [...nextMessages, {
        role: "assistant" as const, content: result.data.answer,
        ...(requestId ? { requestId } : {}), ...(plan.length ? { plan } : {}), ...(notes.length ? { notes } : {}), ...(sources.length ? { sources } : {}),
      }];
      setMessages(withAssistant);
      saveHistory(withAssistant, mode, currentId);
      refreshAccess();
      setStatus("");
      const masked = Object.entries(result.data.pipeline?.redacted ?? {}) as [string, number][];
      if (masked.length) {
        const labels: Record<string, string> = { email: "email", card: "card number", ssn: "SSN", phone: "phone number", ipv4: "IP address" };
        notify(`Masked before sending to the AI: ${masked.map(([k, n]) => `${n} ${labels[k] ?? k}${n > 1 ? "s" : ""}`).join(", ")}`);
      }
    } catch (err: any) {
      setStatus(err.name === "TimeoutError" ? "Request timed out." : err.name === "AbortError" ? "Stopped. Your message is back in the box." : err.message);
      setMessages(messages);
      setInput(text);
      setFile(submittedFile);
    } finally {
      stopRef.current = null;
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const loadConversation = (item: HistoryItem) => {
    if (busy) return;
    setMessages(item.messages);
    setCurrentId(item.id);
    setModeAndModel(item.mode);
    setStatus("Loaded from this browser.");
    setSidebarOpen(false);
  };

  const newChat = () => {
    if (busy) return;
    setNewChatProject(null);
    setMessages([]);
    setCurrentId(null);
    setFile(null);
    setInput("");
    setStatus("");
    textareaRef.current?.focus();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 48000) { notify("File must be under 48 KB"); e.target.value = ""; return; }
    try {
      const content = await f.text();
      if (content.length + f.name.length + 20 >= MAX_MESSAGE_CHARACTERS) {
        notify("Attachment is too long. Use a smaller file and leave room for your message.");
      } else {
        setFile({ name: f.name, content });
        setUploads(list => [{ name: f.name, content }, ...list.filter(u => u.name !== f.name)].slice(0, 8));
      }
    } catch { notify("Could not read file"); }
    e.target.value = "";
  };

  const applyPrompt = (next: { mode: Mode; prompt: string }) => {
    if (busy) return;
    setModeAndModel(next.mode);
    setInput(next.prompt);
    setMenuOpen(false);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  };

  const storePrompts = (next: SavedPrompt[]) => {
    setSavedPrompts(next);
    try { localStorage.setItem("az-prompts", JSON.stringify(next)); return true; } catch { notify("Storage unavailable"); return false; }
  };

  /** Workspace menu → + New prompt: write a reusable prompt (prefilled from the composer). */
  const savePrompt = () => {
    const draft = input.trim();
    setSidebarDialog({
      kind: "form", title: "New prompt", confirm: "Save prompt",
      description: "Saved prompts appear in the Local workspace menu. Pick one to preview it, then use it in the composer.",
      fields: [
        { name: "prompt", label: "Prompt", type: "textarea", initial: draft, maxLength: 4000, placeholder: "e.g. Summarize this document in five bullet points for an executive audience." },
        { name: "title", label: "Title", type: "text", initial: draft.split("\n")[0].slice(0, 48), maxLength: 48, hint: "Shown in the menu. Leave empty to use the prompt's first words." },
        { name: "mode", label: "Mode", type: "select", initial: mode, options: [{ value: "chat", label: "Ask anything" }, { value: "code", label: "Build with code" }, { value: "research", label: "Explore deeply" }] },
      ],
      submit: async v => {
        const prompt = v.prompt.trim();
        if (!prompt) return "Write the prompt first.";
        const title = (v.title.trim() || prompt.split("\n")[0]).slice(0, 48);
        const promptMode = (["chat", "code", "research"].includes(v.mode) ? v.mode : "chat") as Mode;
        const next = [{ id: crypto.randomUUID(), title, mode: promptMode, prompt }, ...savedPrompts.filter(p => p.prompt !== prompt)].slice(0, 20);
        if (storePrompts(next)) notify(`Saved “${title}”`);
        return null;
      },
    });
  };

  /** Workspace settings → export: this browser's chats (with messages) as a JSON file. */
  const exportChats = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), projects: projects.slice(1), chats: history }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `az-ai-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify(`Exported ${history.length} chat${history.length === 1 ? "" : "s"}`);
  };

  const attachUpload = (upload: Attachment) => {
    if (busy) return;
    setFile(upload);
    setMenuOpen(false);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  };

  const getShareProject = useCallback((): SharedProject | null => {
    if (!messages.length) return null;
    const title = (messages[0].display || messages[0].content).split("\n")[0].slice(0, 70) || "Untitled";
    return {
      v: 1, title, mode,
      messages: messages.map(({ role, content, display }) => ({ role, content, ...(display ? { display } : {}) })),
      prompts: savedPrompts.map(({ title, mode, prompt }) => ({ title, mode, prompt })),
      uploads: uploads.map(({ name, content }) => ({ name, content })),
    };
  }, [messages, mode, savedPrompts, uploads]);

  const showRecent = () => {
    setCollapsed(false);
    requestAnimationFrame(() => {
      const chats = historyRef.current?.querySelector<HTMLElement>('[role="group"][aria-label^="Chats"]');
      chats?.scrollIntoView({ block: "nearest" });
      chats?.querySelector<HTMLElement>("button, a")?.focus();
    });
  };

  // Sidebar groups (components/sidebar-nav.tsx). Server mode: /api/sidebar (configurable groups
  // and items, this account's projects and chats). Local mode: the same shape from this browser.
  const PROJECTS_SHOWN = 5;
  const expanded = new Set(expandedProjects);
  const chatsEmpty = "Your conversations appear here.";
  const navGroups: NavGroup[] = serverSidebar
    ? sidebar.groups.map(g => g.id === "projects"
      ? { ...g, hideWhenCollapsed: true, items: g.items.map(p => ({ ...p, expanded: expanded.has(p.id), ...(projectChats[p.id] ? { children: projectChats[p.id], childCount: projectChats[p.id].length } : {}) })) }
      : g.id === "chats" ? { ...g, emptyText: chatsEmpty, hideWhenCollapsed: true, acceptsChats: true }
      : g.id === "main" ? { ...g, placement: "top" as const }
      : g.id === "plugins" ? { ...g, placement: "bottom" as const }
      : g)
    : [
      {
        id: "main", placement: "top",
        items: [
          { id: "chat", label: "Chat", icon: "chat" },
          { id: "azee-search", label: "A-Zee Search", icon: "globe", href: "/search" },
          { id: "research", label: "Research", icon: "search" },
          { id: "code", label: "Code workspace", icon: "code", badge: "DEV" },
          { id: "library", label: "Library", icon: "library" },
        ],
      },
      {
        // Browser-only mode: the same tree from this browser's projects and chats.
        id: "projects", label: "Projects", collapsible: true, hideWhenCollapsed: true, actions: ["add"],
        showMore: !allProjects && projects.length - 1 > PROJECTS_SHOWN,
        items: (allProjects ? projects.slice(1) : projects.slice(1, PROJECTS_SHOWN + 1)).map(p => ({
          id: p.id, label: p.name, type: "project" as const, actions: ["new-chat" as const, "new-tab" as const], expanded: expanded.has(p.id),
          children: history.filter(h => h.projectId === p.id).map(h => ({ id: h.id, label: h.title, type: "chat" as const, actions: ["new-tab" as const, "rename" as const, "delete" as const] })),
        })),
      },
      {
        id: "chats", label: "Chats", collapsible: true, hideWhenCollapsed: true, emptyText: chatsEmpty, acceptsChats: true,
        items: history.filter(item => projectOf(item, projects).id === DEFAULT_PROJECT.id)
          .map(item => ({ id: item.id, label: item.title, icon: "message", type: "chat" as const, actions: ["new-tab" as const, "rename" as const, "delete" as const] })),
      },
      { id: "plugins", placement: "bottom", items: [{ id: "plugins", label: "Plugins", icon: "blocks", href: "/extensions" }] },
    ];
  const navActive = currentId ?? mode;

  /** Open a saved chat in the main view: this browser's copy, or the account's (GET /api/chats/:id). */
  const openSavedChat = async (id: string) => {
    if (busy) return;
    const local = history.find(h => h.id === id);
    if (local) { loadConversation(local); setSidebarOpen(false); }
    if (!serverSidebar) { if (!local) notify("This chat isn't in this browser."); return; }
    try {
      const chat = await sidebar.getChat(id);
      if (!chat.messages.length) { if (!local) notify("This chat's messages haven't reached your account yet. Open AZ_AI in the browser where you had this chat; it uploads them automatically."); return; }
      if (local && local.messages.length >= chat.messages.length) return;   // this browser is up to date
      const item: HistoryItem = { id: chat.id, title: chat.title, mode: chat.mode as Mode, messages: chat.messages as Message[], ...(chat.projectId ? { projectId: chat.projectId } : {}) };
      persistHistory([item, ...history.filter(h => h.id !== item.id)].slice(0, 30));
      loadConversation(item);
      setStatus("Loaded from your account.");
      setSidebarOpen(false);
    } catch {
      if (!local) notify("Couldn't open this chat.");
    }
  };

  /** A project's "Show all": all its chats (GET /api/chats?projectId=). */
  const loadProjectChats = useCallback(async (projectId: string) => {
    try {
      const list = await sidebarRef.current.listChats(projectId);
      setProjectChats(prev => ({ ...prev, [projectId]: list.map(c => ({ id: c.id, label: c.title, type: "chat" as const, pinned: c.pinned, actions: ["new-tab", "rename", "pin", "delete"] as ItemAction[] })) }));
    } catch { notify("Couldn't load the project's chats."); }
  }, [notify]);
  // Keep expanded "all chats" lists current after any sidebar change.
  useEffect(() => {
    for (const projectId of Object.keys(projectChats)) loadProjectChats(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebar.groups]);
  const selectNav = (id: string, type?: NavItem["type"]) => {
    if (type === "project") { toggleProject(id); return; }
    if (type === "chat") { openSavedChat(id); return; }
    // Chat starts a fresh conversation (it replaced the separate "New conversation" button).
    if (id === "chat") { if (busy) return; newChat(); setModeAndModel("chat"); setSidebarOpen(false); }
    else if (id === "research" || id === "code") { setModeAndModel(id); setSidebarOpen(false); }
    else if (id === "library") setMenuOpen(true);
    else notify("This item isn't available yet.");
  };

  const PROJECT_ERRORS: Record<string, string> = {
    PROJECT_EXISTS: "A project with that name already exists.",
    PROJECT_LIMIT: "You can have up to 19 projects besides General.",
    INVALID_INPUT: `Use 1–${MAX_PROJECT_NAME} characters.`,
  };
  const failure = (e: unknown, fallback: string) => PROJECT_ERRORS[(e as Error).message] ?? fallback;

  const addProjectDialog = () => setSidebarDialog({
    kind: "name", title: "New project", label: "Project name", initial: "", maxLength: MAX_PROJECT_NAME, confirm: "Create",
    submit: async name => {
      if (!serverSidebar) {
        const result = addProject(projects, name, crypto.randomUUID());
        if ("error" in result) return result.error;
        setProjects(result.projects);
        try { localStorage.setItem("az-projects", JSON.stringify(result.projects.slice(1))); } catch {}
        notify(`Created ${result.project.name}`);
        return null;
      }
      try { const created = await sidebar.createProject(name); notify(`Created ${created?.name ?? name}`); return null; }
      catch (e) { return failure(e, "Couldn't create the project."); }
    },
  });

  const MODE_OPTIONS = [{ value: "chat", label: "Chat" }, { value: "code", label: "Code workspace" }, { value: "research", label: "Research (Explore deeply)" }];

  /** Edit (name, description) and Settings (instructions, default mode), saved to the account. */
  const projectForm = async (item: NavItem, which: "edit" | "settings") => {
    let project;
    try { project = await sidebar.getProject(item.id); }
    catch { notify("Couldn't load the project."); return; }
    if (which === "edit") setSidebarDialog({
      kind: "form", title: "Edit project", confirm: "Save",
      fields: [
        { name: "name", label: "Name", type: "text", initial: project.name, maxLength: MAX_PROJECT_NAME },
        { name: "description", label: "Description", type: "textarea", initial: project.description, maxLength: 500, placeholder: "What this project is for", hint: "Shown when you point at the project." },
      ],
      submit: async v => {
        try { await sidebar.updateProject(item.id, { name: v.name, description: v.description }); notify("Project updated"); return null; }
        catch (e) { return failure(e, "Couldn't save the project."); }
      },
    });
    else setSidebarDialog({
      kind: "form", title: `${project.name} settings`, confirm: "Save settings",
      description: "These apply to every chat in this project.",
      fields: [
        { name: "instructions", label: "Instructions", type: "textarea", initial: project.instructions, maxLength: 4000,
          placeholder: "e.g. You're helping with my thesis on SCADA security. Cite sources and use British English.",
          hint: "Sent to the AI with each message in this project." },
        { name: "defaultMode", label: "New chats start in", type: "select", initial: project.defaultMode, options: MODE_OPTIONS, hint: "Used by the + button on the project." },
      ],
      submit: async v => {
        try {
          await sidebar.updateProject(item.id, { instructions: v.instructions, defaultMode: v.defaultMode as "chat" | "code" | "research" });
          notify("Settings saved");
          return null;
        } catch (e) { return failure(e, "Couldn't save the settings."); }
      },
    });
  };

  /** Share: a link holding the project and its chats (from this browser), like chat share links. */
  const shareProject = async (item: NavItem) => {
    let details = { description: "", instructions: "", defaultMode: "chat" as "chat" | "code" | "research" };
    if (serverSidebar) {
      try { const p = await sidebar.getProject(item.id); details = { description: p.description, instructions: p.instructions, defaultMode: p.defaultMode }; }
      catch { notify("Couldn't load the project."); return; }
    }
    const chats = history.filter(h => h.projectId === item.id && h.messages.length)
      .slice(0, MAX_SHARED_CHATS)
      .map(h => ({ title: h.title, mode: h.mode, messages: h.messages.map(({ role, content, display }) => ({ role, content, ...(display ? { display } : {}) })) }));
    try {
      const hash = await encodeProjectShare({ v: 2, kind: "project", name: item.label, ...details, chats });
      const parts = [
        chats.length ? (chats.length === 1 ? "1 chat with its messages" : `${chats.length} chats with their messages`) : "no chats yet",
        ...(details.instructions ? ["the project's instructions"] : []),
      ];
      setSidebarDialog({
        kind: "share", title: `Share “${item.label}”`, link: `${window.location.origin}/${hash}`,
        description: `The link contains ${parts.join(" and ")}. Anyone with it can read them and add a copy to their workspace. Nothing is uploaded: the content travels inside the link.`,
      });
    } catch (e) {
      notify(e instanceof ShareTooLargeError ? e.message : "Couldn't create the share link.");
    }
  };

  /** Opening a project share link: offer to add a copy of the project and its chats. */
  const importSharedProject = useCallback((bundle: SharedProjectBundle) => {
    setSidebarDialog({
      kind: "confirm", title: `Add “${bundle.name}” to your workspace?`, confirm: "Add project",
      description: `Someone shared this project with ${bundle.chats.length} chat${bundle.chats.length === 1 ? "" : "s"}${bundle.instructions ? " and instructions" : ""}. A copy is added to your projects; you can change or delete it.`,
      submit: async () => {
        const api = sidebarRef.current;
        let projectId = crypto.randomUUID();
        if (api.mode === "server") {
          const created = await api.createProject(bundle.name, projectId);
          if (created) projectId = created.id;
          await api.updateProject(projectId, { description: bundle.description, instructions: bundle.instructions, defaultMode: bundle.defaultMode });
        } else {
          let current: Project[] = parseProjects([]);
          try { current = parseProjects(JSON.parse(localStorage.getItem("az-projects") || "[]")); } catch {}
          const result = addProject(current, bundle.name, projectId);
          if ("error" in result) throw new Error(result.error);
          projectId = result.project.id;
          setProjects(result.projects);
          try { localStorage.setItem("az-projects", JSON.stringify(result.projects.slice(1))); } catch {}
        }
        const chats: HistoryItem[] = bundle.chats.map(c => ({ id: crypto.randomUUID(), title: c.title, mode: c.mode, messages: c.messages, projectId }));
        setHistory(prev => {
          const next = [...chats, ...prev].slice(0, 30);
          try { localStorage.setItem("az-user-conversations", JSON.stringify(next)); } catch {}
          return next;
        });
        if (api.mode === "server") await Promise.all(chats.map(c => api.saveChat(c.id, { title: c.title, projectId, mode: c.mode, messages: c.messages }).catch(() => {})));
        toggleProject(projectId, true);
        notify(`Added ${bundle.name}`);
      },
    });
  }, [notify, toggleProject]);

  const moveChatTo = (chatId: string, projectId: string | null) => {
    const local = history.find(h => h.id === chatId);
    const fromServer = sidebar.groups.flatMap(g => g.items.flatMap(i => [i, ...(i.children ?? [])])).find(i => i.id === chatId && i.type === "chat");
    if (!local && !fromServer) return;
    const currentProject = local ? (local.projectId && local.projectId !== DEFAULT_PROJECT.id ? local.projectId : null)
      : (sidebar.groups.find(g => g.id === "projects")?.items.find(p => p.children?.some(c => c.id === chatId))?.id ?? null);
    if (currentProject === projectId) return;
    const target = projectId ? projects.find(p => p.id === projectId) : DEFAULT_PROJECT;
    if (local) persistHistory(history.map(h => (h.id === chatId ? { ...h, projectId: projectId ?? undefined } : h)));
    if (serverSidebar) sidebar.updateChat(chatId, { projectId: projectId ?? DEFAULT_PROJECT.id }).catch(() => notify("Couldn't move the chat on your account"));
    if (projectId) toggleProject(projectId, true);
    notify(projectId ? `Moved to ${target?.name ?? "project"}` : "Moved to Chats");
  };

  const itemAction = (action: ItemAction, item: NavItem) => {
    if (action === "new-chat" && item.type === "project") {
      if (busy) return;
      newChat();
      setModeAndModel(item.mode === "code" || item.mode === "research" ? item.mode : "chat");
      setNewChatProject(item.id);
      toggleProject(item.id, true);
      setSidebarOpen(false);
      notify(`New chat in ${item.label}`);
      return;
    }
    if (action === "new-tab") {
      window.open(item.type === "project" ? `/?project=${encodeURIComponent(item.id)}` : `/?chat=${encodeURIComponent(item.id)}`, "_blank", "noopener");
      return;
    }
    if (item.type === "project" && action === "share") { shareProject(item); return; }
    if (item.type === "project" && (action === "edit" || action === "settings")) { projectForm(item, action); return; }
    if (item.type === "project") {
      if (action === "rename") setSidebarDialog({
        kind: "name", title: "Rename project", label: "Project name", initial: item.label, maxLength: MAX_PROJECT_NAME, confirm: "Save",
        submit: async name => {
          try { await sidebar.renameProject(item.id, name); return null; }
          catch (e) { return failure(e, "Couldn't rename the project."); }
        },
      });
      if (action === "delete") setSidebarDialog({
        kind: "confirm", title: `Delete “${item.label}”?`, confirm: "Delete project",
        description: "Its chats move to General. Nothing else is deleted.",
        submit: async () => {
          await sidebar.deleteProject(item.id);
          setHistory(prev => {
            const next = prev.map(h => (h.projectId === item.id ? { ...h, projectId: undefined } : h));
            try { localStorage.setItem("az-user-conversations", JSON.stringify(next)); } catch {}
            return next;
          });
          toggleProject(item.id, false);
          if (newChatProject === item.id) setNewChatProject(null);
          notify(`Deleted ${item.label}`);
        },
      });
      return;
    }
    if (item.type === "chat") {
      if (action === "rename") setSidebarDialog({
        kind: "name", title: "Rename chat", label: "Title", initial: item.label, maxLength: 120, confirm: "Save",
        submit: async title => {
          await sidebar.updateChat(item.id, { title });
          persistHistory(history.map(h => (h.id === item.id ? { ...h, title } : h)));
          return null;
        },
      });
      if (action === "pin") sidebar.updateChat(item.id, { pinned: !item.pinned }).catch(() => notify("Couldn't update the chat"));
      if (action === "delete") setSidebarDialog({
        kind: "confirm", title: `Delete “${item.label}”?`, confirm: "Delete chat",
        description: "The chat is removed from your account and from this browser.",
        submit: async () => {
          await sidebar.deleteChat(item.id);
          persistHistory(history.filter(h => h.id !== item.id));
          if (currentId === item.id) { setMessages([]); setCurrentId(null); }
          notify("Chat deleted");
        },
      });
    }
  };

  const previewItem = (item: CanvasItem) => {
    setCanvasItem(item);
    setCanvasOpen(true);
    setMenuOpen(false);
    setSidebarOpen(false);
  };

  const applyCanvasItem = (item: CanvasItem) => {
    if (item.kind === "prompt") applyPrompt(item);
    else attachUpload({ name: item.name, content: item.content });
    closeCanvas();
  };

  // Click pins the menu open; hover (mouse devices only) previews it and closes on leave.
  const toggleWorkspaceMenu = () => {
    clearTimeout(hoverTimer.current);
    const pinned = menuOpen && !openedByHover.current;
    openedByHover.current = false;
    setMenuOpen(!pinned);
  };

  // ↓ on the switcher opens the menu and focuses the first item; ↑/↓, Home and End move between items.
  const menuKeys = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("#workspace-menu button, #workspace-menu a") ?? []);
    e.preventDefault();
    if (!menuOpen) {
      openedByHover.current = false;
      setMenuOpen(true);
      requestAnimationFrame(() => items()[0]?.focus());
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1
      : e.key === "ArrowDown" ? (at + 1) % list.length : (at <= 0 ? list.length - 1 : at - 1);
    list[next]?.focus();
  };

  const runMenuAction = (action: () => void) => { openedByHover.current = false; setMenuOpen(false); action(); };

  const hoverWorkspaceMenu = (entering: boolean) => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    clearTimeout(hoverTimer.current);
    if (entering) {
      if (!menuOpen) { openedByHover.current = true; setMenuOpen(true); }
    } else if (openedByHover.current) {
      hoverTimer.current = setTimeout(() => { openedByHover.current = false; setMenuOpen(false); }, 150);
    }
  };

  const dialogContent: Record<string, { title: string; body: React.ReactNode }> = {
    settings: {
      title: "Workspace settings",
      body: (
        <div className={styles.settingsList}>
          <div className={styles.settingsRow}>
            <div><strong>Theme</strong><small>Applies to this browser.</small></div>
            <div className={styles.segmented} role="group" aria-label="Theme">
              {(["light", "dark"] as const).map(t => (
                <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === "light" ? "Light" : "Dark"}</button>
              ))}
            </div>
          </div>
          <div className={styles.settingsRow}>
            <label htmlFor="settings-tone"><strong>Default answer tone</strong><small>The tone picker in the composer starts here.</small></label>
            <select id="settings-tone" value={style} onChange={e => {
              const next = e.target.value as AnswerStyle;
              setStyle(next);
              try { localStorage.setItem("az-style", next); } catch {}
            }}>
              {ANSWER_STYLES.map(s => <option key={s} value={s}>{STYLE_LABELS[s]}</option>)}
            </select>
          </div>
          <div className={styles.settingsRow}>
            <div><strong>Sidebar</strong><small>Collapsed shows icons only.</small></div>
            <div className={styles.segmented} role="group" aria-label="Sidebar">
              <button aria-pressed={!collapsed} onClick={() => setCollapsed(false)}>Expanded</button>
              <button aria-pressed={collapsed} onClick={() => setCollapsed(true)}>Collapsed</button>
            </div>
          </div>
          <div className={styles.settingsRow}>
            <div>
              <strong>Your chats</strong>
              <small>{serverSidebar ? "Saved to your account; this browser keeps copies of recent chats." : "Saved in this browser."} {history.length} chat{history.length === 1 ? "" : "s"} in this browser.</small>
            </div>
            <div className={styles.settingsActions}>
              <button className={styles.outline} onClick={exportChats} disabled={!history.length}>Export</button>
              <button className={styles.outline} onClick={() => { setDialog(null); setDialog("privacy"); }}>Clear…</button>
            </div>
          </div>
          <div className={styles.settingsRow}>
            <div><strong>Connectors</strong><small>Read-only GitHub and Google Drive access.</small></div>
            <div className={styles.settingsActions}><a className={styles.outline} href="/connectors">Manage</a></div>
          </div>
          <div className={styles.settingsRow}>
            <div><strong>AI Code Agent</strong><small>Plan, review and apply repository changes (experimental).</small></div>
            <div className={styles.settingsActions}><a className={styles.outline} href="/code-agent">Open</a></div>
          </div>
          <p className={styles.settingsNote}>Personalization (custom instructions, answer length) is in the account menu: select your name at the bottom of the sidebar.</p>
        </div>
      ),
    },
    about: {
      title: "One workspace. Three modes.",
      body: <p>Conversation, code assistance, and research in a single interface. Admin tools remain separate.</p>,
    },
    privacy: {
      title: "Your data",
      body: (
        <>
          <p>{serverSidebar ? "Chats (with their messages) and projects are saved to your account on this computer; this browser also keeps copies of recent chats. Deleting a chat from the sidebar deletes it from your account." : "History is saved in this browser."} Messages and attachments are sent to the configured AI provider to generate answers.</p>
          {serverSidebar && <p>“Clear local history” removes this browser’s copies only.</p>}
          <button disabled={busy} className={styles.outline} onClick={() => {
            try { localStorage.removeItem("az-user-conversations"); setHistory([]); newChat(); notify("History cleared"); setDialog(null); }
            catch { notify("Storage unavailable"); }
          }}>
            Clear local history
          </button>
        </>
      ),
    },
    setup: {
      title: "Backend contract",
      body: (
        <>
          <p>POST <code>/api/chat</code> with <code>{`{ mode, model, messages }`}</code></p>
          <p>Returns <code>{`{ data: { answer: string } }`}</code></p>
        </>
      ),
    },
  };

  return (
    <div className={styles.app} data-theme={theme}>
      <nav className={styles.rail} aria-label="Quick actions">
        <button className={styles.railButton} onClick={newChat} aria-label="Ask AZ_AI" title="Ask AZ_AI"><Sparkles size={20} /></button>
        <button className={styles.railButton} onClick={showRecent} aria-label="Recent conversations" title="Recent conversations"><Clock size={20} /></button>
        <a className={styles.railButton} href="/insights" aria-label="Insights" title="Insights: pipeline activity and feedback"><BarChart3 size={20} /></a>
        <div className={styles.railSpacer} />
        <button className={styles.railButton} onClick={() => setDialog("settings")} aria-label="Workspace settings" title="Settings"><Settings size={20} /></button>
      </nav>

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.open : ""} ${collapsed ? styles.collapsed : ""}`}>
        <div className={styles.sidebarHeader}>
          <a className={styles.brand} href="/" aria-label="AZ AI home">
            <span className={styles.brandMark}>a</span>AZ_AI
          </a>
          <button
            className={`${styles.iconButton} ${styles.collapseToggle}`}
            onClick={() => { setCollapsed(c => !c); setMenuOpen(false); }}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <div
          className={styles.workspaceSwitcher}
          ref={menuRef}
          onMouseEnter={() => hoverWorkspaceMenu(true)}
          onMouseLeave={() => hoverWorkspaceMenu(false)}
          onKeyDown={menuKeys}
        >
          <button
            ref={switcherButtonRef}
            className={styles.workspaceButton}
            onClick={toggleWorkspaceMenu}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-controls="workspace-menu"
            aria-label="Local workspace menu"
            title="Local workspace"
          >
            <span className={styles.workspaceName}>
              <span className={styles.workspaceDot}>L</span>
              <span className={styles.label}>Local workspace</span>
            </span>
            <ChevronDown size={16} className={`${styles.chevron} ${menuOpen ? styles.chevronOpen : ""}`} />
          </button>

          {menuOpen && (
            <div className={styles.menu} id="workspace-menu" role="region" aria-label="Local workspace">
              <div className={styles.menuHeader}>
                <span className={styles.workspaceDot}>L</span>
                <div className={styles.menuHeaderText}>
                  <strong>Local workspace</strong>
                  <small>{accountName ? `${accountName} · ${access?.planName ?? "Free"}` : "Guest · this browser"}</small>
                </div>
                <span className={`${styles.statusPill} ${accountName ? styles.statusActive : ""}`}>
                  <span aria-hidden="true" />{accountName ? "Active" : "Browser only"}
                </span>
              </div>
              <p className={styles.menuNote}>
                {serverSidebar ? "Signed in on this computer. Chats, their messages and projects are saved to your account."
                  : "Everything is saved in this browser."}
              </p>
              <div className={styles.menuQuick}>
                <button onClick={() => runMenuAction(() => { newChat(); setModeAndModel("chat"); })}><MessageSquarePlus size={14} />New chat</button>
                <button onClick={() => runMenuAction(addProjectDialog)}><FolderPlus size={14} />New project</button>
                <a href="/insights"><BarChart3 size={14} />Insights</a>
                <button onClick={() => runMenuAction(() => setDialog("settings"))}><Settings size={14} />Settings</button>
              </div>
              <div className={styles.menuBody}>
                <div className={styles.menuGroup}>Prompts</div>
                {[...savedPrompts, ...SUGGESTIONS.map(s => ({ id: s.title, title: s.title, mode: s.mode, prompt: s.prompt }))].map(p => (
                  <button key={p.id} className={styles.menuItem} onClick={() => previewItem({ kind: "prompt", title: p.title, mode: p.mode, prompt: p.prompt })} title={`Preview “${p.title}”`}>
                    <FileText size={14} /><span>{p.title}</span>
                  </button>
                ))}
                <div className={styles.menuGroup}>Uploads</div>
                {uploads.length === 0 ? (
                  <p className={styles.menuEmpty}>Files you attach this session appear here.</p>
                ) : uploads.map(u => (
                  <button key={u.name} className={styles.menuItem} onClick={() => previewItem({ kind: "upload", name: u.name, content: u.content })} title={`Preview ${u.name}`}>
                    {/\.svg$/i.test(u.name) ? <ImageIcon size={14} /> : <File size={14} />}<span>{u.name}</span>
                  </button>
                ))}
              </div>
              <div className={styles.menuFooter}>
                <button className={styles.menuAction} onClick={() => runMenuAction(savePrompt)}>+ New prompt</button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.navArea} ref={historyRef}>
          <SidebarNav
            groups={navGroups}
            activeId={navActive}
            onSelect={selectNav}
            onMore={group => { if (group === "projects") setAllProjects(true); else if (group.startsWith("project:")) loadProjectChats(group.slice(8)); }}
            onAddProject={addProjectDialog}
            onAllProjects={() => setAllProjects(a => !a)}
            onSeeAllChats={() => setSeeAllChats(v => !v)}
            onItemAction={itemAction}
            onMoveChat={moveChatTo}
            collapsed={collapsed}
            // The workspace theme defines its own --accent (a colour, not shadcn's HSL triplet).
            itemClassName="!text-[var(--muted)] hover:bg-[var(--hover)] hover:!text-[var(--ink)]"
            activeClassName="bg-[var(--accent)] font-medium !text-[var(--green)] hover:bg-[var(--accent)] hover:!text-[var(--green)]"
          />
        </div>

        <SidebarDialog state={sidebarDialog} onClose={() => setSidebarDialog(null)} />

        <SidebarUserMenu
          collapsed={collapsed}
          onOpenSettings={() => setDialog("settings")}
          onOpenPrivacy={() => setDialog("privacy")}
          onOpenAbout={() => setDialog("about")}
          notify={notify}
        />
      </aside>
      {sidebarOpen && <div className={styles.scrim} onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className={styles.main}>
        <header className={styles.topbar}>
          <button className={`${styles.iconButton} ${styles.mobileMenu}`} onClick={() => setSidebarOpen(o => !o)} aria-label="Menu" aria-expanded={sidebarOpen}>
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className={styles.breadcrumbs}>
            <span className={styles.crumbRoot}>Local workspace</span>
            <span className={styles.crumbSep}>/</span>
            <span className={styles.crumbProject}>{currentProject.name}</span>
            <span className={styles.crumbSep}>/</span>
            <span>{DESCRIPTIONS[mode].label}</span>
          </div>
          <div className={styles.topActions}>
            <button className={styles.iconButton} onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <MoreMenu
              open={moreOpen}
              setOpen={setMoreOpen}
              projects={projects}
              currentProjectId={currentProject.id}
              chatTitle={chatTitle}
              onMove={moveChat}
              onCreateAndMove={createProjectAndMove}
              onDelete={deleteChat}
            />
            <ShareMenu open={shareOpen} setOpen={setShareOpen} getProject={getShareProject} notify={notify} />
            <button
              className={`${styles.outline} ${styles.canvasToggle} ${canvasOpen ? styles.canvasActive : ""}`}
              onClick={() => canvasOpen ? closeCanvas() : setCanvasOpen(true)}
              aria-pressed={canvasOpen}
              aria-label="Local workspace"
              title="Open/close development canvas"
            >
              <span className={styles.canvasGlyph} aria-hidden="true">[<span className={styles.canvasBar} />]</span>
            </button>
          </div>
        </header>

        <div className={styles.scroll} ref={threadRef}>
          <section className={`${styles.workspace} ${messages.length ? styles.conversing : ""}`}>
            {messages.length === 0 && (
              <div className={styles.welcome}>
                <div className={styles.eyebrow}>Combined intelligence</div>
                <h1>What’s on your mind?<br /><span>Let’s make something of it.</span></h1>
                <p>Ask, research, or build. One interface that blends conversational AI, deep exploration, and coding assistance.</p>
              </div>
            )}

            <div className={styles.thread} aria-live="polite">
              {messages.map((m, i) => (
                <article key={i} className={styles.message}>
                  <div className={styles.messageLabel}>{m.role === "user" ? "You" : "AZ_AI"}</div>
                  <div className={styles.messageContent}>
                    {m.role === "assistant" && m.plan && (
                      <details className={styles.plan}>
                        <summary>Research plan · {m.plan.length} steps</summary>
                        <ol>{m.plan.map((step, n) => <li key={n}>{step}</li>)}</ol>
                      </details>
                    )}
                    <MessageContent role={m.role} content={m.display || m.content} />
                    {m.role === "assistant" && m.sources && (
                      <nav className={styles.sources} aria-label="Sources">
                        <span>Sources</span>
                        {m.sources.map((s, n) => s.url
                          ? <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">[{n + 1}] {s.title} ↗</a>
                          : <span key={s.id} className={styles.sourceItem}>[{n + 1}] {s.title}</span>)}
                      </nav>
                    )}
                    {m.role === "assistant" && m.notes?.map(note => <p key={note} className={styles.note}>⚠ {note}</p>)}
                  </div>
                  {m.role === "assistant" && m.requestId && <AnswerFeedback key={m.requestId} requestId={m.requestId} answer={m.content} />}
                </article>
              ))}
            </div>

          </section>
        </div>

        {/* Fixed at the bottom; the conversation scrolls above it. */}
        <div className={`${styles.dock} ${messages.length ? styles.conversing : ""}`}>
          <div className={styles.dockInner}>
            <div className={styles.modes}>
              {(Object.keys(DESCRIPTIONS) as Mode[]).map(m => (
                <button
                  key={m}
                  className={`${styles.mode} ${mode === m ? styles.active : ""}`}
                  onClick={() => setModeAndModel(m)}
                  aria-pressed={mode === m}
                >
                  {m === "chat" ? "Ask anything" : m === "code" ? "Build with code" : "Explore deeply"}
                </button>
              ))}
            </div>

            <div className={styles.composerWrap}>
              <form className={styles.composer} onSubmit={handleSubmit}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSubmit(); } }}
                  placeholder={DESCRIPTIONS[mode].placeholder}
                  rows={2}
                  disabled={busy}
                  required
                />
                {file && (
                  <div className={styles.fileLabel}>
                    Attached: {file.name}
                    <button type="button" onClick={() => setFile(null)}>Remove</button>
                  </div>
                )}
                <div className={styles.composerFooter}>
                  <div className={styles.composerTools}>
                    <button type="button" disabled={busy} className={styles.attach}
                      onClick={() => can("attachments") ? fileInputRef.current?.click() : notify(`File attachments are included with Plus and above (you're on ${access?.planName ?? "Free"}). See /pricing.`)}
                      aria-label="Attach file" title={can("attachments") ? "Attach file" : "Attachments: Plus and above"}><Plus size={16} /></button>
                    <input ref={fileInputRef} type="file" hidden accept=".txt,.md,.js,.ts,.tsx,.jsx,.py,.json,.css,.html,.csv,.svg" onChange={handleFile} />
                    <select disabled={busy} value={model} onChange={e => setModel(e.target.value as Model)} aria-label="Model">
                      <option value="auto">AZ · Auto</option>
                      <option value="reasoning">AZ · Reasoning</option>
                      <option value="code">AZ · Code</option>
                    </select>
                    <select disabled={busy} value={style} aria-label="Answer tone" title="Answer tone"
                      onChange={e => {
                        const next = e.target.value as AnswerStyle;
                        setStyle(next);
                        try { localStorage.setItem("az-style", next); } catch {}
                      }}>
                      {ANSWER_STYLES.map(s => <option key={s} value={s}>{STYLE_LABELS[s]}</option>)}
                    </select>
                  </div>
                  {busy
                    ? <button type="button" className={styles.stop} onClick={() => stopRef.current?.abort()} aria-label="Stop"><Square size={12} fill="currentColor" /></button>
                    : <button type="submit" className={styles.send} disabled={!input.trim()} aria-label="Send"><ArrowUp size={16} /></button>}
                </div>
              </form>

              {status && <p className={styles.status} role="status">{status === "thinking" ? "Thinking…" : status}</p>}
              <p className={styles.hint}>Enter to send · Shift+Enter for new line · Verify important information</p>
            </div>

            {messages.length === 0 && (
              <section className={styles.suggestions} aria-label="Start here">
                <span className={styles.suggestionsLabel}>Start here</span>
                <div className={styles.marquee}>
                  <div className={styles.marqueeTrack}>
                    {[0, 1].map(copy => STARTERS.map(s => (
                      <button key={`${copy}-${s.title}`} className={styles.chip} onClick={() => applyPrompt(s)} title={s.prompt}
                        {...(copy ? { "aria-hidden": true, tabIndex: -1 } : {})}>
                        {s.title}
                      </button>
                    )))}
                  </div>
                </div>
              </section>
            )}

            <div className={styles.privacyNote}>{serverSidebar
              ? "Chats, their messages and projects are saved to your account on this computer. Messages are processed by your configured AI provider."
              : "History is saved in this browser. Messages are processed by your configured AI provider."}</div>
          </div>
        </div>

        <footer className={styles.footer}>
          <span>© {new Date().getFullYear()} AZ_AI</span>
          <div>
            <button onClick={() => setDialog("about")}>About</button>
            <button onClick={() => setDialog("privacy")}>Privacy</button>
            <button onClick={() => setDialog("setup")}>Setup</button>
          </div>
        </footer>
      </main>

      {dialog && dialogContent[dialog] && (
        <dialog open className={styles.dialog} onClick={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <h2>{dialogContent[dialog].title}</h2>
          {dialogContent[dialog].body}
          <div className={styles.dialogFooter}>
            <button className={styles.outline} onClick={() => setDialog(null)}>Close</button>
          </div>
        </dialog>
      )}

      <DevCanvas
        open={canvasOpen}
        onClose={closeCanvas}
        messages={messages}
        item={canvasItem}
        onClearItem={() => setCanvasItem(null)}
        onUseItem={applyCanvasItem}
      />

      {toast && <div className={styles.toast} role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
