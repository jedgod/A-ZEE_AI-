export function manifestPath(modelsDir: string, ref: string): string;
export function verifyModel(modelsDir: string, ref: string): Promise<{ ok: boolean; error?: string; layers?: number; bad?: any[]; results?: any[] }>;
export function smokeTest(baseUrl: string, model: string, fetchImpl?: typeof fetch): Promise<{ ok: boolean; error?: string; sample?: string }>;
