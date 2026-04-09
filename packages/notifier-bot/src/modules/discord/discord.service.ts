import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, GatewayIntentBits, REST } from 'discord.js';
import { Routes } from 'discord.js';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  private discordBotToken: string | undefined;
  private clientId: string | undefined; // Client ID is needed to register commands

  constructor(private configService: ConfigService) {
    this.discordBotToken = this.configService.get<string>('DISCORD_BOT_TOKEN');
    this.clientId = this.configService.get<string>('DISCORD_CLIENT_ID'); // Make sure to set this in your .env or wherever you manage your configuration
  }

  async onModuleInit() {
    this.client.on('ready', async () => {
      console.log(`Logged in as ${this.client.user?.tag || '<Unknown>'}!`);

      await this.registerCommands();
    });

    this.client.on('interactionCreate', async (interaction) => {
      this.logger.verbose('interactionCreate:', interaction);
      if (!interaction.isChatInputCommand()) {
        return;
      }

      if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
      }
    });

    await this.client.login(this.discordBotToken);
  }

  async registerCommands() {
    if (!this.clientId || !this.discordBotToken) {
      throw new Error('Missing Discord Client ID or Bot Token');
    }

    const commands = [
      {
        name: 'ping',
        description: 'Replies with Pong!',
      },
      // Add other commands here
    ];

    const rest = new REST({ version: '10' }).setToken(this.discordBotToken);

    try {
      console.log('Started refreshing application (/) commands.');

      await rest.put(
        Routes.applicationCommands(this.clientId), // use the client ID from your config
        { body: commands },
      );

      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  }
}
