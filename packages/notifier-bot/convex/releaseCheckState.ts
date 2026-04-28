import { type Doc } from './_generated/dataModel';
import { v } from 'convex/values';

export const lineStatusValidator = v.union(
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('abandoned'),
);

export const summaryStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('abandoned'),
);

export const summaryFailureReasonValidator = v.union(
  v.literal('missing-openai-key'),
  v.literal('insufficient-public-evidence'),
  v.literal('openai-timeout'),
  v.literal('openai-error'),
  v.literal('npm-manifest-unavailable'),
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
  summaryStatus: summaryStatusValidator,
  summaryText: v.optional(v.string()),
  summaryFailureDetail: v.optional(v.string()),
  summaryFailureReason: v.optional(summaryFailureReasonValidator),
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

export type PendingReleaseCheckPackage = Omit<
  Doc<'pendingReleaseCheckPackages'>,
  '_creationTime' | '_id' | 'checkId' | 'packageIndex'
>;
