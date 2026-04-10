import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { chatPostMessage } from "./api";

export const slackOAuthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  try {
    const tokenUrl = new URL("https://slack.com/api/oauth.v2.access");
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);

    const response = await fetch(tokenUrl.toString());
    const data = await response.json();

    if (!data.ok) {
      console.error("Slack OAuth error:", data.error);
      return new Response("Error during Slack OAuth", { status: 500 });
    }

    await ctx.runMutation(internal.subscribers.upsertSlackWorkspace, {
      accessToken: data.access_token,
      botUserId: data.bot_user_id,
      teamId: data.team.id,
      teamName: data.team.name,
    });

    try {
      await chatPostMessage(
        data.access_token,
        data.authed_user.id,
        `*PatchPulse* has been connected to *${data.team.name}* successfully! 🎉\n\n` +
          `Here's how to use it:\n` +
          `• \`/npmtrack react\` — track a package via DM\n` +
          `• \`/npmtrack react vue typescript\` — track multiple packages at once\n` +
          `• \`/npmtrack react #frontend\` — track a package in a channel\n` +
          `• \`/npmtrack react major\` — only notify on major releases\n` +
          `• \`/npmuntrack react\` — stop tracking a package\n` +
          `• \`/npmuntrack react #frontend\` — stop tracking in a specific channel\n` +
          `• \`/npmlist\` — see all your tracked packages`,
      );
    } catch (error) {
      // A failed welcome DM is non-fatal — the workspace is already connected.
      console.warn("Could not send welcome DM to installing user:", error);
    }

    return new Response(
      `<html><body><h2>Success!</h2><p>You've successfully linked <strong>PatchPulse</strong> to <strong>${data.team.name}</strong></p><p>You can safely close this tab.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    console.error("Error during OAuth code exchange:", error);
    return new Response("Error during code exchange", { status: 500 });
  }
});
