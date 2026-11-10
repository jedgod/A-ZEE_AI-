// Shared by the maintenance worker and disposable-database tests.
const families = [['linqext_requests','linqext_usage'],['aztrade_ai_requests','aztrade_ai_usage']];
async function maintain(db) {
 const stats = {recovered:0,redacted:0,deleted:0};
 await db.query('BEGIN');
 try {
  for (const [requests,usage] of families) {
   const rows = (await db.query(`SELECT user_id,request_id,charged_period FROM ${requests}
    WHERE (status='running' AND created_at < now()-interval '5 minutes') OR (status='failed' AND charged_period IS NOT NULL)
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
   for (const row of rows) {
    if (row.charged_period) {
     const refunded = await db.query(`UPDATE ${usage} SET used=used-1 WHERE user_id=$1 AND period_start=$2 AND used>0`,[row.user_id,row.charged_period]);
     if (refunded.rowCount!==1) throw new Error('Quota reconciliation mismatch; operator investigation required');
    }
    await db.query(`UPDATE ${requests} SET status='failed',charged_period=NULL,attempt_id=gen_random_uuid() WHERE user_id=$1 AND request_id=$2`,[row.user_id,row.request_id]);
    stats.recovered++;
   }
   stats.redacted += (await db.query(`UPDATE ${requests} SET response=NULL WHERE response IS NOT NULL AND created_at<now()-interval '7 days' AND status<>'running'`)).rowCount;
   stats.deleted += (await db.query(`DELETE FROM ${requests} WHERE status<>'running' AND created_at<now()-interval '90 days'`)).rowCount;
  }
  await db.query('COMMIT'); return stats;
 } catch(e) {await db.query('ROLLBACK');throw e;}
}
module.exports={maintain};
