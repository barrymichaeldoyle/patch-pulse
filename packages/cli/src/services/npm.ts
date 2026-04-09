import chalk from 'chalk';
import {
  fetchNpmPackageManifest,
} from '@patch-pulse/shared';

import { VERSION } from '../gen/version.gen';
import { displayUpdateAvailable } from '../ui/display/updateAvailable';
import { packageCache } from './cache';

export async function checkForCliUpdate(): Promise<void> {
  try {
    // Check cache first
    const cachedLatestVersion = packageCache.getVersion('patch-pulse');
    if (cachedLatestVersion && cachedLatestVersion !== VERSION) {
      displayUpdateAvailable(VERSION, cachedLatestVersion);
      return;
    }

    const data = await fetchNpmPackageManifest('patch-pulse', {
      userAgent: `patch-pulse-cli/${VERSION}`,
    });
    const latestVersion = data['dist-tags']?.latest;

    if (latestVersion) {
      packageCache.set('patch-pulse', latestVersion, undefined);
      if (latestVersion !== VERSION) {
        displayUpdateAvailable(VERSION, latestVersion);
      }
    }
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 429) {
      return;
    }
    // Only log network errors, not other issues
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // Network error - silently fail
      return;
    }
    // Other errors - silently fail
  }
}
