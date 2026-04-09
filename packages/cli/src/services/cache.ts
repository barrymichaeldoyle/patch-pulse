import { PackageVersionCache } from '@patch-pulse/shared';

export const packageCache = new PackageVersionCache({
  defaultTtlMs: 5 * 60 * 1000,
  ttlByPackageName: {
    'patch-pulse': 60 * 60 * 1000,
  },
});
