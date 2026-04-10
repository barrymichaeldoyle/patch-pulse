import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { verifySlackRequest } from "./verify";
import { openTrackModal, openMoveChannelModal, TRACK_MODAL_CALLBACK_ID, MOVE_CHANNEL_MODAL_CALLBACK_ID } from "./api";

function normalizeNpmPackageName(packageName: string): string {
  return packageName.trim().toLowerCase();
}

export const slackInteractions = httpAction(async (ctx, request) => {
  const rawBody = await verifySlackRequest(request);
  if (rawBody === null) return new Response("Unauthorized", { status: 401 });

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") ?? "{}");

  if (payload.type === "block_actions") {
    for (const action of payload.actions ?? []) {
      if (action.action_id === "track_package") {
        // Must call views.open synchronously — trigger_id expires in 3 seconds
        const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
          teamId: payload.team.id,
        });
        const details = subscriber
          ? await ctx.runQuery(internal.subscribers.getSlackDetails, {
              subscriberId: subscriber._id,
            })
          : null;

        if (details) {
          try {
            await openTrackModal(details.accessToken, payload.trigger_id);
          } catch (error) {
            console.error("Failed to open track modal:", error);
          }
        }
      }

      if (action.action_id === "package_menu") {
        const value = JSON.parse(action.selected_option?.value ?? "{}") as {
          a: "t" | "m" | "u";
          s?: string;
          t?: "patch" | "minor" | "major";
        };
        const subscriptionId = value.s as Id<"subscriptions"> | undefined;
        if (!subscriptionId) continue;

        if (value.a === "u") {
          // Untrack
          await ctx.scheduler.runAfter(0, internal.slack.commands.processUntrackAction, {
            teamId: payload.team.id,
            viewingUserId: payload.user.id,
            subscriptionId,
          });
        } else if (value.a === "t" && value.t) {
          // Change threshold
          await ctx.scheduler.runAfter(0, internal.slack.commands.processThresholdChange, {
            teamId: payload.team.id,
            viewingUserId: payload.user.id,
            subscriptionId,
            minUpdateType: value.t,
          });
        } else if (value.a === "m") {
          // Move to channel — open modal synchronously
          const subscriber = await ctx.runQuery(internal.subscribers.getByTeamId, {
            teamId: payload.team.id,
          });
          const details = subscriber
            ? await ctx.runQuery(internal.subscribers.getSlackDetails, {
                subscriberId: subscriber._id,
              })
            : null;
          const sub = await ctx.runQuery(internal.subscriptions.getById, { subscriptionId });
          if (details && sub) {
            const pkg = await ctx.runQuery(internal.packages.getByIds, { ids: [sub.packageId] });
            const packageName = pkg[0]?.name ?? "";
            try {
              await openMoveChannelModal(details.accessToken, payload.trigger_id, subscriptionId, packageName);
            } catch (error) {
              console.error("Failed to open move channel modal:", error);
            }
          }
        }
      }
    }
  }

  if (payload.type === "view_submission") {
    if (payload.view?.callback_id === TRACK_MODAL_CALLBACK_ID) {
      const values = payload.view.state.values;
      const rawPackages: string = values.package_block?.package_input?.value ?? "";
      const channelId: string | undefined = values.channel_block?.channel_input?.selected_conversation ?? undefined;
      const minUpdateType: "patch" | "minor" | "major" =
        values.threshold_block?.threshold_input?.selected_option?.value ?? "patch";

      const packageNames = rawPackages
        .trim()
        .split(/\s+/)
        .map(normalizeNpmPackageName)
        .filter(Boolean);

      for (const packageName of packageNames) {
        await ctx.scheduler.runAfter(0, internal.slack.commands.processNpmTrack, {
          packageName,
          teamId: payload.team.id,
          minUpdateType,
          channelId,
          userId: payload.user.id,
        });
      }

      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (payload.view?.callback_id === MOVE_CHANNEL_MODAL_CALLBACK_ID) {
      const values = payload.view.state.values;
      const newChannelId: string | undefined =
        values.channel_block?.channel_input?.selected_conversation ?? undefined;
      const metadata = JSON.parse(payload.view.private_metadata ?? "{}") as {
        subscriptionId?: string;
        packageName?: string;
      };

      if (newChannelId && metadata.subscriptionId) {
        await ctx.scheduler.runAfter(0, internal.slack.commands.processMoveAction, {
          teamId: payload.team.id,
          viewingUserId: payload.user.id,
          subscriptionId: metadata.subscriptionId as Id<"subscriptions">,
          newChannelId,
        });
      }

      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(null, { status: 200 });
});
