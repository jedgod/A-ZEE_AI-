-- Monitors: "Once" vs "Each crossing", the quote time a check used, and a snapshot of the rule on every alert ("Explain this alert").

ALTER TABLE monitor_rules ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'each_crossing'));
-- For "each crossing": whether the rule's condition was met at the last check (NULL = no baseline yet). An alert fires on false -> true.
ALTER TABLE monitor_rules ADD COLUMN IF NOT EXISTS condition_met BOOLEAN;
-- The time the quote itself carries (not every free source provides one).
ALTER TABLE monitor_rules ADD COLUMN IF NOT EXISTS last_quote_as_of TIMESTAMPTZ;

ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS rule_type TEXT;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS threshold NUMERIC(18, 6);
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS recurrence TEXT;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS quote_as_of TIMESTAMPTZ;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS change_pct NUMERIC(12, 4);
