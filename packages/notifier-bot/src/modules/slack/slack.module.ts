import { Module } from '@nestjs/common';

import { NpmService } from '../../services/npm/npm.service';
import { SupabaseService } from '../../services/supabase/supabase.service';
import { SlackService } from './slack.service';
import { SlackController } from './slack.controller';

@Module({
  controllers: [SlackController],
  providers: [SlackService, SupabaseService, NpmService],
})
export class SlackModule {}
