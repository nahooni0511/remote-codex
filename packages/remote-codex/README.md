# @everyground/remote-codex

`@everyground/remote-codex` bundles the Remote Codex local runtime into a single npm package.

It installs:

- the local agent server
- the local web UI
- the relay pairing flow

## Install

```bash
./install.sh
```

Run the repository's root `install.sh`. The recommended installer keeps the npm-based distribution path, but installs the package into a managed per-user prefix and registers a macOS `launchd` daemon.

Manual npm installation is still possible, but `install.sh` is the preferred path because it also sets up the background service and boot-time start.

## Service Commands

```bash
remote-codex
remote-codex status
remote-codex logs --follow
remote-codex stop
remote-codex start
```

Then open:

- `http://localhost:3000`

## Requirements

- Node.js 20 or later
- npm
- local Codex login already completed
- Telegram account and API credentials if you use Telegram-backed flows

## Relay Pairing

To connect a device to the hosted relay:

1. sign in on `https://remote-codex.com`
2. issue a pairing code from the devices page
3. open local `Config`
4. enter the pairing code and relay server URL
5. pair the device

## Runtime Data

By default, data is stored in:

- `~/.remote-codex`

Useful environment variables:

- `REMOTE_CODEX_DATA_DIR`: override the runtime data directory
- `REMOTE_CODEX_PORT`: override the local HTTP port
- `REMOTE_CODEX_HOST`: override the local bind host
- `REMOTE_CODEX_PACKAGE_NAME`: override the package used for update checks
- `REMOTE_CODEX_NPM_REGISTRY`: override the npm registry used for update checks

## Update Path

The runtime checks npm for new versions of `@everyground/remote-codex` and can apply updates from the local `Config` screen.
When the runtime is running under `launchd`, the service exits after an update and `launchd` starts the new version automatically.
