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
  });
}

describe("Slack multi-channel subscriptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks the same package separately via DM and an explicit channel", async () => {
    const responseMessages: string[] = [];
    vi.stubGlobal("fetch", createFetchMock(responseMessages));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "patch",
      userId: "U_ALICE",
    });

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "minor",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    // Re-tracking same channel with same threshold → "already tracking"
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
    expect(subscriptions.some((sub) => sub.userId === "U_ALICE" && sub.minUpdateType === "patch" && !sub.channelId)).toBe(true);
    expect(
      subscriptions.some(
        (sub) =>
          sub.channelId === "C_FRONTEND" &&
          sub.channelName === "frontend" &&
          sub.minUpdateType === "minor",
      ),
    ).toBe(true);

    expect(responseMessages).toEqual([
      "Already tracking *react* — currently at *19.0.0* in *#frontend* [minor+]",
    ]);
  });

  it("updates threshold in place when re-tracking with a different minUpdateType", async () => {
    const responseMessages: string[] = [];
    vi.stubGlobal("fetch", createFetchMock(responseMessages));

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "patch",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    await t.action(internal.slack.commands.processNpmTrack, {
      packageName: "react",
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      minUpdateType: "major",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    const subscriptions = await t.query(internal.subscriptions.getBySubscriber, { subscriberId });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].minUpdateType).toBe("major");
    expect(responseMessages[0]).toContain("Updated: now tracking *react*");
    expect(responseMessages[0]).toContain("[major only]");
  });

  it("untracking without a channel removes only the user's DM subscription, not channel subscriptions", async () => {
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
      userId: "U_ALICE",
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
      userId: "U_ALICE",
    });

    const subscriptions = await t.query(internal.subscriptions.getByPackageAndSubscriber, {
      packageId,
      subscriberId,
    });

    // Only Alice's DM subscription is removed; the channel subscription remains
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].channelId).toBe("C_FRONTEND");
  });

  it("lists subscriptions grouped by destination, showing only the invoking user's DM subscriptions", async () => {
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

    // Alice's DM subscription
    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "patch",
      userId: "U_ALICE",
    });

    // Bob's DM subscription (should NOT appear in Alice's list)
    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "patch",
      userId: "U_BOB",
    });

    // Channel subscription (visible to everyone)
    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "minor",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    await t.action(internal.slack.commands.processList, {
      teamId: TEAM_ID,
      responseUrl: RESPONSE_URL,
      userId: "U_ALICE",
    });

    expect(responseMessages).toHaveLength(1);
    // Alice sees 2 subscriptions: her DM + the channel (not Bob's DM)
    expect(responseMessages[0]).toContain("📦 Tracking *1* package across *2* subscriptions:");
    expect(responseMessages[0]).toContain("💬 *Your DMs*");
    expect(responseMessages[0]).toContain("📣 *#frontend*");
    expect(responseMessages[0]).toContain(
      "    • *<https://www.npmjs.com/package/react|react>* — <https://github.com/facebook/react/releases|19.0.0>",
    );
    expect(responseMessages[0]).toContain(
      "    • *<https://www.npmjs.com/package/react|react>* — <https://github.com/facebook/react/releases|19.0.0> [minor+]",
    );
    expect(responseMessages[0]).not.toContain("U_BOB");
    expect(responseMessages[0]).not.toContain("##frontend");
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
