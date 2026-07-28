import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('packages', () => {
  it('returns never-checked packages once through the last-checked index', async () => {
    const t = convexTest(schema, modules);

    const [neverCheckedId, dueId, futureId] = await t.run(async (ctx) => {
      const neverChecked = await ctx.db.insert('packages', {
        name: 'never-checked',
        currentVersion: '1.0.0',
        ecosystem: 'npm',
      });
      const due = await ctx.db.insert('packages', {
        name: 'due',
        currentVersion: '1.0.0',
        ecosystem: 'npm',
        lastChecked: 50,
      });
      const future = await ctx.db.insert('packages', {
        name: 'future',
        currentVersion: '1.0.0',
        ecosystem: 'npm',
        lastChecked: 150,
      });
      return [neverChecked, due, future];
    });

    const packages = await t.query(internal.packages.getDueForCheck, {
      beforeTs: 100,
      limit: 10,
    });
    const ids = packages.map((pkg) => pkg._id);

    expect(ids).toEqual([neverCheckedId, dueId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(futureId);
  });
});
