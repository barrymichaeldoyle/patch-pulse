import {
  Controller,
  Post,
  Body,
  Res,
  Get,
  Query,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { getTimestampWithoutTimezone } from '../../utils/datetime';
import { NpmService } from '../../services/npm/npm.service';
import { SupabaseService } from '../../services/supabase/supabase.service';
import { SlackService } from './slack.service';
import { EventType, SlackOAuthResponse, SlackSlashBody } from './slack.types';
import { cleanText } from './slack.utils';

@Controller('slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private redirectUri: string | undefined;

  constructor(
    private readonly slackService: SlackService,
    private readonly supabaseService: SupabaseService,
    private readonly npmService: NpmService,
    configService: ConfigService,
  ) {
    this.clientId = configService.get<string>('SLACK_CLIENT_ID');
    this.clientSecret = configService.get<string>('SLACK_CLIENT_SECRET');
    this.redirectUri = configService.get<string>('SLACK_REDIRECT_URI');

    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      this.logger.error('required environment variables are not set');
      throw new Error('required environment variables are not set');
    }
  }

  @Post('npmtrack')
  async trackNpmPackage(@Body() body: SlackSlashBody) {
    this.logger.verbose('received `npmtrack` request from Slack', { body });

    body.text = cleanText(body.text);

    setImmediate(() => {
      this.processNpmTrack(body).catch((error) => {
        this.logger.error('error running processNpmTrack:', error);
      });
    });

    return {
      text: `⏳ processing your request to track *${body.text}* on _npm_ 📦`,
    };
  }

  private async processNpmTrack(body: SlackSlashBody) {
    const packageName = body.text.trim();
    const teamId = body.team_id;

    const subscriberId =
      await this.supabaseService.getSubscriberIdByTeamId(teamId);

    if (!subscriberId) {
      throw new Error(`failed to find subscriber ID for team ID: ${teamId}`);
    }

    // Check if the package already exists in our database
    let packageId = await this.supabaseService.getPackageId(packageName);

    // Fetch the latest version from NPM

    const { npmData, error } = await this.npmService.fetchNpmData(packageName);

    if (!npmData || error) {
      return this.slackService.sendMessageToSlack(
        body.response_url,
        `❌ failed to fetch _npm_ data for *${packageName}* 📦`,
      );
    }

    const version = npmData.version;

    if (!packageId) {
      // Insert the package into the packages table and retrieve the ID
      packageId = await this.supabaseService.addPackage({
        name: packageName,
        current_version: version,
        ecosystem: 'npm',
        last_checked: getTimestampWithoutTimezone(),
      });

      // Double-check to prevent race conditions
      if (!packageId) {
        packageId = await this.supabaseService.getPackageId(packageName);
        if (!packageId) {
          throw new Error(`failed to track package: ${packageName}`);
        }
      }
    }

    const existingSubscription = await this.supabaseService.getSubscription(
      packageId,
      subscriberId,
    );

    if (existingSubscription) {
      this.logger.verbose(
        `⚠️ workspace is already tracking *${packageName}* on _npm_ 📦 *${packageName}@latest* version is *${existingSubscription.last_notified_version}*`,
      );
      return await this.slackService.sendMessageToSlack(
        body.response_url,
        `⚠️ workspace is already tracking *${packageName}* on _npm_ 📦 *${packageName}@latest* version is *${existingSubscription.last_notified_version}*`,
      );
    }

    // Create a new subscription
    await this.supabaseService.createSubscription({
      package_id: packageId,
      subscriber_id: subscriberId,
      last_notified_version: version,
      subscription_date: getTimestampWithoutTimezone(),
    });

    const webhookUrl =
      await this.supabaseService.getSlackWebhookUrlBySubscriberId(subscriberId);

    await this.slackService.sendMessageToSlack(
      webhookUrl,
      `🚀 started tracking *${packageName}* on _npm_ 📦 *${packageName}@latest* version is *${version}* 📢 stay tuned for updates!`,
    );

    return await this.slackService.sendMessageToSlack(
      body.response_url,
      `✅ process complete`,
    );
  }

  @Post('npmuntrack')
  async untrackNpmPackage(@Body() body: SlackSlashBody) {
    this.logger.verbose('received `npmuntrack` request from Slack', { body });

    setImmediate(() => {
      this.processNpmUntrack(body).catch((error) => {
        this.logger.error('error running processNpmUntrack:', error);
      });
    });

    return {
      text: `⏳ processing your request to stop tracking *${body.text}* on _npm_ 📦`,
    };
  }

  private async processNpmUntrack(body: SlackSlashBody) {
    const packageName = body.text.trim();
    const teamId = body.team_id;

    // Fetch the package ID
    const packageId = await this.supabaseService.getPackageId(packageName);
    if (!packageId) {
      return await this.slackService.sendMessageToSlack(
        body.response_url,
        `⚠️ workspace was never tracking *${packageName}* on _npm_ 📦`,
      );
    }

    // Fetch the subscriber's ID
    const subscriberId =
      await this.supabaseService.getSubscriberIdByTeamId(teamId);
    if (!subscriberId) {
      throw new Error(`failed to find subscriber ID for team ID: ${teamId}`);
    }

    // Check if there's a subscription for this package
    const existingSubscription = await this.supabaseService.getSubscription(
      packageId,
      subscriberId,
    );
    if (!existingSubscription) {
      return await this.slackService.sendMessageToSlack(
        body.response_url,
        `⚠️ workspace was never tracking *${packageName}* on _npm_ 📦`,
      );
    }

    // Delete the subscription
    await this.supabaseService.deleteSubscription(packageId, subscriberId);

    const webhookUrl =
      await this.supabaseService.getSlackWebhookUrlBySubscriberId(subscriberId);

    await this.slackService.sendMessageToSlack(
      webhookUrl,
      `🔔 stopped tracking *${packageName}* on _npm_ 📦`,
    );

    return await this.slackService.sendMessageToSlack(
      body.response_url,
      `✅ process complete`,
    );
  }

  @Post('list')
  async listTrackedPackages(@Body() body: SlackSlashBody) {
    this.logger.verbose('received `list` request from Slack', { body });

    setImmediate(() => {
      this.processList(body).catch((error) => {
        this.logger.error('error running processList:', error);
      });
    });

    return {
      text: `⏳ processing your request to list all tracked packages 📦`,
    };
  }

  private async processList(body: SlackSlashBody) {
    const teamId = body.team_id;

    const subscriberId =
      await this.supabaseService.getSubscriberIdByTeamId(teamId);
    if (!subscriberId) {
      throw new Error(`failed to find subscriber ID for team ID: ${teamId}`);
    }

    const subscriptions =
      await this.supabaseService.getSubscriptionsBySubscriberId(subscriberId);

    if (!subscriptions || subscriptions.length === 0) {
      return this.slackService.sendMessageToSlack(
        body.response_url,
        `📭 you are not currently tracking any packages on _npm_ 📦`,
      );
    }

    const packageIds = subscriptions.reduce((acc: string[], sub) => {
      if (sub.package_id !== null) {
        acc.push(sub.package_id);
      }
      return acc;
    }, []);
    const packagesDetails =
      await this.supabaseService.getPackageDetailsByPackageIds(packageIds);
    const packageNames = packagesDetails
      .sort((a, b) => a.name.localeCompare(b.name))
      .reduce((acc, pkg) => acc + `• ${pkg.name}\n`, '');
    const packageCount = packagesDetails.length;

    return this.slackService.sendMessageToSlack(
      body.response_url,
      `📦 you are currently tracking *${packageCount}* packages on _npm_:\n${packageNames}`,
    );
  }

  @Get('oauth-callback')
  async handleOAuthCallback(
    @Query() query: { code: string },
    @Res() res: any,
  ): Promise<void> {
    const { code } = query;

    try {
      // Exchange the code for an access token
      const response = await axios.get(
        'https://slack.com/api/oauth.v2.access',
        {
          params: {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            redirect_uri: this.redirectUri,
          },
        },
      );

      const data: SlackOAuthResponse = response.data;
      if (data.ok) {
        this.logger.verbose('successfully retrieved access token from Slack', {
          data,
        });
        const now = getTimestampWithoutTimezone();
        await this.supabaseService.createSlackWorkspaceRecord({
          access_token: data.access_token,
          bot_user_id: data.bot_user_id,
          created_at: now,
          team_id: data.team.id,
          team_name: data.team.name,
          updated_at: now,
          webhook_channel_id: data.incoming_webhook.channel_id,
          webhook_channel: data.incoming_webhook.channel,
          webhook_configuration_url: data.incoming_webhook.configuration_url,
          webhook_url: data.incoming_webhook.url,
        });

        await this.slackService.sendMessageToSlack(
          data.incoming_webhook.url,
          '*PatchPulse* has been connected successfully! 🎉',
        );

        res.send(`
  <html>
    <body>
      <h2>Success!</h2>
      <p>You've successfully linked <strong>PatchPulse</strong> to <strong>${data.team.name}</strong></p>
      <p>You can safely close this tab.</p>
    </body>
  </html>
`);
      } else {
        // Handle the error from Slack
        this.logger.error('error from Slack:', data.error);
        res.status(500).send('error during Slack OAuth');
      }
    } catch (error) {
      // Handle the error from the axios request
      this.logger.error('error during code exchange:', error.message);
      res.status(500).send('error during code exchange');
    }
  }

  @Post('events')
  async handleSlackEvents(@Body() data: any, @Res() res: any) {
    this.logger.verbose('received event from Slack', { data });
    switch (data.type) {
      case 'url_verification':
        // This is for verifying the endpoint initially
        res.send(data.challenge);
        break;

      case 'event_callback':
        // This is where actual events come in
        if (data.event.type === EventType.APP_UNINSTALLED) {
          await this.supabaseService.setSubscriberInactive(data.team_id);
          res.status(200).send();
        } else {
          res.status(200).send(); // Other events that you might not handle
        }
        break;

      default:
        res.status(400).send(); // Bad request for unknown event types
        break;
    }
  }
}
