import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const slackEvents = httpAction(async (ctx, request) => {
  const data = await request.json();

  switch (data.type) {
    case "url_verification":
      return new Response(data.challenge, {
        headers: { "Content-Type": "text/plain" },
      });

    case "event_callback":
      if (data.event?.type === "app_uninstalled") {
        await ctx.runMutation(internal.subscribers.setInactive, {
          teamId: data.team_id,
        });
      }
      return new Response(null, { status: 200 });

    default:
      return new Response(null, { status: 400 });
  }
});
