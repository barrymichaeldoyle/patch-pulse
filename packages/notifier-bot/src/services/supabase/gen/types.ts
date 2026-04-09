export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      activity_log: {
        Row: {
          activity_type: string;
          error_details: string | null;
          external_reference: string | null;
          id: number;
          ip_address: string | null;
          message: string | null;
          notification_channel: string | null;
          package_id: string | null;
          package_version: string | null;
          response_time: number | null;
          status: string | null;
          subscriber_id: string | null;
          timestamp: string | null;
          user_agent: string | null;
        };
        Insert: {
          activity_type: string;
          error_details?: string | null;
          external_reference?: string | null;
          id?: number;
          ip_address?: string | null;
          message?: string | null;
          notification_channel?: string | null;
          package_id?: string | null;
          package_version?: string | null;
          response_time?: number | null;
          status?: string | null;
          subscriber_id?: string | null;
          timestamp?: string | null;
          user_agent?: string | null;
        };
        Update: {
          activity_type?: string;
          error_details?: string | null;
          external_reference?: string | null;
          id?: number;
          ip_address?: string | null;
          message?: string | null;
          notification_channel?: string | null;
          package_id?: string | null;
          package_version?: string | null;
          response_time?: number | null;
          status?: string | null;
          subscriber_id?: string | null;
          timestamp?: string | null;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_log_package_id_fkey';
            columns: ['package_id'];
            referencedRelation: 'packages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_log_subscriber_id_fkey';
            columns: ['subscriber_id'];
            referencedRelation: 'subscribers';
            referencedColumns: ['id'];
          },
        ];
      };
      packages: {
        Row: {
          current_version: string;
          ecosystem: string | null;
          id: string;
          last_checked: string | null;
          name: string;
        };
        Insert: {
          current_version: string;
          ecosystem?: string | null;
          id?: string;
          last_checked?: string | null;
          name: string;
        };
        Update: {
          current_version?: string;
          ecosystem?: string | null;
          id?: string;
          last_checked?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      slack_subscriber_details: {
        Row: {
          access_token: string | null;
          bot_user_id: string | null;
          created_at: string | null;
          subscriber_id: string;
          team_id: string | null;
          team_name: string | null;
          updated_at: string | null;
          webhook_channel: string | null;
          webhook_channel_id: string | null;
          webhook_configuration_url: string | null;
          webhook_url: string | null;
        };
        Insert: {
          access_token?: string | null;
          bot_user_id?: string | null;
          created_at?: string | null;
          subscriber_id: string;
          team_id?: string | null;
          team_name?: string | null;
          updated_at?: string | null;
          webhook_channel?: string | null;
          webhook_channel_id?: string | null;
          webhook_configuration_url?: string | null;
          webhook_url?: string | null;
        };
        Update: {
          access_token?: string | null;
          bot_user_id?: string | null;
          created_at?: string | null;
          subscriber_id?: string;
          team_id?: string | null;
          team_name?: string | null;
          updated_at?: string | null;
          webhook_channel?: string | null;
          webhook_channel_id?: string | null;
          webhook_configuration_url?: string | null;
          webhook_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'slack_subscriber_details_subscriber_id_fkey';
            columns: ['subscriber_id'];
            referencedRelation: 'subscribers';
            referencedColumns: ['id'];
          },
        ];
      };
      subscribers: {
        Row: {
          active: boolean;
          id: string;
          identifier: string;
          type: string;
        };
        Insert: {
          active?: boolean;
          id?: string;
          identifier: string;
          type: string;
        };
        Update: {
          active?: boolean;
          id?: string;
          identifier?: string;
          type?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          last_notified_version: string;
          package_id: string | null;
          subscriber_id: string | null;
          subscription_date: string | null;
        };
        Insert: {
          id?: string;
          last_notified_version: string;
          package_id?: string | null;
          subscriber_id?: string | null;
          subscription_date?: string | null;
        };
        Update: {
          id?: string;
          last_notified_version?: string;
          package_id?: string | null;
          subscriber_id?: string | null;
          subscription_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_package_id_fkey';
            columns: ['package_id'];
            referencedRelation: 'packages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_subscriber_id_fkey';
            columns: ['subscriber_id'];
            referencedRelation: 'subscribers';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
