// components/sidebar-nav.tsx
"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare, Image, Library, Zap, Plus, Folder, FolderOpen, FolderPlus, MoreHorizontal, Puzzle, Pin,
  MessageCircle, ExternalLink, Pencil, Share2, Trash2, Archive, ChevronDown, Search, Code, SquarePen, Settings, Blocks, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Data-driven: groups, items, project trees, and the actions each item offers come from
// /api/sidebar (or the page's local fallback). Nothing about the workspace is hardcoded here.

export type ItemAction = "new-chat" | "new-tab" | "rename" | "share" | "edit" | "settings" | "pin" | "delete";
export type GroupAction = "all" | "add" | "see-all";

export type NavItem = {
  id: string;
  label: string;
  icon?: string | React.ComponentType<{ className?: string }>;
  href?: string;
  badge?: string;
  /** Shown as the row's tooltip (e.g. a project description). */
  description?: string;
  /** A project's default mode for new chats. */
  mode?: string;
  type?: "project" | "chat";
  pinned?: boolean;
  actions?: ItemAction[];
  /** Nested items (a project's chats), shown while `expanded`. */
  children?: NavItem[];
  expanded?: boolean;
  /** Total children on the server, when more exist than are listed. */
  childCount?: number;
};

export type NavGroup = {
  id: string;
  label?: string;
  collapsible?: boolean;
  showMore?: boolean;
  actions?: GroupAction[];
  items: NavItem[];
  /** Shown when the group has no items (otherwise the group is hidden). */
  emptyText?: string;
  /** Hide this group when the sidebar is collapsed to icons (long lists). */
  hideWhenCollapsed?: boolean;
  /** "top" and "bottom" stay put; the rest scroll between them (default "scroll"). */
  placement?: "top" | "scroll" | "bottom";
  /** Dropping a chat on this group moves it out of any project. */
  acceptsChats?: boolean;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare, imagine: Image, library: Library, automations: Zap, plus: Plus, folder: Folder,
  puzzle: Puzzle, blocks: Blocks, globe: Globe, pin: Pin, message: MessageCircle, search: Search, code: Code,
};

// Menu order follows the design: open, rename, share, edit, settings, pin — then a divider and Delete.
const MENU: { action: Exclude<ItemAction, "new-chat">; label: (item: NavItem) => string; icon: React.ComponentType<{ className?: string }> }[] = [
  { action: "new-tab", label: () => "Open new tab", icon: ExternalLink },
  { action: "rename", label: () => "Rename", icon: Pencil },
  { action: "share", label: () => "Share", icon: Share2 },
  { action: "edit", label: () => "Edit", icon: SquarePen },
  { action: "settings", label: () => "Settings", icon: Settings },
  { action: "pin", label: item => (item.pinned ? "Unpin" : "Pin"), icon: Pin },
];

const DRAG_TYPE = "application/x-az-chat";
// Row hover/selected background; written out in full so Tailwind generates it.
const ROW_HOVER = "hover:bg-[var(--hover,hsl(var(--accent)))]";
const ROW_OPEN = "bg-[var(--hover,hsl(var(--accent)))]";
const DROP_RING = "ring-2 ring-inset ring-[var(--green-mid,hsl(var(--ring)))]";

type Props = {
  groups: NavGroup[];
  activeId?: string;
  onSelect?: (id: string, type?: NavItem["type"]) => void;
  onAddProject?: () => void;
  onAllProjects?: () => void;
  onSeeAllChats?: () => void;
  /** "More" on a group (groupId), or "Show all" under a project ("project:<id>"). */
  onMore?: (groupId: string) => void;
  onItemAction?: (action: ItemAction, item: NavItem) => void;
  /** Drag and drop: a chat dropped on a project (projectId) or on a group that accepts chats (null). */
  onMoveChat?: (chatId: string, projectId: string | null) => void;
  /** Icon-only rendering for a collapsed sidebar; labels move to tooltips. */
  collapsed?: boolean;
  className?: string;
  /** Styling hooks for hosts with their own theme tokens (defaults: shadcn accent). */
  itemClassName?: string;
  activeClassName?: string;
};

export function SidebarNav({
  groups, activeId, onSelect, onAddProject, onAllProjects, onSeeAllChats, onMore, onItemAction, onMoveChat,
  collapsed = false, className, itemClassName, activeClassName = "bg-accent text-accent-foreground",
}: Props) {
  // Collapsible groups start expanded, including ones that appear later.
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const toggle = (id: string) => setClosed(s => ({ ...s, [id]: !s[id] }));
  const draggable = !!onMoveChat && !collapsed;

  // Fade the bottom of the scrolling list while more is hidden below.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = scroller.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, groups, collapsed]);

  // Drop targets: projects (move into) and groups that accept chats (move out of a project).
  const dropProps = (target: string, projectId: string | null) => draggable ? {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (dropOn !== target) setDropOn(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(d => (d === target ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      const chatId = e.dataTransfer.getData(DRAG_TYPE);
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null); setDragging(null);
      if (chatId) onMoveChat?.(chatId, projectId);
    },
  } : {};

  const row = (item: NavItem, depth: 0 | 1) => {
    const isProject = item.type === "project";
    const isChat = item.type === "chat";
    const Icon = isProject ? (item.expanded ? FolderOpen : Folder)
      : typeof item.icon === "function" ? item.icon : ICONS[item.icon ?? ""] ?? Folder;
    const active = activeId === item.id;
    const menu = collapsed ? [] : MENU.filter(m => item.actions?.includes(m.action));
    const canDelete = !collapsed && !!item.actions?.includes("delete");
    const newChat = !collapsed && !!item.actions?.includes("new-chat");
    const quickPin = !collapsed && isChat && !!item.actions?.includes("pin");
    const showTools = active || menuFor === item.id;
    // The row carries the hover/selected background (full width, behind its buttons); buttons stay transparent.
    const flat = "bg-transparent hover:bg-transparent data-[state=open]:bg-transparent";
    const tool = cn(
      "h-7 w-7 shrink-0 rounded-md opacity-0 focus-visible:opacity-100 group-hover/item:opacity-100",
      showTools && "opacity-100", itemClassName, flat,
    );
    const content = (
      <>
        {/* Chats are plain text rows (the design); projects and main items keep their icons. */}
        {depth === 0 && !isChat && <Icon className="h-4 w-4 shrink-0" />}
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && item.badge && (
          <span className="ml-auto rounded border px-1.5 text-[10px] font-medium text-muted-foreground">{item.badge}</span>
        )}
      </>
    );
    const classes = cn(
      "h-9 min-w-0 flex-1 gap-2.5 rounded-lg font-normal",
      collapsed ? "justify-center px-0" : "justify-start",
      depth === 1 && "pl-9",
      itemClassName,
      active && activeClassName,
      flat,
    );
    const title = item.description ? `${item.label} — ${item.description}` : item.label;
    return (
      <div key={item.id}
        className={cn(
          "group/item relative flex items-center gap-0.5 rounded-lg pr-1",
          ROW_HOVER, menuFor === item.id && ROW_OPEN, active && activeClassName,
          isProject && dropOn === `project:${item.id}` && DROP_RING,
          dragging === item.id && "opacity-50",
        )}
        draggable={draggable && isChat}
        onDragStart={draggable && isChat ? e => {
          e.dataTransfer.setData(DRAG_TYPE, item.id);
          e.dataTransfer.setData("text/plain", item.label);
          e.dataTransfer.effectAllowed = "move";
          setDragging(item.id);
        } : undefined}
        onDragEnd={draggable && isChat ? () => { setDragging(null); setDropOn(null); } : undefined}
        {...(isProject ? dropProps(`project:${item.id}`, item.id) : {})}
      >
        {item.href ? (
          <Button asChild variant="ghost" size="sm" className={classes} title={title}>
            <a href={item.href} aria-current={active ? "page" : undefined} aria-label={collapsed ? item.label : undefined}>{content}</a>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className={classes} title={title}
            aria-label={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            aria-expanded={isProject && !collapsed ? !!item.expanded : undefined}
            onClick={() => onSelect?.(item.id, item.type)}>
            {content}
          </Button>
        )}

        {newChat && (
          <Button variant="ghost" size="icon" className={tool} title={`New chat in ${item.label}`} aria-label={`New chat in ${item.label}`}
            onClick={() => onItemAction?.("new-chat", item)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}

        {/* Pin: a quick toggle on hover; pinned chats keep showing it. */}
        {quickPin && (
          <Button variant="ghost" size="icon" className={cn(tool, item.pinned && "opacity-100")}
            title={item.pinned ? "Unpin" : "Pin"} aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.label}`} aria-pressed={!!item.pinned}
            onClick={() => onItemAction?.("pin", item)}>
            <Pin className={cn("h-4 w-4", item.pinned && "fill-current")} />
          </Button>
        )}

        {(menu.length > 0 || canDelete) && (
          <DropdownMenu onOpenChange={open => setMenuFor(open ? item.id : null)}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={cn(tool, "data-[state=open]:!bg-[var(--hover,hsl(var(--accent)))]")} aria-label={`${item.label} options`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-52 rounded-xl p-1.5">
              {menu.map(m => (
                <DropdownMenuItem key={m.action} className="gap-3 rounded-lg px-3 py-2 text-[15px]" onSelect={() => onItemAction?.(m.action, item)}>
                  <m.icon className="h-4 w-4" /> {m.label(item)}
                </DropdownMenuItem>
              ))}
              {canDelete && (
                <>
                  {menu.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem className="gap-3 rounded-lg px-3 py-2 text-[15px] text-red-600 focus:text-red-600" onSelect={() => onItemAction?.("delete", item)}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  const renderGroup = (group: NavGroup) => {
    if (collapsed && group.hideWhenCollapsed) return null;
    if (!group.items.length && !group.emptyText && !group.actions?.length) return null;
    const open = !group.collapsible || !closed[group.id];
    const target = `group:${group.id}`;
    const muted = itemClassName && "!text-[var(--faint,inherit)]";
    return (
      <div key={group.id} role="group" aria-label={group.label ?? group.id}
        className={cn("rounded-lg", group.label && "mb-2", dropOn === target && DROP_RING)}
        {...(group.acceptsChats ? dropProps(target, null) : {})}>
        {group.label && !collapsed && (
          <div className="flex items-center justify-between pl-2 pr-1 pb-1 pt-2">
            {group.collapsible ? (
              <button type="button" onClick={() => toggle(group.id)} aria-expanded={open}
                className={cn("flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground", muted, itemClassName && "hover:!text-[var(--ink,inherit)]")}>
                {group.label}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
              </button>
            ) : (
              <span className={cn("text-[13px] font-medium text-muted-foreground", muted)}>{group.label}</span>
            )}
            <div className="flex items-center gap-0.5">
              {group.actions?.includes("all") && (
                <Button variant="ghost" size="icon" className={cn("h-7 w-7 rounded-md", itemClassName)} onClick={onAllProjects} title="All projects" aria-label="All projects">
                  <Archive className="h-4 w-4" />
                </Button>
              )}
              {group.actions?.includes("add") && (
                <Button variant="ghost" size="icon" className={cn("h-7 w-7 rounded-md", itemClassName)} onClick={onAddProject} title="New project" aria-label="Add project">
                  <FolderPlus className="h-4 w-4" />
                </Button>
              )}
              {group.actions?.includes("see-all") && (
                <Button variant="ghost" size="sm" className={cn("h-7 px-2 text-xs", itemClassName)} onClick={onSeeAllChats}>
                  See all
                </Button>
              )}
            </div>
          </div>
        )}

        {open && (
          <div className="space-y-0.5">
            {!group.items.length && !collapsed && group.emptyText && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{group.emptyText}</p>
            )}
            {group.items.map(item => (
              <Fragment key={item.id}>
                {row(item, 0)}
                {item.expanded && !collapsed && item.children && (
                  <div role="group" aria-label={`${item.label} chats`} className="space-y-0.5">
                    {item.children.map(child => row(child, 1))}
                    {!item.children.length && <p className="py-1.5 pl-9 text-xs text-muted-foreground">No chats yet</p>}
                    {(item.childCount ?? 0) > item.children.length && (
                      <button type="button" onClick={() => onMore?.(`project:${item.id}`)}
                        className={cn("w-full rounded-lg py-1.5 pl-9 text-left text-xs text-muted-foreground hover:underline", itemClassName)}>
                        Show all {item.childCount} chats
                      </button>
                    )}
                  </div>
                )}
              </Fragment>
            ))}

            {group.showMore && !collapsed && (
              <Button variant="ghost" size="sm" className={cn("w-full justify-start gap-2 text-muted-foreground", itemClassName)}
                onClick={() => onMore?.(group.id)}>
                <MoreHorizontal className="h-4 w-4" />
                More
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const at = (place: NonNullable<NavGroup["placement"]>) => groups.filter(g => (g.placement ?? "scroll") === place);
  return (
    <nav className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Workspace">
      {at("top").length > 0 && <div className="flex flex-col gap-1 px-2 pt-2">{at("top").map(renderGroup)}</div>}
      <div ref={scroller} onScroll={measure} data-more={more || undefined}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2",
          more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-56px),transparent)]")}>
        <div className="flex flex-col gap-1 pb-2">{at("scroll").map(renderGroup)}</div>
      </div>
      {at("bottom").length > 0 && <div className="flex flex-col gap-1 px-2 pb-2">{at("bottom").map(renderGroup)}</div>}
    </nav>
  );
}
