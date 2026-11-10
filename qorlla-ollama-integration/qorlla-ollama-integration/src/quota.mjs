export async function reserveQuota(pool,tenantId,limit){
  const day=new Date().toISOString().slice(0,10);
  const r=await pool.query(`INSERT INTO ai_private_daily_usage (tenant_id,usage_day,requests)
    VALUES ($1,$2,1) ON CONFLICT (tenant_id,usage_day)
    DO UPDATE SET requests=ai_private_daily_usage.requests+1
    WHERE ai_private_daily_usage.requests < $3 RETURNING requests`,[tenantId,day,limit]);
  return r.rowCount===1?day:null;
}
export async function refundQuota(pool,tenantId,day){
  await pool.query('UPDATE ai_private_daily_usage SET requests=GREATEST(0,requests-1) WHERE tenant_id=$1 AND usage_day=$2',[tenantId,day]);
}
