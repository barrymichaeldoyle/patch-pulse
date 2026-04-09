export interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  authed_user: {
    id: string;
  };
  team: {
    name: string;
    id: string;
  };
  enterprise: {
    name: string;
    id: string;
  } | null;
  is_enterprise_install: boolean;
  incoming_webhook: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

export interface SlackSlashBody {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  api_app_id: string;
  is_enterprise_install: boolean;
  response_url: string;
  trigger_id: string;
}

export enum EventType {
  APP_UNINSTALLED = 'app_uninstalled',
}
