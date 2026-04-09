import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { getTimestampWithoutTimezone } from '../../utils/datetime';
import { Database } from './gen/types';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('supabase credentials are not provided.');
    }

    this.supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
  }

  async getTrackedPackages(): Promise<
    Database['public']['Tables']['packages']['Row'][]
  > {
    const { data, error } = await this.supabase
      .from('packages')
      .select('id, name, current_version');

    if (error) {
      this.logger.error(`failed to fetch tracked packages`, error.message);
      throw new Error(`failed to fetch tracked packages`);
    }

    return data as Database['public']['Tables']['packages']['Row'][];
  }

  async updatePackageVersion(
    packageId: string,
    newVersion: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('packages')
      .update({ current_version: newVersion })
      .eq('id', packageId);

    if (error) {
      this.logger.error(
        `failed to update version for package with ID ${packageId}`,
        error.message,
      );
      throw new Error(
        `failed to update version for package with ID ${packageId}`,
      );
    }

    return;
  }

  async createSlackWorkspaceRecord(
    data: Omit<
      Database['public']['Tables']['slack_subscriber_details']['Insert'],
      'subscriber_id'
    >,
  ): Promise<void> {
    const { data: existingSubscribers, error: fetchError } = await this.supabase
      .from('subscribers')
      .select('id, active')
      .eq('identifier', data.team_id);

    if (fetchError) {
      this.logger.error(
        'failed to fetch existing subscribers',
        fetchError.message,
      );
      throw new InternalServerErrorException(
        'failed to create or update slack workspace record',
      );
    }

    if (existingSubscribers && existingSubscribers.length > 0) {
      const existingSubscriber = existingSubscribers[0];

      // Reactivate the subscriber if inactive
      if (!existingSubscriber.active) {
        const { error: updateError } = await this.supabase
          .from('subscribers')
          .update({ active: true })
          .eq('id', existingSubscriber.id);

        if (updateError) {
          this.logger.error(
            'failed to reactivate existing subscriber',
            updateError.message,
          );
          throw new InternalServerErrorException(
            'failed to reactivate slack workspace record',
          );
        }
      }

      // Update slack_subscriber_details with new data
      const detailsUpdate: Partial<
        Database['public']['Tables']['slack_subscriber_details']['Insert']
      > = {
        access_token: data.access_token,
        bot_user_id: data.bot_user_id,
        updated_at: data.updated_at,
        team_name: data.team_name,
        webhook_channel: data.webhook_channel,
        webhook_channel_id: data.webhook_channel_id,
        webhook_configuration_url: data.webhook_configuration_url,
        webhook_url: data.webhook_url,
      };

      const { error: detailsUpdateError } = await this.supabase
        .from('slack_subscriber_details')
        .update(detailsUpdate)
        .eq('subscriber_id', existingSubscriber.id);

      if (detailsUpdateError) {
        this.logger.error(
          'failed to update slack_subscriber_details',
          detailsUpdateError.message,
        );
        throw new InternalServerErrorException(
          'failed to update slack_subscriber_details',
        );
      }

      return;
    }

    const { data: subscriber, error: subscriberError } = await this.supabase
      .from('subscribers')
      .insert([{ type: 'slack', identifier: data.team_id }])
      .select('*')
      .limit(1)
      .single<Database['public']['Tables']['subscribers']['Row']>();

    if (!subscriber || subscriberError) {
      this.logger.error('failed to insert into subscribers table', {
        subscriber,
        subscriberError,
      });
      throw new InternalServerErrorException(
        'failed to create slack workspace record',
      );
    }

    const details: Database['public']['Tables']['slack_subscriber_details']['Insert'] =
      {
        access_token: data.access_token,
        bot_user_id: data.bot_user_id,
        created_at: data.created_at,
        subscriber_id: subscriber.id,
        team_name: data.team_name,
        team_id: data.team_id,
        updated_at: data.updated_at,
        webhook_channel: data.webhook_channel,
        webhook_channel_id: data.webhook_channel_id,
        webhook_configuration_url: data.webhook_configuration_url,
        webhook_url: data.webhook_url,
      };

    // Insert into the slack_subscriber_details table
    const { error: detailsError } = await this.supabase
      .from('slack_subscriber_details')
      .insert([details]);

    if (detailsError) {
      this.logger.error(
        'failed to insert into slack_subscriber_details table',
        detailsError.message,
      );
      // rollback the previous insert
      await this.supabase.from('subscribers').delete().eq('id', subscriber.id);
      throw new InternalServerErrorException(
        'failed to create slack workspace record',
      );
    }

    return;
  }

  async getSubscriberIdByTeamId(teamId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('subscribers')
      .select('id')
      .eq('identifier', teamId)
      .single<Database['public']['Tables']['subscribers']['Row']>();

    if (error) {
      this.logger.error(`failed to fetch subscriber by teamId`, error.message);
      throw new Error(`failed to fetch subscriber by teamId`);
    }

    return data ? data.id : null;
  }

  async getSubscribersOfPackage(
    packageId: string,
  ): Promise<Array<{ subscriber_id: string }>> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('subscriber_id')
      .eq('package_id', packageId);

    if (error) {
      this.logger.error(
        `failed to get subscribers for packageId: ${packageId}`,
        error.message,
      );
      throw new Error(`failed to get subscribers for packageId: ${packageId}`);
    }

    return data || [];
  }

  async setSubscriberInactive(teamId: string) {
    this.logger.debug(`setting subscriber to inactive ${teamId}`);
    const { data, error } = await this.supabase
      .from('subscribers')
      .update({ active: false })
      .eq('identifier', teamId);

    if (error) {
      throw error;
    }
    return data;
  }

  async getPackageId(packageName: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('packages')
      .select('id')
      .eq('name', packageName)
      .maybeSingle();

    if (error) {
      this.logger.error(`failed to check if package exists`, error.message);
      throw new Error(`failed to check if package exists`);
    }

    return data ? data.id : null;
  }

  async addPackage({
    current_version,
    name,
    ecosystem,
    last_checked,
  }: Omit<
    Database['public']['Tables']['packages']['Insert'],
    'id'
  >): Promise<string> {
    const { data, error } = await this.supabase
      .from('packages')
      .insert([
        {
          name,
          current_version,
          ecosystem,
          last_checked: last_checked || getTimestampWithoutTimezone(),
        },
      ])
      .select<'id', { id: string }>('id')
      .single();

    if (error) {
      this.logger.error(`failed to add new package`, error.message);
      throw new Error(`failed to add new package`);
    }

    if (!data) {
      throw new Error(`failed to retrieve added package details`);
    }

    return data.id;
  }

  async getSubscription(
    packageId: string,
    subscriberId: string,
  ): Promise<Database['public']['Tables']['subscriptions']['Row'] | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select<'*', Database['public']['Tables']['subscriptions']['Row']>('*')
      .eq('package_id', packageId)
      .eq('subscriber_id', subscriberId)
      .maybeSingle();

    if (error) {
      this.logger.error(`failed to get subscription`, error.message);
      throw new Error(`failed to get subscription`);
    }

    return data || null;
  }

  async createSubscription({
    last_notified_version,
    package_id,
    subscriber_id,
    subscription_date,
  }: Omit<
    Database['public']['Tables']['subscriptions']['Insert'],
    'id'
  >): Promise<void> {
    const { error } = await this.supabase.from('subscriptions').insert([
      {
        last_notified_version,
        package_id,
        subscription_date: subscription_date || getTimestampWithoutTimezone(),
        subscriber_id,
      },
    ]);

    if (error) {
      this.logger.error(`failed to create subscription`, error.message);
      throw new Error(`failed to create subscription`);
    }

    return;
  }

  async deleteSubscription(
    packageId: string,
    subscriberId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('subscriptions')
      .delete()
      .eq('package_id', packageId)
      .eq('subscriber_id', subscriberId);

    if (error) {
      this.logger.error(`failed to delete subscription`, error.message);
      throw new Error(`failed to delete subscription`);
    }

    return;
  }

  async getSlackWebhookUrlBySubscriberId(
    subscriberId: string,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('slack_subscriber_details')
      .select<'webhook_url', { webhook_url: string }>('webhook_url')
      .eq('subscriber_id', subscriberId)
      .single();

    if (error) {
      this.logger.error(`failed to fetch webhook_url`, error.message);
      throw new Error(`failed to fetch webhook_url`);
    }

    return data.webhook_url;
  }

  async getSubscriptionsBySubscriberId(
    subscriberId: string,
  ): Promise<Database['public']['Tables']['subscriptions']['Row'][]> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('subscriber_id', subscriberId);

    if (error) {
      throw error;
    }

    return data;
  }

  async getPackageDetailsByPackageIds(
    packageIds: string[],
  ): Promise<Database['public']['Tables']['packages']['Row'][]> {
    const { data, error } = await this.supabase
      .from('packages')
      .select('*')
      .in('id', packageIds);

    if (error) {
      throw error;
    }

    return data || [];
  }
}
