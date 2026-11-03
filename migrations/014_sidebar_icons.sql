-- 014: Plugins uses the "blocks" icon (grid with a separate tile) from the sidebar design.
UPDATE sidebar_items SET icon = 'blocks' WHERE id = 'plugins' AND icon = 'puzzle';
