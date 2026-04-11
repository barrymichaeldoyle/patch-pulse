import { fetchNpmPackageManifest } from '@patch-pulse/shared';

import { VERSION } from '../gen/version.gen';
import { displayUpdateAvailable } from '../ui/display/updateAvailable';
import { debugLog } from '../utils/debug';
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
    debugLog(`CLI npm update lookup failed: ${String(error)}`);
    if (error instanceof Error && 'status' in error && error.status === 429) {
      return;
    }
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // Network error (offline, firewall, etc.) — expected, fail silently
      return;
    }
    // Any other unexpected error: already debug-logged above, fail silently.
    // This is a non-critical background check and must not surface to the user.
  }
}
