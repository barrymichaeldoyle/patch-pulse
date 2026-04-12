import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = 'https://barrymichaeldoyle.github.io';
const base = process.env.DOCS_BASE_PATH;

export default defineConfig({
  site,
  ...(base ? { base } : {}),
  integrations: [
    starlight({
      title: 'Patch Pulse',
      description: 'Keep a pulse on your npm dependencies.',
      customCss: ['./src/styles/custom.css'],
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/DarkThemeProvider.astro',
        ThemeSelect: './src/components/ThemeTogglePlaceholder.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/barrymichaeldoyle/patch-pulse',
        },
      ],
      sidebar: [
        { label: 'Introduction', link: '/introduction' },
        {
          label: 'CLI',
          items: [
            { label: 'Overview', link: '/cli/overview' },
            { label: 'Commands & Flags', link: '/cli/commands' },
            { label: 'Configuration', link: '/cli/configuration' },
          ],
        },
        {
          label: 'VS Code Extension',
          items: [
            { label: 'Overview', link: '/vscode/overview' },
            { label: 'Settings', link: '/vscode/settings' },
          ],
        },
        { label: 'Slack Bot', link: '/slack-bot' },
      ],
    }),
  ],
});
