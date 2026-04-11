import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ansi } from '../ansi';
import { createCenteredBox } from '../createCenteredBox';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Displays the license information
 */
export function displayLicense(): void {
  try {
    const licenseContent = readFileSync(
      join(__dirname, '..', '..', 'LICENSE'),
      'utf-8',
    );
    console.log(`${createCenteredBox('License', 60)}

${ansi.white(licenseContent)}`);
  } catch (error) {
    console.error(ansi.red('Error reading LICENSE file:'), error);
    console.log(ansi.yellow('License: MIT'));
    process.exit(1);
  }
}
