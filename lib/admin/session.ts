import "server-only";

export {
  getHostSession as readAdminSession,
  issueSession as createDevSession,
  revokeCurrentSession,
  setSessionCookie,
} from "./host-session";

export type { HostSession as AdminSession } from "./host-session";
