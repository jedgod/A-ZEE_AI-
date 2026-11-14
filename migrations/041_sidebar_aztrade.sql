-- 041: AZTrade in the main sidebar group (configurable like the other items; disable it with
-- UPDATE sidebar_items SET enabled = false WHERE id = 'aztrade').
INSERT INTO sidebar_items (id, group_id, label, icon, href, badge, enabled, sort_order)
VALUES ('aztrade', 'main', 'AZTrade', 'candlestick', '/aztrade', 'Paper', true, 3)
ON CONFLICT (id) DO NOTHING;
