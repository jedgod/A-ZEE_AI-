export const IDENTITIES: { name: string; kind: "server" | "client"; sans?: string[] }[];
export function pki(dir: string, opts?: { serverDays?: number; clientDays?: number; renewFraction?: number; crlDays?: number }): {
  init(): void;
  rotate(now?: number): { identity: string; action: string; reason?: string; serial?: string; validTo: string }[];
  revoke(name: string, o?: { reissue?: boolean }): { revoked: string; reissued: boolean };
  status(now?: number): { identity: string; validTo?: string; remainingFraction?: number; expired?: boolean; missing?: boolean; fingerprint256?: string }[];
  refreshCrl(): void; publish(): void; opt: Record<string, number>;
};
