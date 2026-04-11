import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayThankYouMessage } from '../thankYouMessage';

describe('displayThankYouMessage', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the compact closeout message', () => {
    displayThankYouMessage();
    expect(logSpy).toHaveBeenCalledTimes(2);
    const calls = logSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(calls[0]).toBeUndefined(); // Empty line (console.log() with no arguments)
    expect(calls[1]).toContain('Done.');
    expect(calls[1]).toContain('--help');
    expect(calls[1]).toContain('--about');
  });
});
