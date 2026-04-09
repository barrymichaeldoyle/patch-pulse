import { Injectable, Logger } from '@nestjs/common';
import { fetchNpmLatestVersion } from '@patch-pulse/shared';

type NpmLatestRelease = {
  version: string;
};

@Injectable()
export class NpmService {
  private readonly logger = new Logger(NpmService.name);

  async fetchNpmData(
    packageName: string,
  ): Promise<{ npmData?: NpmLatestRelease; error?: Error }> {
    try {
      const version = await fetchNpmLatestVersion(packageName, {
        userAgent: 'patch-pulse-notifier-bot',
      });

      if (!version) {
        return {
          error: new Error(
            `Failed to resolve latest version for ${packageName}`,
          ),
        };
      }

      return { npmData: { version } };
    } catch (error) {
      this.logger.error(
        `Failed to fetch npm data for package ${packageName}`,
        error instanceof Error ? error.message : String(error),
      );
      return {
        error: new Error(`Failed to fetch npm data for package ${packageName}`),
      };
    }
  }
}
