---
'patch-pulse': minor
---

Honour minimum release age gates. Patch Pulse now mirrors `minimumReleaseAge` (pnpm, bun), `min-release-age` (npm) and `npmMinimalAgeGate` (yarn) so versions too young to install are withheld instead of reported as updates. Configure explicitly with `minimumReleaseAge` / `minimumReleaseAgeExclude` or the `--minimum-release-age` flag.
