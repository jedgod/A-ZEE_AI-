// Schedule every minute. No prompts, replies, tokens or account IDs are logged.
require('@next/env').loadEnvConfig(process.cwd());
const {Client}=require('pg');
const {maintain}=require('./lib/inference-maintenance.cjs');
(async()=>{
 if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL,statement_timeout:30000,connectionTimeoutMillis:5000});
 await db.connect();
 try {console.log(JSON.stringify({event:'inference_maintenance',time:new Date().toISOString(),...await maintain(db)}));}
 finally {await db.end();}
})().catch(e=>{console.error(JSON.stringify({event:'inference_maintenance_failed',message:e.message}));process.exitCode=1;});
