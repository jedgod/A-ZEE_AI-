"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BriefcaseBusiness, Bug, Check, ChevronRight, Download, FileText, HelpCircle, Keyboard, LifeBuoy, Lock,
  LogIn, LogOut, Mail, Plus, Settings, Shield, Sparkles, SlidersHorizontal, User,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AccountDialogs, type AccountDialog, type AccountData } from "@/components/account-dialogs";
import { useAccess } from "@/components/use-access";
import { cn } from "@/lib/utils";

type Props = {
  collapsed?: boolean;
  onOpenSettings: () => void;
  onOpenPrivacy: () => void;
  onOpenAbout: () => void;
  notify: (message: string) => void;
};

/** Sidebar footer: account menu with profile, personalization, help, and sign-in (account data from /api/account). */
export function SidebarUserMenu({ collapsed = false, onOpenSettings, onOpenPrivacy, onOpenAbout, notify }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AccountData | null>(null);
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const { can } = useAccess();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (response.ok) setData((await response.json()).data);
    } catch { /* offline: the menu still works with defaults */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Ctrl+/ (Cmd+/ on macOS) opens the keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); setDialog(d => (d === "shortcuts" ? null : "shortcuts")); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const account = data?.account ?? null;
  const name = account?.name ?? (data?.local === false ? "Guest" : "Your workspace");
  const initials = account?.initials ?? (data?.local === false ? "G" : "Y");
  const subtitle = account ? account.planName : data?.local === false ? "Not signed in" : "Local workspace";
  const show = (d: AccountDialog) => { setOpen(false); setDialog(d); };
  const link = (url: string | null | undefined, fallback: () => void) => () => {
    setOpen(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer"); else fallback();
  };

  async function signOut() {
    setOpen(false);
    const response = await fetch("/api/staff/session", { method: "DELETE" }).catch(() => null);
    if (response?.ok) { notify("Signed out of your staff account."); load(); }
    else notify("Couldn't sign out. Try again.");
  }

  const avatar = (size: string, text: string) => (
    <Avatar className={size}>
      <AvatarFallback className={cn("bg-blue-500 font-semibold text-white", text)}>{initials}</AvatarFallback>
    </Avatar>
  );

  return (
    <div className="border-t border-[color:var(--line)] p-3" data-testid="sidebar-user-menu">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[color:var(--ink)] hover:bg-[color:var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--green-mid)]",
              collapsed && "justify-center px-0",
            )}
          >
            {avatar("h-7 w-7", "text-xs")}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="text-[11px] text-[color:var(--faint)]">{subtitle}</div>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-64">
          {/* Account header + account switcher */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 py-2" aria-label="Accounts and workspaces">
              {avatar("h-8 w-8", "text-xs")}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">{account ? "Personal account" : subtitle}</div>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {account && (
                <DropdownMenuItem onSelect={() => show("profile")}>
                  <Mail /> <span className="truncate">{account.email}</span>
                </DropdownMenuItem>
              )}
              {account?.workspaces.filter(w => !w.personal).map(w => (
                <DropdownMenuItem key={w.id} disabled={w.status === "deactivated"} className="data-[disabled]:opacity-100">
                  {w.status === "deactivated" ? <Lock /> : <BriefcaseBusiness />}
                  <div className="min-w-0">
                    <div className="truncate">{w.name}</div>
                    {w.status === "deactivated" && <div className="text-xs text-muted-foreground">Deactivated</div>}
                  </div>
                </DropdownMenuItem>
              ))}
              {account && <DropdownMenuSeparator />}
              <DropdownMenuItem className="justify-between" onSelect={e => e.preventDefault()}>
                <div className="flex items-center gap-2">
                  {avatar("h-6 w-6", "text-[10px]")}
                  {account ? "Personal account" : name}
                </div>
                <Check className="h-4 w-4" />
              </DropdownMenuItem>
              {data?.staff && (
                <DropdownMenuItem asChild>
                  <a href="/operations" className="justify-between">
                    <div className="flex items-center gap-2"><BriefcaseBusiness />
                      <div><div>{data.staff.name}</div><div className="text-xs capitalize text-muted-foreground">Staff · {data.staff.role}</div></div>
                    </div>
                    <ChevronRight className="text-muted-foreground" />
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/login"><Plus /> {data?.staff ? "Switch staff account" : "Add account (staff sign-in)"}</a>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => show("plan")}><Sparkles /> Upgrade plan</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show(can("personalization") ? "personalization" : "plan")} disabled={!account}>
            <SlidersHorizontal /> Personalization
            {!can("personalization") && <span className="ml-auto rounded bg-muted px-1.5 text-[10px] text-muted-foreground">Plus</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show("profile")} disabled={!account}><User /> Profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setOpen(false); onOpenSettings(); }}><Settings /> Settings</DropdownMenuItem>
          {data?.staff && (
            <DropdownMenuItem asChild><a href="/operations"><BriefcaseBusiness /> Operations workspace</a></DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Help submenu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><HelpCircle /> Help</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuItem onSelect={link(data?.links.help, () => { setOpen(false); onOpenAbout(); })}><HelpCircle /> Help center</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setOpen(false); onOpenPrivacy(); }}><Shield /> Privacy center</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => show("release-notes")}><FileText /> Release notes</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => show("download")}><Download /> Download apps</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => show("shortcuts")}>
                <Keyboard /> Keyboard shortcuts <DropdownMenuShortcut>Ctrl+/</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {data?.links.terms && <DropdownMenuItem onSelect={link(data.links.terms, () => {})}><FileText /> Terms of Service</DropdownMenuItem>}
              <DropdownMenuItem onSelect={link(data?.links.privacy, () => { setOpen(false); onOpenPrivacy(); })}><Shield /> Privacy Policy</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => show("support")}><LifeBuoy /> Contact support</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => show("bug")}><Bug /> Report a bug</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {data?.staff ? (
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={signOut}><LogOut /> Log out</DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild><a href="/login"><LogIn /> Staff sign-in</a></DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountDialogs dialog={dialog} onClose={() => setDialog(null)} data={data} onChanged={load} notify={notify} />
    </div>
  );
}
