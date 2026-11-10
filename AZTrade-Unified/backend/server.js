import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { authMiddleware } from './lib/auth.js';
import { requestDb } from './lib/request-db.js';
import { securityHeaders, auditLog } from './lib/security.js';
import marketsRouter from './routes/markets.js';
import portfolioRouter from './routes/portfolio.js';
import paperRouter from './routes/paper.js';
import assistantRouter from './routes/assistant.js';
import riskRouter from './routes/risk.js';
import strategiesRouter from './routes/strategies.js';

dotenv.config();

// Fail closed: production must not start with stub auth
if (process.env.NODE_ENV === 'production' && (process.env.AUTH_MODE !== 'jwt' || !process.env.AZEE_JWT_ISSUER || !process.env.AZEE_JWT_AUDIENCE || !process.env.AZEE_JWKS_URL || !process.env.AZEE_INTROSPECTION_URL || !process.env.AZEE_INTROSPECTION_TOKEN)) {
  console.error('FATAL: AUTH_MODE must be "jwt" when NODE_ENV=production');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(securityHeaders());

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && process.env.CORS_ORIGIN === '*')) {
      return cb(null, true);
    }
    cb(new Error('CORS not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    auditLog(req, 'request', { bodyKeys: Object.keys(req.body || {}) });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aztrade-api', paperMode: true, liveTrading: false });
});

app.use('/api/markets', marketsRouter);
app.use('/api/portfolio', authMiddleware, requestDb, portfolioRouter);
app.use('/api/paper', authMiddleware, requestDb, paperRouter);
app.use('/api/assistant', authMiddleware, requestDb, assistantRouter);
app.use('/api/risk', authMiddleware, requestDb, riskRouter);
app.use('/api/strategies', authMiddleware, requestDb, strategiesRouter);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  auditLog(req, 'error', { message: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`AZTrade API listening on :${PORT} (paper mode, live trading OFF)`);
});
