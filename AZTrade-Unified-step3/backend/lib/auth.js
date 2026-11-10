import { query } from './db.js';
import { authenticateAzee } from './identity.js';

export async function authMiddleware(req, res, next) {
  try {
    if (process.env.AUTH_MODE !== 'jwt') return res.status(503).json({error:'Authentication disabled'});
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({error:'Bearer token required'});
    const identity = await authenticateAzee(match[1]);
    // SECURITY DEFINER function must be installed by migration owner, execute granted ONLY to app role.
    const {rows} = await query('SELECT * FROM aztrade_provision_identity($1,$2,$3)', [identity.sub, identity.tenant_id, identity.tier]);
    if (rows.length !== 1) throw new Error('Provisioning failed');
    req.user = {...rows[0], tier: identity.tier, _authMode:'jwt'};
    next();
  } catch (error) {
    console.error('AZTrade identity refused:', error.message);
    res.status(401).json({error:'Unauthorized'});
  }
}
export function requireTier(minTier) {
  const rank = {free:0, plus:1, premium:2};
  return (req,res,next) => Object.hasOwn(rank,minTier) && Object.hasOwn(rank,req.user?.tier) && rank[req.user.tier] >= rank[minTier] ? next() : res.status(403).json({error:'Subscription required', required:minTier, current:req.user?.tier || 'free'});
}
