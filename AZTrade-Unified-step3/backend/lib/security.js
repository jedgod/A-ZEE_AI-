import helmet from 'helmet';

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });
}

export function auditLog(req, event, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    userId: req.user?.id || null,
    path: req.path,
    method: req.method,
    ip: req.ip,
    ...detail
  };
  // Replace with structured logger / SIEM sink in production
  console.log(JSON.stringify({ audit: entry }));
}
