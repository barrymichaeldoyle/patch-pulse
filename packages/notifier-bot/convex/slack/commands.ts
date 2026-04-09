import { v } from "convex/values";
import { fetchNpmLatestVersion } from "@patch-pulse/shared";
import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

function parseSlashBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function cleanText(text: string): string {
  // Strip Slack formatting (bold, italic, links)
  return text.replace(/[*_<>]/g, "").trim();
}

async function sendToSlack(url: string, text: string) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

// HTTP action handlers — return immediately, schedule async work

export const npmTrack = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const packageName = cleanText(body.text ?? "");
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmTrack, {
    packageName,
    teamId,
    responseUrl,
  });

  return new Response(
    JSON.stringify({
      text: `⏳ processing your request to track *${packageName}* on _npm_ 📦`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});

export const npmUntrack = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const packageName = cleanText(body.text ?? "");
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmUntrack, {
    packageName,
    teamId,
    responseUrl,
  });

  return new Response(
    JSON.stringify({
      text: `⏳ processing your request to stop tracking *${packageName}* on _npm_ 📦`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});

export const listPackages = httpAction(async (ctx, request) => {
  const body = parseSlashBody(await request.text());
  const teamId = body.team_id;
  const responseUrl = body.response_url;

  await ctx.scheduler.runAfter(0, internal.slack.commands.processList, {
    teamId,
    responseUrl,
  });

  return new Response(
    JSON.stringify({
      text: `⏳ processing your request to list all tracked packages 📦`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});

// Internal actions — async processors scheduled by the HTTP handlers above

export const processNpmTrack = internalAction({
  args: {
    packageName: v.string(),
    teamId: v.string(),
    responseUrl: v.string(),
  },
  handler: async (ctx, { packageName, teamId, responseUrl }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const version = await fetchNpmLatestVersion(packageName, {
      userAgent: "patch-pulse-notifier-bot",
    }).catch(() => null);

    if (!version) {
      await sendToSlack(
        responseUrl,
        `❌ failed to fetch _npm_ data for *${packageName}* 📦`,
      );
      return;
    }

    const packageId = await ctx.runMutation(internal.packages.upsertVersion, {
      name: packageName,
      version,
      ecosystem: "npm",
    });

    const existing = await ctx.runQuery(internal.subscriptions.exists, {
      packageId,
      subscriberId: subscriber._id,
    });

    if (existing) {
      await sendToSlack(
        responseUrl,
        `⚠️ workspace is already tracking *${packageName}* on _npm_ 📦 *${packageName}@latest* version is *${existing.lastNotifiedVersion}*`,
      );
      return;
    }

    await ctx.runMutation(internal.subscriptions.create, {
      packageId,
      subscriberId: subscriber._id,
      lastNotifiedVersion: version,
    });

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details) {
      await sendToSlack(
        details.webhookUrl,
        `🚀 started tracking *${packageName}* on _npm_ 📦 *${packageName}@latest* version is *${version}* 📢 stay tuned for updates!`,
      );
    }

    await sendToSlack(responseUrl, `✅ process complete`);
  },
});

export const processNpmUntrack = internalAction({
  args: {
    packageName: v.string(),
    teamId: v.string(),
    responseUrl: v.string(),
  },
  handler: async (ctx, { packageName, teamId, responseUrl }) => {
    const pkg = await ctx.runQuery(internal.packages.getByName, { name: packageName });
    if (!pkg) {
      await sendToSlack(
        responseUrl,
        `⚠️ workspace was never tracking *${packageName}* on _npm_ 📦`,
      );
      return;
    }

    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const existing = await ctx.runQuery(internal.subscriptions.exists, {
      packageId: pkg._id,
      subscriberId: subscriber._id,
    });

    if (!existing) {
      await sendToSlack(
        responseUrl,
        `⚠️ workspace was never tracking *${packageName}* on _npm_ 📦`,
      );
      return;
    }

    await ctx.runMutation(internal.subscriptions.remove, {
      packageId: pkg._id,
      subscriberId: subscriber._id,
    });

    const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
      subscriberId: subscriber._id,
    });

    if (details) {
      await sendToSlack(details.webhookUrl, `🔔 stopped tracking *${packageName}* on _npm_ 📦`);
    }

    await sendToSlack(responseUrl, `✅ process complete`);
  },
});

export const processList = internalAction({
  args: {
    teamId: v.string(),
    responseUrl: v.string(),
  },
  handler: async (ctx, { teamId, responseUrl }) => {
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, { teamId });
    if (!subscriber) {
      await sendToSlack(responseUrl, `❌ workspace not found. Please reinstall PatchPulse.`);
      return;
    }

    const subscriptions = await ctx.runQuery(internal.subscriptions.getBySubscriber, {
      subscriberId: subscriber._id,
    });

    if (subscriptions.length === 0) {
      await sendToSlack(
        responseUrl,
        `📭 you are not currently tracking any packages on _npm_ 📦`,
      );
      return;
    }

    const packageIds = subscriptions.map((s) => s.packageId);
    const packages = await ctx.runQuery(internal.packages.getByIds, { ids: packageIds });
    const validPackages = packages.filter(Boolean);

    const packageList = validPackages
      .sort((a, b) => a!.name.localeCompare(b!.name))
      .reduce((acc, pkg) => acc + `• ${pkg!.name}\n`, "");

    await sendToSlack(
      responseUrl,
      `📦 you are currently tracking *${validPackages.length}* packages on _npm_:\n${packageList}`,
    );
  },
});
