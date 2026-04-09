import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getDependencyStatus } from '@patch-pulse/shared';
import axios from 'axios';

import { SupabaseService } from '../supabase/supabase.service';
import { NpmService } from '../npm/npm.service';
import { Database } from '../supabase/gen/types';

@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly npmService: NpmService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('checkForUpdates called (every hour)');
    await this.checkForUpdates();
  }

  private async checkForUpdates() {
    // Fetch all the packages that need to be tracked
    const trackedPackages = await this.supabaseService.getTrackedPackages();

    for (const pkg of trackedPackages) {
      const { npmData, error } = await this.npmService.fetchNpmData(pkg.name);

      if (!npmData || error) {
        this.logger.error(`failed to fetch npm data for package ${pkg.name}`);
        continue;
      }

      const dependencyStatus = getDependencyStatus({
        packageName: pkg.name,
        currentVersion: pkg.current_version,
        latestVersion: npmData.version,
      });

      if (dependencyStatus.status === 'update-available') {
        // Update the package version in your database
        await this.supabaseService.updatePackageVersion(
          pkg.id,
          npmData.version,
        );

        // Log the update
        this.logger.log(
          `updated package ${pkg.name} from ${pkg.current_version} to ${npmData.version}`,
        );

        await this.triggerSlackNotifications(pkg, npmData);
      }
    }
  }

  private async triggerSlackNotifications(
    pkg: Database['public']['Tables']['packages']['Row'],
    npmData: any, // TODO: get types for this
  ) {
    const subscribers = await this.supabaseService.getSubscribersOfPackage(
      pkg.id,
    );

    for (const subscriber of subscribers) {
      // Get webhook URL of the subscriber
      const webhookUrl =
        await this.supabaseService.getSlackWebhookUrlBySubscriberId(
          subscriber.subscriber_id,
        );

      // Send a notification to the subscriber
      try {
        const response = await axios.post(webhookUrl, {
          text: `📦 *${pkg.name}* has been updated on _npm_ 📢 *${pkg.name}@latest* version is *${npmData.version}*`,
        });
        this.logger.verbose('notification sent:', response.data);
      } catch (error) {
        this.logger.error('error sending notification:', error);
      }
    }
  }
}
