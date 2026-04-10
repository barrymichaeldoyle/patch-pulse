import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TEAM_ID = "T_TEST";
const RESPONSE_URL = "https://example.com/slack/response";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFetchMock(responseMessages: string[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://registry.npmjs.org/")) {
      return jsonResponse({
        "dist-tags": { latest: "19.0.0" },
        repository: "github:facebook/react",
        versions: { "19.0.0": {} },
      });
    }

    if (url === "https://slack.com/api/chat.postMessage") {
      return jsonResponse({ ok: true });
    }

    if (url === RESPONSE_URL) {
      const raw = typeof init?.body === "string" ? init.body : "";
      responseMessages.push(JSON.parse(raw).text);
      return new Response(null, { status: 200 });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

async function seedWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.subscribers.upsertSlackWorkspace, {
    accessToken: "xoxb-test-token",
    botUserId: "B_TEST",
    teamId: TEAM_ID,
    teamName: "Patch Pulse Test",
    webhookUrl: "https://hooks.slack.com/services/T/B/DEFAULT",
    webhookChannel: "#alerts",
    webhookChannelId: "C_DEFAULT",
    webhookConfigurationUrl: "https://slack.com/app_redirect?channel=alerts",
  });
}

describe("Slack multi-channel subscriptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks the same package separately in the default channel and an explicit channel", async () => {
    const responseMessages: string[] = [];
    vi.stubGlobal("fetch", createFetchMock(responseMessages));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "patch",
    });

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "minor",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "minor",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    const subscriptions = await t.query(internal.subscriptions.getBySubscriber, {
      subscriberId,
    });

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.some((sub) => sub.subscriberId === subscriberId && sub.minUpdateType === "patch" && !sub.channelId)).toBe(true);
    expect(
      subscriptions.some(
        (sub) =>
          sub.subscriberId === subscriberId &&
          sub.channelId === "C_FRONTEND" &&
          sub.channelName === "frontend" &&
          sub.minUpdateType === "minor",
      ),
    ).toBe(true);

    expect(responseMessages).toEqual([
      "Already tracking *react* — currently at *19.0.0* in *#frontend* [minor+]",
    ]);
  });

  it("removes all channel subscriptions when untracking without a channel", async () => {
    vi.stubGlobal("fetch", createFetchMock([]));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);
    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: "react",
      version: "19.0.0",
      ecosystem: "npm",
      githubRepoUrl: "https://github.com/facebook/react",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "patch",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "major",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    await t.action(internal.slack.commands.processNpmUntrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
    });

    const subscriptions = await t.query(internal.subscriptions.getByPackageAndSubscriber, {
      packageId,
      subscriberId,
    });

    expect(subscriptions).toHaveLength(0);
  });

  it("lists channel subscriptions with package and channel totals", async () => {
    const responseMessages: string[] = [];
    vi.stubGlobal("fetch", createFetchMock(responseMessages));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);
    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: "react",
      version: "19.0.0",
      ecosystem: "npm",
      githubRepoUrl: "https://github.com/facebook/react",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "patch",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "minor",
      channelId: "C_FRONTEND",
      channelName: "#frontend",
    });

    await t.action(internal.slack.commands.processList, {
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
    });

    expect(responseMessages).toHaveLength(1);
    expect(responseMessages[0]).toContain(
      "📦 Tracking *1* package across *2* channel subscriptions:",
    );
    expect(responseMessages[0]).toContain(
      "📦 Tracking *1* package across *2* channel subscriptions:\n\n\n🏠 *#alerts* (default channel)",
    );
    expect(responseMessages[0]).toContain(
      "    • *<https://www.npmjs.com/package/react|react>* — <https://github.com/facebook/react/releases|19.0.0>\n\n\n📣 *#frontend*",
    );
    expect(responseMessages[0]).toContain("🏠 *#alerts* (default channel)");
    expect(responseMessages[0]).toContain("📣 *#frontend*");
    expect(responseMessages[0]).toContain(
      "    • *<https://www.npmjs.com/package/react|react>* — <https://github.com/facebook/react/releases|19.0.0>",
    );
    expect(responseMessages[0]).toContain(
      "    • *<https://www.npmjs.com/package/react|react>* — <https://github.com/facebook/react/releases|19.0.0> [minor+]",
    );
    expect(responseMessages[0]).not.toContain("##alerts");
    expect(responseMessages[0]).not.toContain("##frontend");
    expect(responseMessages[0]).not.toContain("in *#alerts* (default)");
  });

  it("stores github repo metadata during polling so list can use it later", async () => {
    const responseMessages: string[] = [];
    vi.stubGlobal("fetch", createFetchMock(responseMessages));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);
    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: "react",
      version: "18.2.0",
      ecosystem: "npm",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "18.2.0",
      minUpdateType: "patch",
    });

    await t.action(internal.polling.checkForUpdates, {});

    const pkg = await t.query(internal.packages.getByName, { name: "react" });

    expect(pkg?.githubRepoUrl).toBe("https://github.com/facebook/react");
  });
});
