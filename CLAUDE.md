<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->

After making code edits, run `pnpm format` before handing work back when the change spans multiple files or packages.

For small, localized changes, `pnpm format:changed` or `pnpm format:staged` is acceptable. A pre-commit hook runs `pnpm format:staged` automatically on staged files, and shared Claude settings run `pnpm format:changed` after edit tools.
