# AZTrade Mobile – Production-ready Design Improvements

## Analysis
- Expo Router screen with theme-aware palette, sections (Overview / AI Research / Portfolio / Markets / Risk / Connections).
- Secure client (`aztrade.ts`) with in-memory token, capability checks, isolated failures.
- Functional but basic: flat cards, simple borders, limited elevation, older chip/tab styling.

## Improvements
- Modern StyleSheet with soft shadows (elevation), refined 16–18px radii, better spacing and typography hierarchy.
- Pill-style tabs, elevated metric cards, polished primary action button.
- Cleaner error/disclaimer states, improved touch targets.
- All original logic, auth, safety, and API behavior preserved.

## Files
- `aztrade-mobile-improved.tsx` → place at `mobile/src/app/(app)/aztrade.tsx`
- `aztrade.ts` → place at `mobile/src/lib/aztrade.ts` (unchanged)
- Apply the two registration edits from the original README.

Keep `AZTRADE_PAPER_EXECUTION_CERTIFIED=false` and all execution flags off.
