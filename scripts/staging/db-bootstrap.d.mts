export const DATABASES: Record<string, { owner: string; runtime: string[] }>;
export const ROLES: string[];
export function bootstrap(o: { adminUrl: string; passwords: Record<string, string> }): Promise<void>;
