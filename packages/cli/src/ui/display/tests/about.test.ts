import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayAbout } from '../about';

describe('displayAbout', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints project links and support info', () => {
    displayAbout();
    const output = logSpy.mock.calls
      .map((call: unknown[]) => call[0])
      .join('\n');
    expect(output).toContain('About Patch Pulse');
    expect(output).toContain('zero runtime dependencies');
    expect(output).toContain('--json');
    expect(output).toContain('barrymichaeldoyle.github.io/patch-pulse');
    expect(output).toContain('barrymichaeldoyle/patch-pulse');
    expect(output).toContain('GitHub Sponsors');
    expect(output).toContain('Patch Pulse Slack bot');
  });
});
