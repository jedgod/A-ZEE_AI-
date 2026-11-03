"use client";

import { useState } from "react";
import { FileText, Search, Settings, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { Plugin } from "@/lib/plugins/service";

// Tools and platform features as cards: name, description, status, an enable switch and settings.
// Data and changes come from the parent (GET /api/plugins, PATCH /api/plugins/:id).

const ICONS = { search: FileText, tool: Wrench, connector: Search } as const;

function SettingsDialog({ plugin, onClose }: { plugin: Plugin; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="gap-4">
        <DialogTitle>{plugin.name} settings</DialogTitle>
        <DialogDescription>{plugin.description}</DialogDescription>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Managed by</dt><dd>{plugin.managedBy === "staff" ? "Staff administrators" : "You"}</dd></div>
          {plugin.version && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Version</dt><dd>v{plugin.version}</dd></div>}
          {plugin.permissions && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Permissions</dt><dd>{plugin.permissions.join(", ") || "none"}</dd></div>}
          {plugin.blockedBy && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Blocked</dt><dd className="text-right">{plugin.blockedBy}</dd></div>}
        </dl>
        {plugin.fields.length === 0 && <p className="text-sm text-muted-foreground">This plugin has no options to configure.</p>}
      </DialogContent>
    </Dialog>
  );
}

export function PluginsPage({ plugins, loaded, query, busy, onToggle }: {
  plugins: Plugin[]; loaded: boolean; query: string; busy: string | null; onToggle: (plugin: Plugin, enabled: boolean) => void;
}) {
  const [settingsFor, setSettingsFor] = useState<Plugin | null>(null);
  const shown = plugins.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const staffOnly = plugins.some(p => p.managedBy === "staff" && !p.canManage);

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading plugins…</p>;
  return (
    <div className="space-y-4">
      {staffOnly && (
        <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          Skills are managed by staff administrators. <a className="underline" href="/login?next=/connectors%3Ftab%3Dskills">Staff sign-in</a> to enable or disable them.
        </p>
      )}
      <div className="grid gap-4">
        {shown.map(p => {
          const Icon = ICONS[p.category];
          return (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>{p.description}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {p.status === "blocked" && <Badge variant="secondary">Infrastructure Blocked</Badge>}
                  {p.status === "readonly" && <Badge variant="outline">Read-only</Badge>}
                  <Switch aria-label={`${p.enabled ? "Disable" : "Enable"} ${p.name}`} checked={p.enabled}
                    disabled={!p.canManage || p.status === "blocked" || busy === p.id} onCheckedChange={v => onToggle(p, v)} />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSettingsFor(p)}>
                  <Settings className="mr-1 h-3 w-3" /> Settings
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {!shown.length && <p className="text-sm text-muted-foreground">No plugins match.</p>}
      </div>
      {settingsFor && <SettingsDialog plugin={settingsFor} onClose={() => setSettingsFor(null)} />}
    </div>
  );
}
