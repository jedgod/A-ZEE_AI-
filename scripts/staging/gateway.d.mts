export const decide: (pathname: string) => 200 | 404;
export function createGateway(o: { tlsDir: string; appUrl: string; tradeUrl?: string; log?: (l: string) => void }): import("node:https").Server;

export const tradeRoute: (pathname: string) => boolean;
