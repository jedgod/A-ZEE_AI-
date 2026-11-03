-- Pro tiers renamed to match components/pricing-plans.tsx:
-- pro100 -> pro25 ("Pro 25"), pro200 -> pro60 ("Pro 60"), pro500 shown as "Pro 250".
-- Primary keys are referenced, so copy each plan to its new id, repoint references, then remove the old row.

INSERT INTO plans (id, name, base_price_usd, interval, features, is_active, annual_price_usd, best_for, popular, sort_order)
SELECT 'pro25', 'Pro 25', base_price_usd, interval, features, is_active, annual_price_usd, best_for, popular, sort_order
FROM plans WHERE id = 'pro100' ON CONFLICT (id) DO NOTHING;
INSERT INTO plans (id, name, base_price_usd, interval, features, is_active, annual_price_usd, best_for, popular, sort_order)
SELECT 'pro60', 'Pro 60', base_price_usd, interval, features, is_active, annual_price_usd, best_for, popular, sort_order
FROM plans WHERE id = 'pro200' ON CONFLICT (id) DO NOTHING;

INSERT INTO usage_limits (plan_id, feature, monthly_limit)
SELECT CASE plan_id WHEN 'pro100' THEN 'pro25' ELSE 'pro60' END, feature, monthly_limit
FROM usage_limits WHERE plan_id IN ('pro100', 'pro200') ON CONFLICT (plan_id, feature) DO NOTHING;

UPDATE subscriptions SET plan_id = 'pro25' WHERE plan_id = 'pro100';
UPDATE subscriptions SET plan_id = 'pro60' WHERE plan_id = 'pro200';
UPDATE users SET plan = 'pro25' WHERE plan = 'pro100';
UPDATE users SET plan = 'pro60' WHERE plan = 'pro200';

DELETE FROM plans WHERE id IN ('pro100', 'pro200');
UPDATE plans SET name = 'Pro 250' WHERE id = 'pro500';
UPDATE plans SET features = '["Much higher reasoning and research limits", "AZee Connect for VS Code and other editors", "Higher code-mode limits"]'
WHERE id = 'pro25';
UPDATE plans SET features = '["Higher Pro limits", "Longer conversations kept in context", "Everything in Pro 25"]'
WHERE id = 'pro60';
UPDATE plans SET features = '["Unlimited messages, reasoning, and research", "Everything in Pro 60"]'
WHERE id = 'pro500';
