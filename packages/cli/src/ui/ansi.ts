const ANSI_CODES = {
  blue: 34,
  bold: 1,
  cyan: 36,
  gray: 90,
  green: 32,
  magenta: 35,
  magentaBright: 95,
  red: 31,
  underline: 4,
  white: 37,
  yellow: 33,
} as const;

function supportsAnsi(): boolean {
  const env = globalThis.process?.env ?? {};
  const stdout = globalThis.process?.stdout;

  if (env.NO_COLOR) {
    return false;
  }

  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') {
    return true;
  }

  return Boolean(stdout?.isTTY);
}

function supportsHyperlinks(): boolean {
  const env = globalThis.process?.env ?? {};
  const stdout = globalThis.process?.stdout;

  if (!stdout?.isTTY || env.TERM === 'dumb') {
    return false;
  }

  if (env.FORCE_HYPERLINK && env.FORCE_HYPERLINK !== '0') {
    return true;
  }

  return Boolean(
    env.KITTY_WINDOW_ID ||
    env.TERM_PROGRAM ||
    env.VTE_VERSION ||
    env.WT_SESSION,
  );
}

function format(value: unknown, codes: number[]): string {
  const text = String(value);

  if (!supportsAnsi()) {
    return text;
  }

  const open = codes.map((code) => `\u001B[${code}m`).join('');
  return `${open}${text}\u001B[0m`;
}

export const ansi = {
  blue: (value: unknown) => format(value, [ANSI_CODES.blue]),
  blueBold: (value: unknown) =>
    format(value, [ANSI_CODES.blue, ANSI_CODES.bold]),
  cyan: (value: unknown) => format(value, [ANSI_CODES.cyan]),
  cyanBold: (value: unknown) =>
    format(value, [ANSI_CODES.cyan, ANSI_CODES.bold]),
  cyanBoldUnderline: (value: unknown) =>
    format(value, [ANSI_CODES.cyan, ANSI_CODES.bold, ANSI_CODES.underline]),
  gray: (value: unknown) => format(value, [ANSI_CODES.gray]),
  green: (value: unknown) => format(value, [ANSI_CODES.green]),
  magenta: (value: unknown) => format(value, [ANSI_CODES.magenta]),
  magentaBrightBold: (value: unknown) =>
    format(value, [ANSI_CODES.magentaBright, ANSI_CODES.bold]),
  red: (value: unknown) => format(value, [ANSI_CODES.red]),
  redBold: (value: unknown) => format(value, [ANSI_CODES.red, ANSI_CODES.bold]),
  link: (label: string, url: string) => {
    if (!supportsHyperlinks()) {
      return label === url ? url : `${label} (${url})`;
    }

    return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
  },
  underline: (value: unknown) => format(value, [ANSI_CODES.underline]),
  white: (value: unknown) => format(value, [ANSI_CODES.white]),
  whiteBold: (value: unknown) =>
    format(value, [ANSI_CODES.white, ANSI_CODES.bold]),
  whiteUnderline: (value: unknown) =>
    format(value, [ANSI_CODES.white, ANSI_CODES.underline]),
  yellow: (value: unknown) => format(value, [ANSI_CODES.yellow]),
  yellowBold: (value: unknown) =>
    format(value, [ANSI_CODES.yellow, ANSI_CODES.bold]),
};
