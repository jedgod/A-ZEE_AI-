import { createHash, timingSafeEqual } from 'node:crypto';

export const EXECUTION_DISABLED = Object.freeze({
  paper: false, live: false, bot: false, brokerOrders: false,
});
export function denyExecution() {
  const error = new Error('TRADE_EXECUTION_DISABLED'); error.status = 423; throw error;
}
export function assertResearchMode() {
  if (process.env.AZTRADE_RESEARCH_ENABLED !== 'true') {
    const error = new Error('RESEARCH_DISABLED'); error.status = 503; throw error;
  }
}
export function assertLicensedSource(source, purpose, now = new Date()) {
  if (!source || source.active !== true || source.approved !== true) throw new Error('SOURCE_NOT_APPROVED');
  if (source.expiresAt && new Date(source.expiresAt) <= now) throw new Error('SOURCE_LICENSE_EXPIRED');
  if (!['display','historical','paper'].includes(purpose) || !source.grants?.includes(purpose)) throw new Error('SOURCE_PERMISSION_DENIED');
  if (!source.assetClasses?.length) throw new Error('SOURCE_ASSET_CLASS_MISSING');
}
export function sanitizeSymbol(symbol) {
  if (typeof symbol !== 'string' || !/^[A-Z0-9._/-]{1,32}$/.test(symbol)) throw new Error('INVALID_SYMBOL');
  return symbol;
}
export function compareDigest(a,b) {
  const da=createHash('sha256').update(String(a)).digest();
  const db=createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(da,db);
}
export const httpError = (status, code) => Object.assign(new Error(code),{status});
