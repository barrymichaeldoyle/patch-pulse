import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { verifySlackRequest } from "./verify";

export const slackEvents = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });

  const data = JSON.parse(rawBody);

  switch (data.type) {
    case "url_verification":
      return new Response(data.challenge, {
        headers: { "Content-Type": "text/plain" },
      });

    case "event_callback":
      if (
        data.event?.type === "app_uninstalled" ||
        data.event?.type === "tokens_revoked"
      ) {
        await ctx.runMutation(internal.subscribers.setInactive, {
          teamId: data.team_id,
        });
      }
      return new Response(null, { status: 200 });

    default:
      return new Response(null, { status: 400 });
  }
});
