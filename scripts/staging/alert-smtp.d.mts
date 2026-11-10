export function smtpSettings(env?: Record<string, string | undefined>): { ok: false; reason: string } | { ok: true; host: string; port: number; security: "tls" | "starttls"; from: string; to: string[]; user: string | null; passwordFile: string | null; caFile: string | null; timeoutMs: number };
export function formatAlert(a: Record<string, any>): { subject: string; text: string };
export function buildMessage(o: { from: string; to: string[]; subject: string; text: string; now?: Date }): string;
export function sendMail(settings: Extract<ReturnType<typeof smtpSettings>, { ok: true }>, message: { subject: string; text: string }): Promise<{ sent: boolean; recipients: number }>;
