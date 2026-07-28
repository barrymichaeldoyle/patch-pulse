import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('legacy release-check cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes queued enrichment data and its Slack artifacts without enriching the message', async () => {
    const slackCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        slackCalls.push(url);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const t = convexTest(schema, modules);
    const subscriberId = await t.mutation(
      internal.subscribers.upsertSlackWorkspace,
      {
        accessToken: 'xoxb-test-token',
        botUserId: 'B_TEST',
        teamId: 'T_TEST',
        teamName: 'Test Workspace',
      },
    );

    const checkId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('pendingReleaseChecks', {
        subscriberId,
        channelId: 'C_UPDATES',
        messageTs: '111.222',
        fullText: 'legacy update',
        retryCount: 1,
        commentTs: '333.444',
        currentReaction: 'hourglass_flowing_sand',
      });
      await ctx.db.insert('pendingReleaseCheckPackages', {
        checkId: id,
        packageIndex: 0,
        name: 'react',
        fromVersion: '18.2.0',
        toVersion: '19.0.0',
        updateType: 'major',
        originalLine: 'legacy update',
        lineStatus: 'pending',
        summaryStatus: 'pending',
      });
      return id;
    });

    await t.action(internal.releaseChecks.retry, { checkId });

    expect(slackCalls).toEqual([
      'https://slack.com/api/chat.delete',
      'https://slack.com/api/reactions.remove',
    ]);

    const remaining = await t.run(async (ctx) => ({
      check: await ctx.db.get(checkId),
      packages: await ctx.db
        .query('pendingReleaseCheckPackages')
        .withIndex('by_check_id_and_package_index', (q) =>
          q.eq('checkId', checkId),
        )
        .collect(),
    }));
    expect(remaining).toEqual({ check: null, packages: [] });
  });
});
