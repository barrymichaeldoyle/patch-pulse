import { v } from 'convex/values';

const lineStatusValidator = v.union(
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('abandoned'),
);

export const pendingPackageFields = {
  name: v.string(),
  fromVersion: v.string(),
  toVersion: v.string(),
  updateType: v.union(
    v.literal('patch'),
    v.literal('minor'),
    v.literal('major'),
  ),
  originalLine: v.string(),
  lineStatus: lineStatusValidator,
  // Legacy fields remain optional until old queued records have drained.
  summaryStatus: v.optional(v.string()),
  summaryText: v.optional(v.string()),
  summaryFailureDetail: v.optional(v.string()),
  summaryFailureReason: v.optional(v.string()),
  sourceLinks: v.optional(
    v.array(
      v.object({
        label: v.string(),
        url: v.string(),
      }),
    ),
  ),
};

export const pendingPackageValidator = v.object(pendingPackageFields);
