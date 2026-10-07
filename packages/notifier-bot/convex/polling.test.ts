import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const TEAM_ID = 'T_TEST';

async function seedWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.subscribers.upsertSlackWorkspace, {
    accessToken: 'xoxb-test-token',
    botUserId: 'B_TEST',
    teamId: TEAM_ID,
    teamName: 'Test Workspace',
  });
}

function makeNpmFetch(versions: Record<string, string>) {
  // versions: { [packageName]: latestVersion }
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith('https://registry.npmjs.org/')) {
      const pkg = url.replace('https://registry.npmjs.org/', '').split('/')[0];
      const latest = versions[decodeURIComponent(pkg)] ?? '1.0.0';
      const etag = `"etag-${pkg}-${latest}"`;
      const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      return new Response(
        JSON.stringify({
          'dist-tags': { latest },
          repository: `github:test/${pkg}`,
          versions: { '1.0.0': {}, [latest]: {} },
        }),
        { headers: { 'Content-Type': 'application/json', ETag: etag } },
      );
    }

    if (url === 'https://slack.com/api/chat.postMessage') {
      return new Response(JSON.stringify({ ok: true, ts: '123.456' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (
      url === 'https://slack.com/api/reactions.add' ||
      url === 'https://slack.com/api/reactions.remove' ||
      url === 'https://slack.com/api/chat.update'
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe('polling', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('sends a DM notification when a tracked package has an update', async () => {
    const fetchMock = makeNpmFetch({ react: '19.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'patch',
      userId: 'U_ALICE',
    });

    await t.action(internal.polling.checkForUpdates, {});

    // Package version should be updated
    const pkg = await t.query(internal.packages.getByName, { name: 'react' });
    expect(pkg?.currentVersion).toBe('19.0.0');

    // lastNotifiedVersion should be stamped
    const subs = await t.query(internal.subscriptions.getBySubscriber, {
      subscriberId,
    });
    expect(subs[0].lastNotifiedVersion).toBe('19.0.0');

    // DM should have been sent (chat.postMessage called)
    const postCalls = fetchMock.mock.calls.filter(
      ([input]: [string | URL | Request, RequestInit?]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        return url === 'https://slack.com/api/chat.postMessage';
      },
    );
    expect(postCalls.length).toBeGreaterThan(0);
  });

  it('stores the registry ETag and sends it as If-None-Match on the next poll', async () => {
    const fetchMock = makeNpmFetch({ react: '18.2.0' }); // already up to date
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });

    await t.action(internal.polling.checkForUpdates, {});

    const pkg = await t.query(internal.packages.getByName, { name: 'react' });
    expect(pkg?.etag).toBe('"etag-react-18.2.0"');
    expect(pkg?.currentVersion).toBe('18.2.0');

    // Second poll must be conditional and get a 304 back.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    try {
      await t.action(internal.polling.checkForUpdates, {});
    } finally {
      vi.useRealTimers();
    }

    const registryCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('https://registry.npmjs.org/'),
    );
    expect(registryCalls).toHaveLength(2);
    expect(new Headers(registryCalls[0][1]?.headers).get('If-None-Match')).toBe(
      null,
    );
    expect(new Headers(registryCalls[1][1]?.headers).get('If-None-Match')).toBe(
      '"etag-react-18.2.0"',
    );

    const after = await t.query(internal.packages.getByName, { name: 'react' });
    expect(after?.currentVersion).toBe('18.2.0');
    expect(after?.etag).toBe('"etag-react-18.2.0"');
    expect(after?.lastChecked).toBeGreaterThan(pkg?.lastChecked ?? 0);
  });

  it('still detects a new version when a stale ETag no longer matches', async () => {
    const fetchMock = makeNpmFetch({ react: '19.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);
    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
      etag: '"etag-react-18.2.0"',
    });
    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'patch',
      userId: 'U_ALICE',
    });

    await t.action(internal.polling.checkForUpdates, {});

    const pkg = await t.query(internal.packages.getByName, { name: 'react' });
    expect(pkg?.currentVersion).toBe('19.0.0');
    expect(pkg?.etag).toBe('"etag-react-19.0.0"');
  });

  it('does not notify when update type is below the subscription threshold', async () => {
    const fetchMock = makeNpmFetch({ react: '18.3.0' }); // patch update
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'major', // only wants major updates
      userId: 'U_ALICE',
    });

    await t.action(internal.polling.checkForUpdates, {});

    // lastNotifiedVersion should NOT be updated — threshold not met
    const subs = await t.query(internal.subscriptions.getBySubscriber, {
      subscriberId,
    });
    expect(subs[0].lastNotifiedVersion).toBe('18.2.0');

    const postCalls = fetchMock.mock.calls.filter(
      ([input]: [string | URL | Request, RequestInit?]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        return url === 'https://slack.com/api/chat.postMessage';
      },
    );
    expect(postCalls).toHaveLength(0);
  });

  it('notifies both DM and channel subscribers independently', async () => {
    const fetchMock = makeNpmFetch({ react: '19.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'patch',
      userId: 'U_ALICE',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'patch',
      channelId: 'C_FRONTEND',
      channelName: 'frontend',
    });

    await t.action(internal.polling.checkForUpdates, {});

    // Both subscriptions should be stamped
    const subs = await t.query(internal.subscriptions.getBySubscriber, {
      subscriberId,
    });
    expect(subs.every((s) => s.lastNotifiedVersion === '19.0.0')).toBe(true);

    // Two separate chat.postMessage calls (one DM, one channel)
    const postCalls = fetchMock.mock.calls.filter(
      ([input]: [string | URL | Request, RequestInit?]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        return url === 'https://slack.com/api/chat.postMessage';
      },
    );
    expect(postCalls).toHaveLength(2);
  });

  it('does not notify when package is already up to date', async () => {
    const fetchMock = makeNpmFetch({ react: '19.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '19.0.0',
      ecosystem: 'npm',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '19.0.0',
      minUpdateType: 'patch',
      userId: 'U_ALICE',
    });

    await t.action(internal.polling.checkForUpdates, {});

    const postCalls = fetchMock.mock.calls.filter(
      ([input]: [string | URL | Request, RequestInit?]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        return url === 'https://slack.com/api/chat.postMessage';
      },
    );
    expect(postCalls).toHaveLength(0);
  });

  it('sends one final notification without queuing delayed enrichment', async () => {
    const fetchMock = makeNpmFetch({ react: '19.0.0' });
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: '18.2.0',
      minUpdateType: 'patch',
      userId: 'U_ALICE',
    });

    await t.action(internal.polling.checkForUpdates, {});

    const postCalls = fetchMock.mock.calls.filter(([input]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      return url === 'https://slack.com/api/chat.postMessage';
    });
    expect(postCalls).toHaveLength(1);

    const pendingChecks = await t.run(async (ctx) =>
      ctx.db.query('pendingReleaseChecks').collect(),
    );
    expect(pendingChecks).toEqual([]);
  });
});
