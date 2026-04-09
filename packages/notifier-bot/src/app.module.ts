import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DiscordModule } from './modules/discord/discord.module';
import { SlackModule } from './modules/slack/slack.module';
import { NpmService } from './services/npm/npm.service';
import { PollingService } from './services/polling/polling.service';
import { SupabaseService } from './services/supabase/supabase.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    DiscordModule,
    SlackModule,
  ],
  controllers: [AppController],
  providers: [AppService, NpmService, PollingService, SupabaseService],
})
export class AppModule {}
