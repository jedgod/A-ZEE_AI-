-- Any rows returned indicate financial integrity failures.
SELECT order_id, account_id,
 SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END) AS imbalance,
 COUNT(*) AS entries
FROM paper_ledger WHERE order_id IS NOT NULL
GROUP BY order_id, account_id
HAVING SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END) <> 0 OR COUNT(*) <> 2;
-- Filled orders without two balanced ledger entries.
SELECT o.id, o.account_id FROM paper_orders o
LEFT JOIN paper_ledger l ON l.order_id=o.id
WHERE o.status='filled' GROUP BY o.id,o.account_id HAVING COUNT(l.id)<>2;
-- Duplicate idempotency keys.
SELECT account_id,idempotency_key,COUNT(*) FROM paper_orders
WHERE idempotency_key IS NOT NULL GROUP BY account_id,idempotency_key HAVING COUNT(*)>1;
