export const decide: (pathname: string) => 200 | 404;
export function createGateway(o: { tlsDir: string; appUrl: string; log?: (l: string) => void }): import("node:https").Server;
