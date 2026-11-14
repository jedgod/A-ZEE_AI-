// Request idempotency and atomic admission are enforced in PostgreSQL, not local process memory.
export async function reserveDailyQuota(db,{userId,scope,requestId,limit}) {
  if(!/^[a-z][a-z_]{2,40}$/.test(scope)||!Number.isInteger(limit)||limit<0||limit>100000||!/^[0-9a-f-]{36}$/i.test(requestId))throw new Error('BAD_QUOTA_REQUEST');
  const r=await db.query('SELECT * FROM aztrade.reserve_daily_quota($1,$2,$3,$4)',[userId,scope,requestId,limit]);
  const row=r.rows[0];if(!row)throw new Error('QUOTA_UNAVAILABLE');
  return {admitted:row.admitted,replay:row.replay,used:row.used};
}
export async function finalizeDailyQuota(db,{userId,scope,requestId,success}){
  await db.query('SELECT aztrade.finalize_daily_quota($1,$2,$3,$4)',[userId,scope,requestId,success]);
}
