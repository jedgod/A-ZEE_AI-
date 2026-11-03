import { z } from "zod";

// Settings each plugin offers. A "secret" field (API key, token) is stored encrypted and never
// returned by the API; the panel only learns whether it is set.

export type Field = {
  key: string;
  label: string;
  type: "text" | "boolean" | "select" | "secret";
  help?: string;
  default?: string | boolean;
  options?: string[];
  max?: number;
};

export const FIELDS: Record<string, Field[]> = {
  gmail: [
    { key: "defaultQuery", label: "Default search", type: "text", max: 200, default: "in:inbox", help: "Gmail search used when none is typed, e.g. in:inbox or is:unread." },
  ],
};

export const fieldsOf = (pluginId: string): Field[] => FIELDS[pluginId] ?? [];

const shape = (f: Field) =>
  f.type === "boolean" ? z.boolean()
    : f.type === "select" ? z.enum(f.options as [string, ...string[]])
      : f.type === "secret" ? z.string().min(1).max(f.max ?? 500).nullable()   // null clears it
        : z.string().max(f.max ?? 200);

/** Strict validator for a settings patch: only this plugin's own keys, each of the right type. */
export const settingsPatch = (fields: Field[]) =>
  z.object(Object.fromEntries(fields.map(f => [f.key, shape(f).optional()]))).strict();
