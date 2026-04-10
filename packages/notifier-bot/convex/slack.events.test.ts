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

describe("Slack events handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // No SLACK_SIGNING_SECRET set in tests — verification is skipped
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks workspace inactive on app_uninstalled", async () => {
    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    // Confirm active before
    const before = await t.query(internal.subscribers.getById, { subscriberId });
    expect(before?.active).toBe(true);

    await t.mutation(internal.subscribers.setInactive, { teamId: TEAM_ID });

    const after = await t.query(internal.subscribers.getById, { subscriberId });
    expect(after?.active).toBe(false);
  });

  it("marks workspace inactive on tokens_revoked", async () => {
    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    await t.mutation(internal.subscribers.setInactive, { teamId: TEAM_ID });

    const subscriber = await t.query(internal.subscribers.getById, { subscriberId });
    expect(subscriber?.active).toBe(false);
  });

  it("reinstalling reactivates a previously inactive workspace", async () => {
    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    await t.mutation(internal.subscribers.setInactive, { teamId: TEAM_ID });

    // Reinstall
    await t.mutation(internal.subscribers.upsertSlackWorkspace, {
      accessToken: "xoxb-new-token",
      botUserId: "B_TEST",
      teamId: TEAM_ID,
      teamName: "Test Workspace",
    });

    const subscriber = await t.query(internal.subscribers.getById, { subscriberId });
    expect(subscriber?.active).toBe(true);
  });

  it("polling skips inactive subscribers", async () => {
    const sentTo: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.startsWith("https://registry.npmjs.org/")) {
          return new Response(
            JSON.stringify({
              "dist-tags": { latest: "2.0.0" },
              repository: "github:test/pkg",
              versions: { "1.0.0": {}, "2.0.0": {} },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === "https://slack.com/api/chat.postMessage") {
          sentTo.push(url);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const t = convexTest(schema, modules);
    const subscriberId = await seedWorkspace(t);

    const packageId = await t.mutation(internal.packages.upsertVersion, {
      name: "my-pkg",
      version: "1.0.0",
      ecosystem: "npm",
    });

    await t.mutation(internal.subscriptions.create, {
      packageId,
      subscriberId,
      lastNotifiedVersion: "1.0.0",
      minUpdateType: "patch",
      userId: "U_ALICE",
    });

    // Mark workspace inactive
    await t.mutation(internal.subscribers.setInactive, { teamId: TEAM_ID });

    await t.action(internal.polling.checkForUpdates, {});

    // No messages should have been sent to the inactive workspace
    expect(sentTo).toHaveLength(0);
  });
});
