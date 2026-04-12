import { httpAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { verifySlackRequest } from './verify';
import {
  openTrackModal,
  openManageModal,
  manageActionsModalView,
  pushMoveChannelModal,
  updateSlackView,
  TRACK_MODAL_CALLBACK_ID,
  MANAGE_MODAL_CALLBACK_ID,
  MANAGE_ACTIONS_MODAL_CALLBACK_ID,
  MOVE_CHANNEL_MODAL_CALLBACK_ID,
} from './api';

function normalizeNpmPackageName(packageName: string): string {
  return packageName.trim().toLowerCase();
}

export const slackInteractions = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response('Unauthorized', { status: 401 });

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get('payload') ?? '{}');

  if (payload.type === 'block_actions') {
    // Fetch subscriber/details once — used by multiple action handlers below
    const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
      teamId: payload.team.id,
    });
    const details = subscriber
      ? await ctx.runQuery(internal.subscribers.getSlackDetails, {
          subscriberId: subscriber._id,
        })
      : null;

    for (const action of payload.actions ?? []) {
      if (action.action_id === 'track_package') {
        if (details) {
          try {
            await openTrackModal(details.accessToken, payload.trigger_id);
          } catch (error) {
            console.error('Failed to open track modal:', error);
          }
        }
      }

      if (action.action_id === 'manage_package') {
        if (details && subscriber) {
          try {
            const allSubscriptions = await ctx.runQuery(
              internal.subscriptions.getBySubscriber,
              { subscriberId: subscriber._id },
            );
            const subscriptions = allSubscriptions.filter(
              (sub) => sub.channelId || sub.userId === payload.user.id,
            );
            const packageIds = [
              ...new Set(subscriptions.map((s) => s.packageId)),
            ];
            const packages = await ctx.runQuery(internal.packages.getByIds, {
              ids: packageIds,
            });
            const entries = subscriptions
              .map((sub) => {
                const pkg = packages.find((p) => p?._id === sub.packageId);
                if (!pkg) return null;
                return {
                  subscriptionId: sub._id,
                  packageName: pkg.name,
                  currentVersion: pkg.currentVersion,
                  githubRepoUrl: pkg.githubRepoUrl,
                  minUpdateType: sub.minUpdateType,
                  channelId: sub.channelId,
                  channelName: sub.channelName,
                  userId: sub.userId,
                  lastChecked: pkg.lastChecked,
                };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null);
            await openManageModal(
              details.accessToken,
              payload.trigger_id,
              entries,
            );
          } catch (error) {
            console.error('Failed to open manage modal:', error);
          }
        }
      }

      if (action.action_id === 'manage_move') {
        const { s: subscriptionId, p: packageName } = JSON.parse(
          action.value ?? '{}',
        ) as { s?: string; p?: string };
        if (details && subscriptionId && packageName) {
          try {
            await pushMoveChannelModal(
              details.accessToken,
              payload.trigger_id,
              subscriptionId,
              packageName,
            );
          } catch (error) {
            console.error('Failed to push move channel modal:', error);
          }
        }
      }

      if (action.action_id === 'manage_untrack') {
        const { s: subscriptionId } = JSON.parse(action.value ?? '{}') as {
          s?: string;
        };
        if (subscriptionId && details) {
          await ctx.scheduler.runAfter(
            0,
            internal.slack.commands.processUntrackAction,
            {
              teamId: payload.team.id,
              viewingUserId: payload.user.id,
              subscriptionId: subscriptionId as Id<'subscriptions'>,
            },
          );
          try {
            await updateSlackView(details.accessToken, payload.view.id, {
              type: 'modal',
              title: { type: 'plain_text', text: 'Done' },
              close: { type: 'plain_text', text: 'Close' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '✅ Package untracked successfully.',
                  },
                },
              ],
            });
          } catch (error) {
            console.error('Failed to update view after untrack:', error);
          }
        }
      }
    }
  }

  if (payload.type === 'view_submission') {
    if (payload.view?.callback_id === TRACK_MODAL_CALLBACK_ID) {
      const values = payload.view.state.values;
      const rawPackages: string =
        values.package_block?.package_input?.value ?? '';
      const channelId: string | undefined =
        values.channel_block?.channel_input?.selected_conversation ?? undefined;
      const minUpdateType: 'patch' | 'minor' | 'major' =
        values.threshold_block?.threshold_input?.selected_option?.value ??
        'patch';

      const packageNames = rawPackages
        .trim()
        .split(/\s+/)
        .map(normalizeNpmPackageName)
        .filter(Boolean);

      for (const packageName of packageNames) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.processNpmTrack,
          {
            packageName,
            teamId: payload.team.id,
            minUpdateType,
            channelId,
            userId: payload.user.id,
          },
        );
      }

      return new Response(JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (payload.view?.callback_id === MANAGE_MODAL_CALLBACK_ID) {
      const selectedSubId: string | undefined =
        payload.view.state.values?.subscription_block?.subscription_input
          ?.selected_option?.value;
      if (selectedSubId) {
        const sub = await ctx.runQuery(internal.subscriptions.getById, {
          subscriptionId: selectedSubId as Id<'subscriptions'>,
        });
        if (sub) {
          const pkgs = await ctx.runQuery(internal.packages.getByIds, {
            ids: [sub.packageId],
          });
          const pkg = pkgs[0];
          if (pkg) {
            const entry = {
              subscriptionId: sub._id,
              packageName: pkg.name,
              currentVersion: pkg.currentVersion,
              githubRepoUrl: pkg.githubRepoUrl,
              minUpdateType: sub.minUpdateType,
              channelId: sub.channelId,
              channelName: sub.channelName,
              userId: sub.userId,
              lastChecked: pkg.lastChecked,
            };
            return new Response(
              JSON.stringify({
                response_action: 'push',
                view: manageActionsModalView(entry),
              }),
              { headers: { 'Content-Type': 'application/json' } },
            );
          }
        }
      }
      return new Response(JSON.stringify({ response_action: 'clear' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (payload.view?.callback_id === MANAGE_ACTIONS_MODAL_CALLBACK_ID) {
      const newThreshold: 'patch' | 'minor' | 'major' =
        payload.view.state.values?.threshold_block?.threshold_input
          ?.selected_option?.value ?? 'patch';
      let metadata: { subscriptionId?: string } = {};
      try {
        metadata = JSON.parse(payload.view.private_metadata ?? '{}');
      } catch {
        console.error('Failed to parse manage_actions_modal metadata');
      }
      if (metadata.subscriptionId) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.processThresholdChange,
          {
            teamId: payload.team.id,
            viewingUserId: payload.user.id,
            subscriptionId: metadata.subscriptionId as Id<'subscriptions'>,
            minUpdateType: newThreshold,
          },
        );
      }
      return new Response(JSON.stringify({ response_action: 'clear' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (payload.view?.callback_id === MOVE_CHANNEL_MODAL_CALLBACK_ID) {
      const values = payload.view.state.values;
      const newChannelId: string | undefined =
        values.channel_block?.channel_input?.selected_conversation ?? undefined;
      let metadata: { subscriptionId?: string; packageName?: string } = {};
      try {
        metadata = JSON.parse(payload.view.private_metadata ?? '{}');
      } catch {
        console.error(
          'slackInteractions: failed to parse view private_metadata:',
          payload.view.private_metadata,
        );
      }

      if (newChannelId && metadata.subscriptionId) {
        await ctx.scheduler.runAfter(
          0,
          internal.slack.commands.processMoveAction,
          {
            teamId: payload.team.id,
            viewingUserId: payload.user.id,
            subscriptionId: metadata.subscriptionId as Id<'subscriptions'>,
            newChannelId,
          },
        );
      }

      return new Response(JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(null, { status: 200 });
});
