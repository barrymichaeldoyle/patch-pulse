import { getDependencyStatus, fetchNpmLatestVersion } from "@patch-pulse/shared";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.runQuery(internal.packages.getAll);

    for (const pkg of packages) {
      let version: string | undefined;

      try {
        version = await fetchNpmLatestVersion(pkg.name, {
          userAgent: "patch-pulse-notifier-bot",
        });
      } catch {
        console.error(`failed to fetch npm data for ${pkg.name}`);
        continue;
      }

      if (!version) continue;

      const { status } = getDependencyStatus({
        packageName: pkg.name,
        currentVersion: pkg.currentVersion,
        latestVersion: version,
      });

      if (status === "update-available") {
        await ctx.runMutation(internal.packages.upsertVersion, {
          name: pkg.name,
          version,
        });

        console.log(`updated ${pkg.name} from ${pkg.currentVersion} to ${version}`);

        const subscriptions = await ctx.runQuery(
          internal.subscriptions.getSubscribersOfPackage,
          { packageId: pkg._id },
        );

        for (const sub of subscriptions) {
          const details = await ctx.runQuery(internal.subscribers.getSlackDetails, {
            subscriberId: sub.subscriberId,
          });

          if (!details) continue;

          try {
            const response = await fetch(details.webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `📦 *${pkg.name}* has been updated on _npm_ 📢 *${pkg.name}@latest* version is *${version}*`,
              }),
            });

            if (!response.ok) {
              console.error(
                `failed to notify ${sub.subscriberId} for ${pkg.name}: ${response.statusText}`,
              );
            }
          } catch (error) {
            console.error(`error sending notification for ${pkg.name}:`, error);
          }
        }
      }
    }
  },
});
