import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { chatPostMessage, publishAppHome } from "./api";
import { bannerPngBase64 } from "./bannerAsset";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function renderOAuthPage({
  title,
  eyebrow,
  message,
}: {
  title: string;
  eyebrow: string;
  message: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #020303;
        --panel: rgba(255, 255, 255, 0.03);
        --ink: #f5f7f7;
        --muted: #96a09b;
        --line: rgba(48, 255, 176, 0.18);
        --accent: #29f2b0;
        --accent-strong: #1cffb7;
        --shadow: 0 30px 90px rgba(0, 0, 0, 0.55);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 20% 18%, rgba(41, 242, 176, 0.12), transparent 24%),
          radial-gradient(circle at 80% 78%, rgba(41, 242, 176, 0.07), transparent 24%),
          linear-gradient(180deg, #040606, var(--bg));
      }

      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }

      .card {
        position: relative;
        width: min(100%, 960px);
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 32px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
          var(--panel);
        box-shadow: var(--shadow);
      }

      .card::before,
      .card::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .card::before {
        background:
          linear-gradient(90deg, transparent, rgba(41, 242, 176, 0.18), transparent);
        transform: translateY(92px);
      }

      .card::after {
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
        background-size: 100% 36px, 36px 100%;
        opacity: 0.28;
      }

      .content {
        position: relative;
        display: grid;
        gap: 40px;
        padding: 44px;
      }

      .hero {
        display: grid;
        gap: 20px;
        width: min(100%, 820px);
        margin: 0 auto;
      }

      .signal {
        display: flex;
        align-items: center;
        gap: 18px;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 0.82rem;
        font-weight: 700;
      }

      .signal::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent-strong);
        box-shadow: 0 0 0 7px rgba(28, 255, 183, 0.14);
      }

      .brand-banner {
        display: block;
        width: min(100%, 820px);
        height: auto;
        margin: 0 auto;
        border-radius: 20px;
        box-shadow:
          inset 0 0 0 1px rgba(41, 242, 176, 0.08),
          0 20px 40px rgba(0, 0, 0, 0.35);
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.6rem);
        line-height: 0.92;
        letter-spacing: -0.04em;
      }

      p {
        margin: 0;
        max-width: 60ch;
        font-size: 1.06rem;
        line-height: 1.75;
        color: var(--muted);
      }

      .brand {
        display: inline-block;
        font-weight: 800;
        color: var(--ink);
      }

      .copy {
        display: grid;
        gap: 16px;
        width: min(100%, 820px);
        margin: 0 auto;
      }

      .success {
        color: var(--accent);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-size: 0.82rem;
      }

      .hint {
        margin-top: 12px;
        padding-top: 18px;
        border-top: 1px solid rgba(41, 242, 176, 0.14);
        font-size: 0.96rem;
        max-width: 540px;
      }

      .hint strong {
        color: var(--ink);
      }

      @media (max-width: 640px) {
        .content {
          gap: 28px;
          padding: 24px;
        }

        .signal {
          gap: 14px;
          font-size: 0.74rem;
          letter-spacing: 0.14em;
        }

        h1 {
          font-size: clamp(2.1rem, 11vw, 3rem);
        }

        p {
          font-size: 1rem;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="content">
          <div class="hero">
            <div class="signal">${escapeHtml(eyebrow)}</div>
            <img class="brand-banner" src="/slack/banner.png" alt="PatchPulse banner" />
          </div>
          <div class="copy">
            <div class="success">${escapeHtml(title)}</div>
            <h1>Your workspace is now connected.</h1>
            <p>${message}</p>
            <p class="hint"><strong>Next step:</strong> close this tab and head back to Slack.</p>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderConnectedPage(teamName: string) {
  return renderOAuthPage({
    title: "Slack connected",
    eyebrow: "Installation complete",
    message: `You’ve successfully linked <span class="brand">PatchPulse</span> to <span class="brand">${escapeHtml(teamName)}</span>.`,
  });
}

export const slackInstall = httpAction(async (_ctx, _request) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", "chat:write,commands,channels:join,channels:read,groups:read");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl.toString() },
  });
});

export const slackBannerImage = httpAction(async () => {
  const bytes = decodeBase64(bannerPngBase64);

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

export const slackOAuthPreview = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const teamName = url.searchParams.get("team")?.trim() || "Acme Engineering";

  return new Response(renderConnectedPage(teamName), {
    headers: { "Content-Type": "text/html" },
  });
});

export const slackOAuthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  try {
    const tokenUrl = new URL("https://slack.com/api/oauth.v2.access");
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);

    const response = await fetch(tokenUrl.toString());
    const data = await response.json();

    if (!data.ok) {
      console.error("Slack OAuth error:", data.error);
      return new Response("Error during Slack OAuth", { status: 500 });
    }

    await ctx.runMutation(internal.subscribers.upsertSlackWorkspace, {
      accessToken: data.access_token,
      botUserId: data.bot_user_id,
      teamId: data.team.id,
      teamName: data.team.name,
    });

    try {
      await publishAppHome(data.access_token, data.authed_user.id);
    } catch (error) {
      console.warn("Could not publish App Home on install:", error);
    }

    try {
      await chatPostMessage(
        data.access_token,
        data.authed_user.id,
        `*PatchPulse* has been connected to *${data.team.name}* successfully! 🎉\n\n` +
          `Here's how to use it:\n` +
          `• \`/npmtrack react\` — track a package via DM\n` +
          `• \`/npmtrack react vue typescript\` — track multiple packages at once\n` +
          `• \`/npmtrack react #frontend\` — track a package in a channel\n` +
          `• \`/npmtrack react major\` — only notify on major releases\n` +
          `• \`/npmuntrack react\` — stop tracking a package\n` +
          `• \`/npmuntrack react #frontend\` — stop tracking in a specific channel\n` +
          `• \`/npmlist\` — see all your tracked packages`,
      );
    } catch (error) {
      // A failed welcome DM is non-fatal — the workspace is already connected.
      console.warn("Could not send welcome DM to installing user:", error);
    }

    return new Response(renderConnectedPage(data.team.name), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("Error during OAuth code exchange:", error);
    return new Response("Error during code exchange", { status: 500 });
  }
});
