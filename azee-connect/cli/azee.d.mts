export declare const MAX_CHARS: number;
export declare const AROUND_LINES: number;
export declare const EXIT: { OK: 0; REQUEST: 1; USAGE: 2; AUTH: 3 };
export declare class CliError extends Error {
  code: number;
  constructor(message: string, code?: number);
}
export declare function languageFor(file?: string): string;
export declare function parseArgs(argv: string[]): {
  command: string | undefined;
  positional: string[];
  flags: Partial<Record<"lines" | "around" | "mode" | "model" | "lang" | "out" | "url" | "token", string>> & { stdin?: boolean; help?: boolean };
};
export declare function selectLines(text: string, options?: { lines?: string; around?: string }): { code: string; start: number; end: number; total: number };
export declare function buildMessage(input: {
  task?: string; question?: string; code?: string; file?: string;
  start?: number; end?: number; total?: number; lang?: string;
}): string;
export declare function validateBase(value: string): boolean;
export declare function configPath(env?: Record<string, string | undefined>, platform?: string): string;
export declare function run(argv: string[], io?: {
  stdout?: { write(text: string): unknown };
  stdin?: AsyncIterable<Uint8Array | string> & { isTTY?: boolean };
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  stdinWaitMs?: number;
}): Promise<number>;
