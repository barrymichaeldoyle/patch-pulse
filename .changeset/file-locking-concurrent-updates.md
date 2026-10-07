---
'patch-pulse': patch
---

Lock `package.json` and `pnpm-workspace.yaml` while applying updates so concurrent patch-pulse runs against the same workspace queue instead of overwriting each other's changes.
