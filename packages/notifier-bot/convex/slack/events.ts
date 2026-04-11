import { httpAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { verifySlackRequest } from './verify';

export const slackEvents = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

  const data = JSON.parse(rawBody);

  switch (data.type) {
    case 'url_verification':
      return new Response(data.challenge, {
        headers: { 'Content-Type': 'text/plain' },
      });

    case 'event_callback':
      if (
        data.event?.type === 'app_uninstalled' ||
        data.event?.type === 'tokens_revoked'
      ) {
        await ctx.runMutation(internal.subscribers.setInactive, {
          teamId: data.team_id,
        });
      } else if (
        data.event?.type === 'app_home_opened' &&
        data.event?.tab === 'home'
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.refreshAppHome,
          {
            teamId: data.team_id,
            userId: data.event.user,
          },
        );
      }
      return new Response(null, { status: 200 });

    default:
      return new Response(null, { status: 400 });
  }
});
