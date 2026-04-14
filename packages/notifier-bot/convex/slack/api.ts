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

export const MANAGE_MODAL_CALLBACK_ID = 'manage_modal';
export const MANAGE_ACTIONS_MODAL_CALLBACK_ID = 'manage_actions_modal';
export function manageModalView(entries: HomePackageEntry[]) {
  const sorted = [...entries].sort((a, b) =>
    a.packageName.localeCompare(b.packageName),
  );
  const options = sorted.map((entry) => {
    const dest = entry.channelName
      ? `#${entry.channelName}`
      : entry.channelId
        ? `<#${entry.channelId}>`
        : 'DM';
    const label = `${entry.packageName} (${dest})`.slice(0, 75);
    return {
      text: { type: 'plain_text', text: label },
      value: entry.subscriptionId,
    };
  });
  return {
    type: 'modal',
    callback_id: MANAGE_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: 'Manage a package' },
    submit: { type: 'plain_text', text: 'Next' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'subscription_block',
        label: { type: 'plain_text', text: 'Package' },
        element: {
          type: 'static_select',
          action_id: 'subscription_input',
          placeholder: { type: 'plain_text', text: 'Select a package…' },
          options,
        },
      },
    ],
  };
}

export function manageActionsModalView(entry: HomePackageEntry) {
  const allThresholds = [
    {
      text: { type: 'plain_text', text: 'All updates (patch+)' },
      value: 'patch',
    },
    {
      text: { type: 'plain_text', text: 'Minor & major only' },
      value: 'minor',
    },
    { text: { type: 'plain_text', text: 'Major only' }, value: 'major' },
  ];
  const currentThreshold = entry.minUpdateType ?? 'patch';
  const initialOption = allThresholds.find(
    (t) => t.value === currentThreshold,
  )!;
  const actionValue = JSON.stringify({
    s: entry.subscriptionId,
    p: entry.packageName,
  });
  return {
    type: 'modal',
    callback_id: MANAGE_ACTIONS_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ subscriptionId: entry.subscriptionId }),
    title: { type: 'plain_text', text: 'Manage package' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Back' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${entry.packageName}*  \`${entry.currentVersion}\``,
        },
      },
      {
        type: 'input',
        block_id: 'threshold_block',
        label: { type: 'plain_text', text: 'Notify me on' },
        element: {
          type: 'static_select',
          action_id: 'threshold_input',
          initial_option: initialOption,
          options: allThresholds,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '↪️  Move to channel…' },
            action_id: 'manage_move',
            value: actionValue,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🗑️  Untrack' },
            action_id: 'manage_untrack',
            style: 'danger',
            value: actionValue,
            confirm: {
              title: { type: 'plain_text', text: 'Untrack package' },
              text: {
                type: 'mrkdwn',
                text: `Stop tracking *${entry.packageName}*?`,
              },
              confirm: { type: 'plain_text', text: 'Untrack' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
        ],
      },
    ],
  };
}

export async function openManageModal(
  token: string,
  triggerId: string,
  entries: HomePackageEntry[],
): Promise<void> {
  const response = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: manageModalView(entries),
    }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack views.open error: ${data.error}`);
}

export async function pushMoveChannelModal(
  token: string,
  triggerId: string,
  subscriptionId: string,
  packageName: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/views.push', {
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
  if (!data.ok) throw new Error(`Slack views.push error: ${data.error}`);
}

export async function updateSlackView(
  token: string,
  viewId: string,
  view: object,
): Promise<void> {
  const response = await fetch('https://slack.com/api/views.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ view_id: viewId, view }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack views.update error: ${data.error}`);
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

  const actionButtons: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '＋  Track a package' },
      style: 'primary',
      action_id: 'track_package',
    },
  ];
  if (entries && entries.length > 0) {
    actionButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: '⚙️  Manage a package' },
      action_id: 'manage_package',
    });
  }
  blocks.push({ type: 'actions', elements: actionButtons });

  if (entries && entries.length > 0) {
    // Group by destination key, sort DM before channels
    const groups = new Map<
      string,
      { heading: string; entries: HomePackageEntry[] }
    >();
    for (const entry of [...entries].sort((a, b) =>
      a.packageName.localeCompare(b.packageName),
    )) {
      // Group by channel name (when resolved) to avoid duplicates from ID mismatches,
      // falling back to channel ID, then DM user ID.
      const key = entry.channelId
        ? `channel:${(entry.channelName ?? entry.channelId).toLowerCase()}`
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
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: heading } });

      for (const entry of groupEntries) {
        const npmUrl = `https://www.npmjs.com/package/${entry.packageName}`;
        const versionText = entry.githubRepoUrl
          ? `<${entry.githubRepoUrl}/releases|${entry.currentVersion}>`
          : `\`${entry.currentVersion}\``;
        const thresholdLabel = homeThresholdLabel(entry.minUpdateType);
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${npmUrl}|${entry.packageName}>*  ${versionText}  ·  ${thresholdLabel}`,
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
): Promise<{ ts: string }> {
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

  return { ts: data.ts as string };
}

/** Edits an existing Slack message in-place. */
export async function chatUpdateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, ts, text }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack chat.update error: ${data.error}`);
}
