function isDebugEnabled(): boolean {
  return process.env.PATCH_PULSE_DEBUG === '1';
}

export function debugLog(message: string): void {
  if (!isDebugEnabled()) {
    return;
  }

  console.error(`[patch-pulse:debug] ${message}`);
}
