export class DiscordMissingAccessError extends Error {
  constructor() {
    super('Bot lacks permission to send messages in this channel');
    this.name = 'DiscordMissingAccessError';
  }
}

function botHeaders(): HeadersInit {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bot ${token}`,
  };
}

export async function sendChannelMessage(
  channelId: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { code?: number };
    if (response.status === 403 || data.code === 50013) {
      throw new DiscordMissingAccessError();
    }
    throw new Error(
      `Discord sendChannelMessage ${response.status}: ${JSON.stringify(data)}`,
    );
  }
}

export async function editInteractionReply(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`Discord editInteractionReply ${response.status}: ${text}`);
  }
}

export async function sendFollowUpMessage(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const EPHEMERAL = 64;
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, flags: EPHEMERAL }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`Discord sendFollowUpMessage ${response.status}: ${text}`);
  }
}

export async function getGuildName(
  guildId: string,
): Promise<string | undefined> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return undefined;

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}`,
    { headers: { Authorization: `Bot ${token}` } },
  );
  if (!response.ok) return undefined;
  const data = (await response.json()) as { name?: string };
  return data.name;
}

export async function getChannelName(
  channelId: string,
): Promise<string | undefined> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return undefined;

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}`,
    { headers: { Authorization: `Bot ${token}` } },
  );
  if (!response.ok) return undefined;
  const data = (await response.json()) as { name?: string };
  return data.name;
}

export async function registerGlobalCommands(
  applicationId: string,
): Promise<void> {
  const commands = [
    {
      name: 'npmtrack',
      description: 'Track an npm package for version updates',
      options: [
        {
          name: 'package',
          description: 'Package name (e.g. react)',
          type: 3,
          required: true,
        },
        {
          name: 'channel',
          description:
            'Channel to post notifications in (defaults to current channel)',
          type: 7,
          required: false,
        },
        {
          name: 'filter',
          description:
            'Minimum update type to notify on (default: all updates)',
          type: 3,
          required: false,
          choices: [
            { name: 'All updates (patch, minor, major)', value: 'patch' },
            { name: 'Minor and major only', value: 'minor' },
            { name: 'Major only', value: 'major' },
          ],
        },
      ],
    },
    {
      name: 'npmuntrack',
      description: 'Stop tracking an npm package',
      options: [
        {
          name: 'package',
          description: 'Package name to stop tracking',
          type: 3,
          required: true,
        },
        {
          name: 'channel',
          description:
            'Channel subscription to remove (defaults to current channel)',
          type: 7,
          required: false,
        },
      ],
    },
    {
      name: 'npmlist',
      description: 'List all npm packages tracked in this server',
    },
  ];

  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/commands`,
    {
      method: 'PUT',
      headers: botHeaders(),
      body: JSON.stringify(commands),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Discord registerGlobalCommands ${response.status}: ${text}`,
    );
  }
}
