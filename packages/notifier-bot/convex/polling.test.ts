import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TEAM_ID = "T_TEST";

async function seedWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.subscribers.upsertSlackWorkspace, {
    accessToken: "xoxb-test-token",
    botUserId: "B_TEST",
    teamId: TEAM_ID,
    teamName: "Test Workspace",
  });
}

function makeNpmFetch(versions: Record<string, string>) {
  // versions: { [packageName]: latestVersion }
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://registry.npmjs.org/")) {
      const pkg = url.replace("https://registry.npmjs.org/", "").split("/")[0];
      const latest = versions[decodeURIComponent(pkg)] ?? "1.0.0";
      return new Response(
        JSON.stringify({
          "dist-tags": { latest },
          repository: `github:test/${pkg}`,
          versions: { "1.0.0": {}, [latest]: {} },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (url === "https://slack.com/api/chat.postMessage") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe("polling", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("sends a DM notification when a tracked package has an update", async () => {
    const fetchMock = makeNpmFetch({ react: "19.0.0" });
    vi.stubGlobal("fetch", fetchMock);

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
      userId: "U_ALICE",
    });

    await t.action(internal.polling.checkForUpdates, {});

    // Package version should be updated
    const pkg = await t.query(internal.packages.getByName, { name: "react" });
    expect(pkg?.currentVersion).toBe("19.0.0");

    // lastNotifiedVersion should be stamped
    const subs = await t.query(internal.subscriptions.getBySubscriber, { subscriberId });
    expect(subs[0].lastNotifiedVersion).toBe("19.0.0");

    // DM should have been sent (chat.postMessage called)
    const postCalls = fetchMock.mock.calls.filter(([input]: [string | URL | Request]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url === "https://slack.com/api/chat.postMessage";
    });
    expect(postCalls.length).toBeGreaterThan(0);
  });

  it("does not notify when update type is below the subscription threshold", async () => {
    const fetchMock = makeNpmFetch({ react: "18.3.0" }); // patch update
    vi.stubGlobal("fetch", fetchMock);

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
      minUpdateType: "major", // only wants major updates
      userId: "U_ALICE",
    });

    await t.action(internal.polling.checkForUpdates, {});

    // lastNotifiedVersion should NOT be updated — threshold not met
    const subs = await t.query(internal.subscriptions.getBySubscriber, { subscriberId });
    expect(subs[0].lastNotifiedVersion).toBe("18.2.0");

    const postCalls = fetchMock.mock.calls.filter(([input]: [string | URL | Request]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url === "https://slack.com/api/chat.postMessage";
    });
    expect(postCalls).toHaveLength(0);
  });

  it("notifies both DM and channel subscribers independently", async () => {
    const fetchMock = makeNpmFetch({ react: "19.0.0" });
    vi.stubGlobal("fetch", fetchMock);

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
      userId: "U_ALICE",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "18.2.0",
      minUpdateType: "patch",
      channelId: "C_FRONTEND",
      channelName: "frontend",
    });

    await t.action(internal.polling.checkForUpdates, {});

    // Both subscriptions should be stamped
    const subs = await t.query(internal.subscriptions.getBySubscriber, { subscriberId });
    expect(subs.every((s) => s.lastNotifiedVersion === "19.0.0")).toBe(true);

    // Two separate chat.postMessage calls (one DM, one channel)
    const postCalls = fetchMock.mock.calls.filter(([input]: [string | URL | Request]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url === "https://slack.com/api/chat.postMessage";
    });
    expect(postCalls).toHaveLength(2);
  });

  it("does not notify when package is already up to date", async () => {
    const fetchMock = makeNpmFetch({ react: "19.0.0" });
    vi.stubGlobal("fetch", fetchMock);

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: "react",
      version: "19.0.0",
      ecosystem: "npm",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "19.0.0",
      minUpdateType: "patch",
      userId: "U_ALICE",
    });

    await t.action(internal.polling.checkForUpdates, {});

    const postCalls = fetchMock.mock.calls.filter(([input]: [string | URL | Request]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url === "https://slack.com/api/chat.postMessage";
    });
    expect(postCalls).toHaveLength(0);
  });
});
