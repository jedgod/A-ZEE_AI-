// src/server.ts
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Pool, PoolClient } from 'pg';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

type AuthRequest = Request & { userId?: string; role?: string; planId?: string };
type Entitlement = { enabled: boolean; monthly_limit: number | null };

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = /^Bearer (.+)$/i.exec(req.header('authorization') ?? '')?.[1];
  if (!token) {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  try {
    const claims = jwt.verify(token, jwtSecret!, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER ?? 'subscription-access',
      audience: process.env.JWT_AUDIENCE ?? 'subscription-api',
    }) as JwtPayload;

    if (typeof claims.sub !== 'string') throw new Error('Missing subject');

    const result = await db.query(
      'SELECT id, role FROM users WHERE id = $1 AND disabled_at IS NULL',
      [claims.sub]
    );
    if (!result.rowCount) {
      res.status(401).json({ error: 'ACCOUNT_UNAVAILABLE' });
      return;
    }
    req.userId = result.rows[0].id;
    req.role = result.rows[0].role;
    next();
  } catch (e) {
    if (
      e instanceof jwt.JsonWebTokenError ||
      e instanceof jwt.TokenExpiredError ||
      (e instanceof Error && e.message === 'Missing subject')
    ) {
      res.status(401).json({ error: 'INVALID_TOKEN' });
      return;
    }
    next(e);
  }
}

function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.role !== role) {
      res.status(403).json({ error: 'FORBIDDEN', requiredRole: role });
      return;
    }
    next();
  };
}

async function resolvePlan(client: Pool | PoolClient, userId: string): Promise<string> {
  const result = await client.query(
    `SELECT s.plan_id
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id AND p.active = true
     WHERE s.user_id = $1
       AND s.status IN ('active', 'trialing')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.plan_id ?? 'free';
}

async function entitlement(
  client: Pool | PoolClient,
  userId: string,
  feature: string
): Promise<Entitlement & { planId: string }> {
  const planId = await resolvePlan(client, userId);
  const result = await client.query(
    'SELECT enabled, monthly_limit FROM plan_entitlements WHERE plan_id = $1 AND feature = $2',
    [planId, feature]
  );
  const row = result.rows[0] ?? { enabled: false, monthly_limit: null };
  return { ...row, planId };
}

function requireFeature(feature: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const grant = await entitlement(db, req.userId!, feature);
      req.planId = grant.planId;
      if (!grant.enabled) {
        await db.query(
          'INSERT INTO access_audit (user_id, feature, decision, plan_id) VALUES ($1, $2, $3, $4)',
          [req.userId, feature, 'upgrade_required', grant.planId]
        );
        res.status(403).json({ error: 'UPGRADE_REQUIRED', feature, plan: grant.planId });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

async function consumeQuota(
  userId: string,
  feature: string
): Promise<{ ok: true } | { ok: false; reason: 'UPGRADE_REQUIRED' | 'QUOTA_EXCEEDED' }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const grant = await entitlement(client, userId, feature);
    if (!grant.enabled) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'UPGRADE_REQUIRED' };
    }
    if (grant.monthly_limit === null) {
      await client.query('COMMIT');
      return { ok: true };
    }

    const result = await client.query(
      `INSERT INTO usage_counters (user_id, feature, period_start, used)
       VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1)
       ON CONFLICT (user_id, feature, period_start)
       DO UPDATE SET used = usage_counters.used + 1
       WHERE usage_counters.used < $3
       RETURNING used`,
      [userId, feature, grant.monthly_limit]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'QUOTA_EXCEEDED' };
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/me/access', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const planId = await resolvePlan(db, req.userId!);
    const { rows } = await db.query(
      'SELECT feature, enabled, monthly_limit FROM plan_entitlements WHERE plan_id = $1',
      [planId]
    );
    const planRow = await db.query('SELECT display_name, base_price_usd, interval FROM plans WHERE id = $1', [planId]);
    res.json({
      plan: planId,
      planName: planRow.rows[0]?.display_name,
      entitlements: rows,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/plans', async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, display_name, description, base_price_usd, interval
       FROM plans WHERE active = true ORDER BY sort_order`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.get('/api/articles/basic', authenticate, requireFeature('basic_articles'), (_req, res) =>
  res.json({ title: 'Basic information', body: 'Accessible with the basic_articles entitlement.' })
);

app.get('/api/articles/premium', authenticate, requireFeature('premium_articles'), (_req, res) =>
  res.json({ title: 'Premium information', body: 'Protected server-side premium content.' })
);

app.post('/api/reports', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const allowed = await consumeQuota(req.userId!, 'ai_reports');
    if (!allowed.ok) {
      res.status(allowed.reason === 'QUOTA_EXCEEDED' ? 429 : 403).json({ error: allowed.reason });
      return;
    }
    res.status(202).json({ status: 'accepted', message: 'Report quota reserved; integrate your report worker here.' });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/users', authenticate, requireRole('admin'), async (_req, res, next) => {
  try {
    const result = await db.query('SELECT id, email, role FROM users ORDER BY email LIMIT 100');
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/subscriptions/pending', authenticate, requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.user_id, u.email, s.plan_id, p.display_name AS plan_name,
             s.status, s.created_at, s.provider, s.provider_subscription_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/admin/subscriptions/:id/activate', authenticate, requireRole('admin'), async (req, res, next) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const result = await client.query(
      `UPDATE subscriptions
       SET status = 'active',
           current_period_start = COALESCE(current_period_start, now()),
           current_period_end = COALESCE(current_period_end, now() + interval '1 month'),
           updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, user_id, plan_id, status`,
      [id]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PENDING_SUBSCRIPTION_NOT_FOUND' });
      return;
    }
    await client.query('COMMIT');
    res.json({ activated: result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

app.post('/api/webhooks/billing', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('Billing webhook received (signature verification not implemented)');
  res.status(200).json({ received: true });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Subscription API listening on :${port}`));
