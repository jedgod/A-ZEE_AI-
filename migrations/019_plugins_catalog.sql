-- 019: Gmail connector, and the Plugins sidebar item opens the connectors catalog.

ALTER TABLE connector_accounts DROP CONSTRAINT IF EXISTS connector_accounts_provider_check;
ALTER TABLE connector_accounts ADD CONSTRAINT connector_accounts_provider_check CHECK (provider IN ('github', 'google_drive', 'gmail'));
ALTER TABLE connector_oauth_states DROP CONSTRAINT IF EXISTS connector_oauth_states_provider_check;
ALTER TABLE connector_oauth_states ADD CONSTRAINT connector_oauth_states_provider_check CHECK (provider IN ('github', 'google_drive', 'gmail'));

-- Staff manage governed extensions from the catalog's Skills tab (/connectors?tab=skills).
UPDATE sidebar_items SET href = '/connectors' WHERE id = 'plugins' AND href = '/extensions';
