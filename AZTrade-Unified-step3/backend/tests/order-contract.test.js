import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
// Static contract checks (no database needed). They prove the shape of the code; the PostgreSQL certification
// suite (cert-*.test.js) proves the behaviour.
const read=(rel)=>readFileSync(new URL(rel,import.meta.url),'utf8');
const paper=read('../routes/paper.js');
const rls=read('../sql/migrations/004_tenant_rls.sql');
const integrity=read('../sql/migrations/005_financial_integrity.sql');
const posting=read('../sql/migrations/007_posting_procedure_and_reconciliation.sql');
const provenance=read('../sql/migrations/006_market_data_provenance.sql');
const grants=read('../sql/roles/app_grants.sql');

test('paper execution requires certification switch',()=>assert.match(paper,/AZTRADE_PAPER_EXECUTION_CERTIFIED/));
test('the route posts only through the database procedure and never writes money tables itself',()=>{
 assert.match(paper,/aztrade_place_paper_order/);
 assert.doesNotMatch(paper,/UPDATE\s+paper_accounts|INSERT\s+INTO\s+paper_(orders|ledger|positions)|DELETE\s+FROM\s+paper_/i);
 assert.doesNotMatch(paper,/Number\(|parseFloat|toFixed/,'no JavaScript floating point near money');
});
test('the posting procedure uses NUMERIC only, one rounding, an account row lock and a pinned search_path',()=>{
 assert.match(posting,/FOR UPDATE/);
 assert.match(posting,/round\(p_shares \* v_price, 8\)/);
 assert.match(posting,/SECURITY DEFINER SET search_path = public, pg_temp/);
 assert.doesNotMatch(posting,/\bfloat|double precision|::real\b/i);
 assert.match(posting,/REVOKE ALL ON FUNCTION aztrade_place_paper_order[^;]+FROM PUBLIC/);
});
test('both ledger entries use the same single-rounded amount and the deferred balance trigger stays in force',()=>{
 assert.equal((posting.match(/v_notional/g)||[]).length>=6,true);
 assert.match(integrity,/DEFERRABLE INITIALLY DEFERRED/);
});
test('the opening balance is recorded, constrained and immutable',()=>{
 assert.match(posting,/ADD COLUMN IF NOT EXISTS opening_cash/);
 assert.match(posting,/opening_cash >= 0/);
 assert.match(posting,/opening_cash is immutable/);
});
test('reconciliation covers cash, fills, ledger, orphans and negatives',()=>{
 for(const name of ['cash','position_vs_fills','position_without_fills','position_vs_ledger','order_posting','orphan_ledger','negative_cash','nonpositive_position'])
  assert.ok(posting.includes(`'${name}'`),`missing check ${name}`);
});
test('the application role is granted no direct write access to money tables',()=>{
 const appBlock=grants.split('-- Provisioning service')[0];
 assert.doesNotMatch(appBlock,/(INSERT|UPDATE|DELETE|TRUNCATE)[^;]*\b(paper_accounts|paper_positions|paper_orders|paper_ledger|market_prices|instruments)\b/);
 assert.match(appBlock,/EXECUTE ON FUNCTION aztrade_place_paper_order/);
 assert.match(appBlock,/GRANT SELECT ON paper_accounts, paper_positions, paper_orders, paper_ledger/);
});
test('RLS enabled and forced',()=>{
 for(const table of ['users','portfolios','holdings','paper_accounts','paper_positions','paper_orders','paper_ledger','alerts','assistant_messages']){
  assert.ok(rls.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  assert.ok(rls.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
 }
});
test('migrations are numbered, contiguous and idempotent-safe to list',()=>{
 const files=readdirSync(new URL('../sql/migrations/',import.meta.url)).filter(f=>/^\d{3}_/.test(f)).sort();
 assert.deepEqual(files.map(f=>f.slice(0,3)),['001','002','003','004','005','006','007','008']);
});

test('execution is gated on a licensed source and every fill records its provenance',()=>{
 assert.match(posting,/ERRCODE = 'T0009'/);
 assert.match(posting,/license_status <> 'licensed' OR NOT v_src\.allows_execution/);
 assert.match(posting,/price_source_id, price_observed_at/);
 assert.match(provenance,/execution_needs_licence/);
 assert.match(provenance,/source_id TEXT NOT NULL DEFAULT 'demo-seed'/,'unregistered or seeded prices default to the non-executable demo source');
 assert.match(provenance,/'demo-seed'[^;]*'demo', false/s);
});
test('the market-data role can write prices but cannot register, relicense or touch money tables',()=>{
 const lines=grants.split('-- Market-data ingestion')[1].split('\n').filter(l=>/^GRANT /.test(l));
 assert.ok(lines.some(l=>/GRANT SELECT, INSERT, UPDATE ON market_prices TO \{\{MARKETDATA_ROLE\}\}/.test(l)));
 for(const l of lines){
  assert.doesNotMatch(l,/(INSERT|UPDATE|DELETE)[^;]*market_data_sources/,'cannot register or relicense a source');
  assert.doesNotMatch(l,/paper_|\busers\b|portfolios|holdings|alerts|assistant/,'cannot touch accounts, orders or the ledger');
 }
});
