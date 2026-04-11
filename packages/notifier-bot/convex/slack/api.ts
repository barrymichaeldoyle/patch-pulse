export class PrivateChannelError extends Error {
  constructor() {
    super('Bot is not a member of this private channel');
    this.name = 'PrivateChannelError';
  }
}

export class SlackMissingScopeError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly suggestedScope?: string,
  ) {
    super(`Slack error: missing_scope`);
    this.name = 'SlackMissingScopeError';
  }
}

/** Returns the human-readable name for a channel ID, or undefined if unavailable. */
export async function conversationsInfo(
  token: string,
  channelId: string,
): Promise<string | undefined> {
  const response = await fetch(
    `https://slack.com/api/conversations.info?channel=${channelId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await response.json();
  return data.ok ? (data.channel?.name as string) : undefined;
}

export async function conversationsFindByName(
  token: string,
  channelName: string,
): Promise<{ id: string; name: string } | null> {
  const normalizedChannelName = channelName
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({
      exclude_archived: 'true',
      limit: '1000',
      types: 'public_channel,private_channel',
    });
    if (cursor) query.set('cursor', cursor);

    const response = await fetch(
      `https://slack.com/api/conversations.list?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await response.json();
    if (!data.ok) {
      if (data.error === 'missing_scope') {
        throw new SlackMissingScopeError(
          'conversations.list',
          'channels:read / groups:read',
        );
      }
      throw new Error(`Slack error: ${data.error}`);
    }

    const match = (
      data.channels as Array<{ id?: string; name?: string }> | undefined
    )?.find((channel) => channel.name?.toLowerCase() === normalizedChannelName);
    if (match?.id && match.name) {
      return { id: match.id, name: match.name };
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return null;
}

// Errors from conversations.join that mean the channel is private or invite-only
const PRIVATE_CHANNEL_ERRORS = new Set([
  'is_private',
  'method_not_supported',
  'cant_invite_self',
]);

async function conversationsJoin(
  token: string,
  channel: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel }),
  });
  const data = await response.json();
  if (!data.ok) {
    if (PRIVATE_CHANNEL_ERRORS.has(data.error)) throw new PrivateChannelError();
    throw new Error(`Slack error: ${data.error}`);
  }
}

export type HomePackageEntry = {
  subscriptionId: string;
  packageName: string;
  currentVersion: string;
  githubRepoUrl?: string;
  minUpdateType?: 'patch' | 'minor' | 'major';
  channelId?: string;
  channelName?: string;
  userId?: string;
  lastChecked?: number;
};

function channelLabel(channelId?: string, channelName?: string): string {
  if (channelName) return `#${channelName.replace(/^#/, '')}`;
  if (channelId) return `<#${channelId}>`;
  return 'this channel';
}

function homeThresholdLabel(minUpdateType?: string): string {
  if (!minUpdateType || minUpdateType === 'patch') return 'All updates';
  return minUpdateType === 'major' ? 'Major only' : 'Minor + major';
}

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const TRACK_MODAL_CALLBACK_ID = 'track_modal';

export function trackModalView() {
  return {
    type: 'modal',
    callback_id: TRACK_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: 'Track a package' },
    submit: { type: 'plain_text', text: 'Track' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'package_block',
        label: { type: 'plain_text', text: 'Package name(s)' },
        hint: {
          type: 'plain_text',
          text: 'Space-separate multiple packages: react vue typescript',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'package_input',
          placeholder: { type: 'plain_text', text: 'e.g. react' },
        },
      },
      {
        type: 'input',
        block_id: 'channel_block',
        label: { type: 'plain_text', text: 'Channel' },
        hint: {
          type: 'plain_text',
          text: 'Leave blank to receive notifications via DM',
        },
        optional: true,
        element: {
          type: 'conversations_select',
          action_id: 'channel_input',
          placeholder: { type: 'plain_text', text: 'Select a channel' },
          filter: { include: ['public', 'private'], exclude_bot_users: true },
        },
      },
      {
        type: 'input',
        block_id: 'threshold_block',
        label: { type: 'plain_text', text: 'Notify me on' },
        element: {
          type: 'static_select',
          action_id: 'threshold_input',
          initial_option: {
            text: { type: 'plain_text', text: 'All updates (patch+)' },
            value: 'patch',
          },
          options: [
            {
              text: { type: 'plain_text', text: 'All updates (patch+)' },
              value: 'patch',
            },
            {
              text: { type: 'plain_text', text: 'Minor & major only' },
              value: 'minor',
            },
            {
              text: { type: 'plain_text', text: 'Major only' },
              value: 'major',
            },
          ],
        },
      },
    ],
  };
}

export const MOVE_CHANNEL_MODAL_CALLBACK_ID = 'move_channel_modal';

export function moveChannelModalView(
  subscriptionId: string,
  packageName: string,
) {
  return {
    type: 'modal',
    callback_id: MOVE_CHANNEL_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ subscriptionId, packageName }),
    title: { type: 'plain_text', text: 'Move to channel' },
    submit: { type: 'plain_text', text: 'Move' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Move *${packageName}* notifications to a different channel.`,
        },
      },
      {
        type: 'input',
        block_id: 'channel_block',
        label: { type: 'plain_text', text: 'New channel' },
        element: {
          type: 'conversations_select',
          action_id: 'channel_input',
          placeholder: { type: 'plain_text', text: 'Select a channel' },
          filter: { include: ['public', 'private'], exclude_bot_users: true },
        },
      },
    ],
  };
}

export async function openMoveChannelModal(
  token: string,
  triggerId: string,
  subscriptionId: string,
  packageName: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: moveChannelModalView(subscriptionId, packageName),
    }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack views.open error: ${data.error}`);
}

export async function openTrackModal(
  token: string,
  triggerId: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ trigger_id: triggerId, view: trackModalView() }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack views.open error: ${data.error}`);
}

/** Publishes a Block Kit view to a user's App Home tab. */
export async function publishAppHome(
  token: string,
  viewingUserId: string,
  entries?: HomePackageEntry[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'PatchPulse 📦' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Get notified in Slack when your npm packages release updates.',
      },
    },
    { type: 'divider' },
  ];

  // "Track a package" button always at the top
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '＋  Track a package' },
        style: 'primary',
        action_id: 'track_package',
      },
    ],
  });

  if (entries && entries.length > 0) {
    // Group by destination key, sort DM before channels
    const groups = new Map<
      string,
      { heading: string; entries: HomePackageEntry[] }
    >();
    for (const entry of [...entries].sort((a, b) =>
      a.packageName.localeCompare(b.packageName),
    )) {
      const key = entry.channelId
        ? `channel:${entry.channelId}`
        : `dm:${entry.userId}`;
      const heading = entry.channelId
        ? `📣 *${channelLabel(entry.channelId, entry.channelName)}*`
        : `💬 *Your DMs*`;
      const existing = groups.get(key);
      if (existing) existing.entries.push(entry);
      else groups.set(key, { heading, entries: [entry] });
    }

    const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
      const aIsDm = a.startsWith('dm:');
      const bIsDm = b.startsWith('dm:');
      if (aIsDm !== bIsDm) return aIsDm ? -1 : 1;
      return a.localeCompare(b);
    });

    const totalSubs = entries.length;
    const uniquePkgs = new Set(entries.map((e) => e.packageName)).size;
    const summary =
      uniquePkgs === totalSubs
        ? `Tracking *${totalSubs}* package${totalSubs === 1 ? '' : 's'}`
        : `Tracking *${uniquePkgs}* package${uniquePkgs === 1 ? '' : 's'} across *${totalSubs}* subscriptions`;
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } });

    for (const [, { heading, entries: groupEntries }] of sortedGroups) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: heading } });
      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*Package*' },
          { type: 'mrkdwn', text: '*Version*' },
          { type: 'mrkdwn', text: '*Notify on*' },
        ],
      });

      for (const entry of groupEntries) {
        const npmUrl = `https://www.npmjs.com/package/${entry.packageName}`;
        const versionText = entry.githubRepoUrl
          ? `<${entry.githubRepoUrl}/releases|${entry.currentVersion}>`
          : entry.currentVersion;
        const thresholdLabel = homeThresholdLabel(entry.minUpdateType);

        const sid = entry.subscriptionId;

        // Build threshold change options — only show options different from current
        const allThresholds: Array<{
          label: string;
          value: 'patch' | 'minor' | 'major';
        }> = [
          { label: 'All updates (patch+)', value: 'patch' },
          { label: 'Minor & major only', value: 'minor' },
          { label: 'Major only', value: 'major' },
        ];
        const currentThreshold = entry.minUpdateType ?? 'patch';
        const thresholdOptions = allThresholds
          .filter((t) => t.value !== currentThreshold)
          .map((t) => ({
            text: { type: 'plain_text', text: `🔔  ${t.label}` },
            value: JSON.stringify({ a: 't', t: t.value, s: sid }),
          }));

        const moveOption = {
          text: { type: 'plain_text', text: '↪️  Move to channel…' },
          value: JSON.stringify({ a: 'm', s: sid }),
        };

        const untrackOption = {
          text: { type: 'plain_text', text: '🗑️  Untrack' },
          value: JSON.stringify({ a: 'u', s: sid }),
        };

        blocks.push({
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `<${npmUrl}|${entry.packageName}>`,
            },
            {
              type: 'mrkdwn',
              text: versionText,
            },
            {
              type: 'mrkdwn',
              text: thresholdLabel,
            },
          ],
          accessory: {
            type: 'overflow',
            action_id: 'package_menu',
            options: [...thresholdOptions, moveOption, untrackOption],
          },
        });
      }
    }

    // Last checked footer
    const lastChecked = entries.reduce(
      (max, e) => Math.max(max, e.lastChecked ?? 0),
      0,
    );
    if (lastChecked > 0) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Last checked ${relativeTime(lastChecked)}` },
        ],
      });
    }
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "You're not tracking any packages yet. Click *Track a package* above or run `/npmtrack <package>` in any channel.",
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*/npmtrack <pkg>* — track via DM' }],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '*/npmtrack <pkg> #channel* — track in a channel',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '*/npmtrack <pkg> minor|major* — set update threshold',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '*/npmuntrack <pkg>* — stop tracking' },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '*/npmlist* — list all tracked packages   •   */npmhelp* — full reference',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '💡 Re-run `/npmtrack` with a different threshold to update it in place. For private channels, run `/invite @PatchPulse` first.',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '🐛 Found a bug or have a feature request? <https://github.com/barrymichaeldoyle/patch-pulse/issues|Open an issue on GitHub>',
        },
      ],
    },
  );

  const response = await fetch('https://slack.com/api/views.publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id: viewingUserId,
      view: { type: 'home', blocks },
    }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack views.publish error: ${data.error}`);
}

/** Posts a message to a Slack channel, auto-joining public channels if needed. */
export async function chatPostMessage(
  token: string,
  channel: string,
  text: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await response.json();

  if (!data.ok) {
    if (data.error === 'not_in_channel') {
      await conversationsJoin(token, channel);
      return chatPostMessage(token, channel, text);
    }
    throw new Error(`Slack error: ${data.error}`);
  }
}
