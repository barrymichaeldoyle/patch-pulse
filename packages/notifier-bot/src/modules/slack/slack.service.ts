import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import axios from 'axios';

@Injectable()
export class SlackService {
  private readonly slackClient: WebClient;
  private readonly logger = new Logger(SlackService.name);

  constructor(private configService: ConfigService) {
    const slackToken = this.configService.get<string>('SLACK_OAUTH_TOKEN');
    this.slackClient = new WebClient(slackToken);
  }

  async sendMessageToSlack(url: string, message: string) {
    try {
      const response = await axios.post(url, {
        text: message,
      });
      this.logger.verbose('message sent:', response.data);
    } catch (error) {
      this.logger.error('error sending message to Slack:', error);
    }
  }
}
