export type MtlsResponse = { ok: boolean; status: number; json(): Promise<any> };
export function mtlsConfigured(env?: Record<string, string | undefined>): boolean;
export function mtlsFetcher(env?: Record<string, string | undefined>): (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<MtlsResponse>;
