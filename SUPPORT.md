# Support

Having an issue with PatchPulse or want to request a feature?

Open an issue on GitHub: [github.com/barrymichaeldoyle/patch-pulse/issues](https://github.com/barrymichaeldoyle/patch-pulse/issues)

## Common issues

**"PatchPulse needs to be invited first"**
For private channels, run `/invite @PatchPulse` in the channel before tracking.

**Not receiving notifications**

- Check `/npmlist` to confirm the package is tracked.
- Confirm the channel or DM subscription is listed.
- Make sure the package has actually released a new version on npm.

**Wrong notification threshold**
Re-run `/npmtrack <package> [minor|major]` with your preferred threshold — it updates in place.

## Commands reference

| Command                          | Description                     |
| -------------------------------- | ------------------------------- |
| `/npmtrack <package>`            | Track a package via DM          |
| `/npmtrack <package> #channel`   | Track a package in a channel    |
| `/npmtrack react vue typescript` | Track multiple packages at once |
| `/npmtrack <package> minor`      | Only notify on minor+ releases  |
| `/npmtrack <package> major`      | Only notify on major releases   |
| `/npmuntrack <package>`          | Stop tracking via DM            |
| `/npmuntrack <package> #channel` | Stop tracking in a channel      |
| `/npmlist`                       | List all tracked packages       |
| `/npmhelp`                       | Show command reference in Slack |
