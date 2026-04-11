const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

export const stripAnsi = (str: string) => str.replace(ANSI_PATTERN, '');
