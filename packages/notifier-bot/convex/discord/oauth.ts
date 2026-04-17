import { httpAction } from '../_generated/server';
import { registerGlobalCommands } from './api';

export const discordInstall = httpAction(async (_ctx, _request) => {
  const clientId =
    process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_APPLICATION_ID;

  if (!clientId) {
    return new Response('Server misconfiguration', { status: 500 });
  }

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', 'bot applications.commands');
  authorizeUrl.searchParams.set('permissions', '3072'); // VIEW_CHANNEL + SEND_MESSAGES
  authorizeUrl.searchParams.set('integration_type', '0');

  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl.toString() },
  });
});

/** Setup endpoint — call once after deploy to register slash commands globally. */
export const discordRegisterCommands = httpAction(async (_ctx, request) => {
  const expectedSecret = process.env.DISCORD_REGISTER_COMMANDS_SECRET;
  if (!expectedSecret) {
    return new Response('DISCORD_REGISTER_COMMANDS_SECRET not set', {
      status: 500,
    });
  }

  const providedSecret = request.headers.get('x-patchpulse-secret');
  if (providedSecret !== expectedSecret) {
    return new Response('Forbidden', { status: 403 });
  }

  const applicationId =
    process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_CLIENT_ID;
  if (!applicationId) {
    return new Response('DISCORD_APPLICATION_ID or DISCORD_CLIENT_ID not set', {
      status: 500,
    });
  }

  try {
    await registerGlobalCommands(applicationId);
    return new Response('Slash commands registered successfully.', {
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Failed to register commands: ${message}`, {
      status: 500,
    });
  }
});
