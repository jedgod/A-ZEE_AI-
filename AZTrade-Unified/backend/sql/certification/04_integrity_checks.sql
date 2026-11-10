-- Run as a restricted application role after migrations, with tenant context set.
-- Each query must return zero rows to pass.
SELECT order_id, count(*) AS entries,
  sum(amount) FILTER (WHERE entry_type='debit') AS debits,
  sum(amount) FILTER (WHERE entry_type='credit') AS credits
FROM paper_ledger GROUP BY order_id
HAVING count(*)<>2 OR sum(amount) FILTER (WHERE entry_type='debit')
 <> sum(amount) FILTER (WHERE entry_type='credit');
SELECT o.id FROM paper_orders o LEFT JOIN paper_ledger l ON l.order_id=o.id
 WHERE o.status='filled' GROUP BY o.id HAVING count(l.id)<>2;
SELECT account_id,idempotency_key,count(*) FROM paper_orders
 GROUP BY account_id,idempotency_key HAVING count(*)>1;
SELECT id,cash FROM paper_accounts WHERE cash<0;
SELECT id,shares FROM paper_positions WHERE shares<=0;
