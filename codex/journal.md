# journal
- 2025-10-23: automation mode enabled; use Decision Policy on ambiguity.
- 2025-10-24: attempted to wire CLI directly to new vc-core module while simultaneously adding hydrate/merge; hit ABI issues (better-sqlite3 rebuild), type mismatches, and ended without working hydrate/merge. Lesson learned: finish/refine vc-core API + tests first, then layer CLI/server on top. CLI currently reverted to REST-era behaviour.
- 2025-10-24 (later): confirmed `vc init` vertical slice is solid (works in empty and populated dirs). Treat this path as stable while refactoring vc-core; regressions here should be avoided.
