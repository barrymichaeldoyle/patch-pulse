export class PrivateChannelError extends Error {
  constructor() {
    super("Bot is not a member of this private channel");
    this.name = "PrivateChannelError";
  }
}

// Errors from conversations.join that mean the channel is private or invite-only
const PRIVATE_CHANNEL_ERRORS = new Set(["is_private", "method_not_supported", "cant_invite_self"]);

async function conversationsJoin(token: string, channel: string): Promise<void> {
  const response = await fetch("https://slack.com/api/conversations.join", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

/** Posts a message to a Slack channel, auto-joining public channels if needed. */
export async function chatPostMessage(token: string, channel: string, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await response.json();

  if (!data.ok) {
    if (data.error === "not_in_channel") {
      await conversationsJoin(token, channel);
      return chatPostMessage(token, channel, text);
    }
    throw new Error(`Slack error: ${data.error}`);
  }
}
