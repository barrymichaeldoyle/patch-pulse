import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const TEAM_ID = 'T_RC_TEST';
const CHANNEL_ID = 'C_UPDATES';
const MESSAGE_TS = '111.222';

async function seedWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.subscribers.upsertSlackWorkspace, {
    accessToken: 'xoxb-test-token',
    botUserId: 'B_TEST',
    teamId: TEAM_ID,
    teamName: 'Test Workspace',
  });
}

const BASE_PACKAGE = {
  name: 'react',
  fromVersion: '18.2.0',
  toVersion: '19.0.0',
  updateType: 'major' as const,
  originalLine: '• react 18.2.0 → 19.0.0 [major]',
  // lineStatus resolved = GitHub URL was known at poll time, no line-text update needed
  lineStatus: 'resolved' as const,
  summaryStatus: 'pending' as const,
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function json404(): Response {
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns a GitHub release response for v19.0.0 with enough body to exceed the 40-char threshold. */
function githubReleaseResponse() {
  return jsonOk({
    html_url: 'https://github.com/test/react/releases/tag/v19.0.0',
    body: 'Introduces the React 19 compiler and resolves long-standing hydration edge cases.',
    tag_name: 'v19.0.0',
    name: 'React 19',
  });
}

function githubCompareResponse() {
  return jsonOk({
    html_url: 'https://github.com/test/react/compare/v18.2.0...v19.0.0',
    commits: [{ commit: { message: 'Ship the compiler by default' } }],
    files: [{ filename: 'packages/react-compiler/index.ts' }],
  });
}

function npmManifestResponse() {
  return jsonOk({
    'dist-tags': { latest: '19.0.0' },
    repository: 'github:test/react',
    versions: { '18.2.0': {}, '19.0.0': {} },
  });
}

function slackOk(ts = '999.000') {
  return jsonOk({ ok: true, ts });
}

describe('releaseChecks.retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('posts a thread summary and deletes the record when GitHub and OpenAI both succeed', async () => {
    const postedMessages: Array<{
      channel: string;
      text: string;
      threadTs?: string;
    }> = [];
    const updatedMessages: Array<{
      channel: string;
      text: string;
      ts: string;
    }> = [];
    const reactionAdds: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();

        if (url.includes('/releases/tags/v19.0.0'))
          return githubReleaseResponse();
        if (url.includes('/releases/tags/')) return json404();
        if (url.includes('/compare/v18.2.0...v19.0.0'))
          return githubCompareResponse();
        if (url.includes('/compare/')) return json404();

        if (url === 'https://api.openai.com/v1/responses') {
          return jsonOk({
            output_text: 'Introduces the compiler and fixes hydration.',
          });
        }

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({
            channel: body.channel,
            text: body.text,
            threadTs: body.thread_ts,
          });
          return slackOk(body.thread_ts ? '333.444' : MESSAGE_TS);
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({
            channel: body.channel,
            text: body.text,
            ts: body.ts,
          });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const pendingReply = postedMessages.find((m) => m.threadTs === MESSAGE_TS);
    expect(pendingReply).toBeDefined();
    expect(pendingReply?.text).toContain('Looking up release notes');

    // Thread reply should have been updated with the summary
    const threadReply = updatedMessages.find((m) => m.ts === '333.444');
    expect(threadReply).toBeDefined();
    expect(threadReply?.text).toContain('📝 *Release summary*');
    expect(threadReply?.text).toContain(
      'Introduces the compiler and fixes hydration.',
    );

    // hourglass_flowing_sand is added by polling before the check record is created,
    // so it is not present in this isolated test. The retry should add memo (ready).
    expect(reactionAdds).toContain('memo');
    expect(reactionAdds).not.toContain('warning');

    // Record should be cleaned up
    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });

  it('abandons all packages and removes the record after all retries exhaust without evidence', async () => {
    const postedMessages: Array<{ channel: string; text: string }> = [];
    const updatedMessages: Array<{
      channel: string;
      text: string;
      ts: string;
    }> = [];
    const reactionAdds: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();
        if (url.startsWith('https://api.github.com/')) return json404();

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({ channel: body.channel, text: body.text });
          return slackOk();
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({
            channel: body.channel,
            text: body.text,
            ts: body.ts,
          });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(postedMessages[0]?.text).toContain('Looking up release notes');
    expect(
      updatedMessages.some((message) =>
        message.text.includes(
          "couldn't assemble enough public release evidence",
        ),
      ),
    ).toBe(true);

    // Final reaction should be warning (abandoned)
    expect(reactionAdds).toContain('warning');
    expect(reactionAdds).not.toContain('memo');

    // Record should be cleaned up
    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });

  it('abandons without a summary when OPENAI_API_KEY is absent', async () => {
    const postedMessages: Array<{ threadTs?: string }> = [];
    const updatedMessages: Array<{ text: string; ts: string }> = [];
    const reactionAdds: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();
        if (url.includes('/releases/tags/v19.0.0'))
          return githubReleaseResponse();
        if (url.includes('/releases/tags/')) return json404();
        if (url.includes('/compare/v18.2.0...v19.0.0'))
          return githubCompareResponse();
        if (url.includes('/compare/')) return json404();

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({ threadTs: body.thread_ts });
          return slackOk();
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({ text: body.text, ts: body.ts });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    // Deliberately NOT stubbing OPENAI_API_KEY

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const threadReplies = postedMessages.filter(
      (m) => m.threadTs === MESSAGE_TS,
    );
    expect(threadReplies).toHaveLength(1);
    expect(
      updatedMessages.some((message) =>
        message.text.includes(
          "couldn't assemble enough public release evidence",
        ),
      ),
    ).toBe(true);

    // Ends in abandoned state
    expect(reactionAdds).toContain('warning');

    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });

  it('falls back to the mini model when nano returns INSUFFICIENT', async () => {
    const postedMessages: Array<{
      channel: string;
      text: string;
      threadTs?: string;
    }> = [];
    const updatedMessages: Array<{ text: string; ts: string }> = [];
    const reactionAdds: string[] = [];
    const openAiModelsUsed: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();
        if (url.includes('/releases/tags/v19.0.0'))
          return githubReleaseResponse();
        if (url.includes('/releases/tags/')) return json404();
        if (url.includes('/compare/v18.2.0...v19.0.0'))
          return githubCompareResponse();
        if (url.includes('/compare/')) return json404();

        if (url === 'https://api.openai.com/v1/responses') {
          const reqBody = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          openAiModelsUsed.push(reqBody.model);
          const isNano = reqBody.model === 'gpt-5-nano';
          return jsonOk({
            output_text: isNano
              ? 'INSUFFICIENT'
              : 'Compiler ships by default; hydration fixes included.',
          });
        }

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({
            channel: body.channel,
            text: body.text,
            threadTs: body.thread_ts,
          });
          return slackOk(body.thread_ts ? '555.666' : MESSAGE_TS);
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({ text: body.text, ts: body.ts });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // Both models should have been tried
    expect(openAiModelsUsed).toContain('gpt-5-nano');
    expect(openAiModelsUsed).toContain('gpt-5-mini');

    expect(postedMessages.some((m) => m.threadTs === MESSAGE_TS)).toBe(true);
    const threadReply = updatedMessages.find((m) => m.ts === '555.666');
    expect(threadReply).toBeDefined();
    expect(threadReply?.text).toContain(
      'Compiler ships by default; hydration fixes included.',
    );

    // Final reaction: memo (summary ready)
    expect(reactionAdds).toContain('memo');
    expect(reactionAdds).not.toContain('warning');

    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });

  it('defers summary to the next retry when GitHub evidence is not yet available', async () => {
    const postedMessages: Array<{
      channel: string;
      text: string;
      threadTs?: string;
    }> = [];
    const updatedMessages: Array<{ text: string; ts: string }> = [];
    const reactionAdds: string[] = [];

    // First retry: 2 release-tag lookups + 4 compare combinations = 6 GitHub calls, all 404.
    // Second retry onward: return real data so the summary can be generated.
    let githubCallCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();

        if (url.startsWith('https://api.github.com/')) {
          githubCallCount++;
          if (githubCallCount <= 6) return json404();
          if (url.includes('/releases/tags/v19.0.0'))
            return githubReleaseResponse();
          if (url.includes('/compare/v18.2.0...v19.0.0'))
            return githubCompareResponse();
          return json404();
        }

        if (url === 'https://api.openai.com/v1/responses') {
          return jsonOk({
            output_text: 'Ships the compiler; fixes hydration.',
          });
        }

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({
            channel: body.channel,
            text: body.text,
            threadTs: body.thread_ts,
          });
          return slackOk(body.thread_ts ? '444.555' : MESSAGE_TS);
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({ text: body.text, ts: body.ts });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // GitHub was hit on both attempts
    expect(githubCallCount).toBeGreaterThan(6);

    expect(postedMessages.some((m) => m.threadTs === MESSAGE_TS)).toBe(true);
    const threadReply = updatedMessages.find((m) => m.ts === '444.555');
    expect(threadReply).toBeDefined();
    expect(threadReply?.text).toContain('Ships the compiler; fixes hydration.');

    // Final reaction: memo (summary ready)
    expect(reactionAdds).toContain('memo');
    expect(reactionAdds).not.toContain('warning');

    // Record cleaned up after successful resolution
    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });

  it('abandons cleanly when the OpenAI summary request never resolves', async () => {
    const postedMessages: Array<{ text: string; threadTs?: string }> = [];
    const updatedMessages: Array<{ text: string; ts: string }> = [];
    const reactionAdds: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith('https://registry.npmjs.org/'))
          return npmManifestResponse();
        if (url.includes('/releases/tags/v19.0.0'))
          return githubReleaseResponse();
        if (url.includes('/releases/tags/')) return json404();
        if (url.includes('/compare/v18.2.0...v19.0.0'))
          return githubCompareResponse();
        if (url.includes('/compare/')) return json404();

        if (url === 'https://api.openai.com/v1/responses') {
          return new Promise<Response>(() => {});
        }

        if (url === 'https://slack.com/api/chat.postMessage') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          postedMessages.push({ text: body.text, threadTs: body.thread_ts });
          return slackOk(body.thread_ts ? '777.888' : MESSAGE_TS);
        }

        if (url === 'https://slack.com/api/chat.update') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          updatedMessages.push({ text: body.text, ts: body.ts });
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.add') {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          );
          reactionAdds.push(body.name);
          return slackOk();
        }

        if (url === 'https://slack.com/api/reactions.remove') {
          return slackOk();
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_SUMMARY_TIMEOUT_MS', '1');

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const checkId = await t.mutation(internal.releaseChecks.create, {
      subscriberId,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
      fullText: BASE_PACKAGE.originalLine,
      packages: [BASE_PACKAGE],
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(postedMessages.some((m) => m.threadTs === MESSAGE_TS)).toBe(true);
    expect(
      updatedMessages.some((message) =>
        message.text.includes(
          "couldn't assemble enough public release evidence",
        ),
      ),
    ).toBe(true);
    expect(reactionAdds).toContain('warning');

    const check = await t.query(internal.releaseChecks.get, { checkId });
    expect(check).toBeNull();
  });
});
