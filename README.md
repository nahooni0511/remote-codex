[한국어로 보기](README.ko.md)

# Remote Codex

Remote Codex is a web-first runtime for controlling a Codex-enabled PC from the web. It supports Telegram integration today, and a mobile app is planned, but this README focuses on the current web-based flow.

> The most stable documented path today is local web plus hosted relay web.

## Overview

Remote Codex runs across two planes:

- `local runtime`: runs on the PC where Codex is installed and includes the local web UI, Telegram integration, and relay bridge
- `hosted relay`: the control plane that lets an authenticated user find and connect to their paired devices remotely
- `local web`: the UI you open directly on the local machine or local network
- `remote web`: the UI you open on `remote-codex.com`, which reaches the paired device through the relay

In practice, you can use the local web directly on your machine and use the hosted relay web when you need remote access to the same workspace.

## Quick Start

This section is optimized for the packaged install path, not monorepo development.

### Requirements

- Node.js 20 or later
- npm
- Codex login already completed on the local machine
- Telegram account, `api_id`, `api_hash`, and bot token if you want Telegram-backed flows

### Install

```bash
./install.sh
```

The installer:

- ensures Node.js 20+ and npm exist
- installs `@everyground/remote-codex` through npm into `~/.remote-codex/npm-global`
- checks Codex login
- registers a macOS `launchd` service that starts at boot

### Service Commands

```bash
remote-codex
remote-codex status
remote-codex logs --follow
remote-codex stop
remote-codex start
```

Then open:

- `http://localhost:3000`

### Default Data Directory

- `~/.remote-codex`

### Common Environment Variables

| Variable | Description |
| --- | --- |
| `REMOTE_CODEX_DATA_DIR` | Overrides the runtime data directory |
| `REMOTE_CODEX_PORT` | Overrides the local HTTP port |
| `REMOTE_CODEX_HOST` | Overrides the local bind host |
| `REMOTE_CODEX_PACKAGE_NAME` | Overrides the package used for update checks |
| `REMOTE_CODEX_NPM_REGISTRY` | Overrides the npm registry used for update checks |

More package-specific details are available in [packages/remote-codex/README.md](packages/remote-codex/README.md).

## Web-Based Usage

Remote Codex is currently documented as a web-first product.

### Local Web

After starting the local runtime and opening `http://localhost:3000`, the main screens are:

- `Chat`: open projects and threads and talk to Codex directly
- `Config`: manage model preferences, updates, and relay pairing
- `Setup`: connect Telegram user and bot credentials

Typical local usage looks like this:

1. Run `./install.sh` once
2. Open `http://localhost:3000`
3. Connect Telegram in `Setup` if you need it
4. Use Codex in `Chat`
5. Pair the device in `Config` if you want remote access

### Remote Web

The hosted relay flow looks like this:

1. Sign in on `https://remote-codex.com`
2. Create a pairing code on the `devices` page
3. Open `Config` on the local device and enter the pairing code and relay server URL
4. Finish pairing
5. Select the device from remote web and enter the workspace through the relay

This README only documents the hosted relay flow. It does not include self-hosted relay setup instructions.

## Telegram Integration

Telegram support is optional. The local web and relay web flows work without it.

The high-level flow is:

1. Get `api_id` and `api_hash` from [`my.telegram.org`](https://my.telegram.org)
2. Open the local `Setup` screen and enter `API ID`, `API Hash`, phone number, and bot token
3. Enter the login code delivered by Telegram
4. Enter your 2FA password if your Telegram account requires it

Notes:

- Telegram user login and bot token are different inputs
- If authentication fails, verify the values in the `Setup` screen first
- When Telegram is connected, project and thread flows can be connected to Telegram channels and topics

References:

- [`my.telegram.org`](https://my.telegram.org)
- [Telegram API credentials guide](https://core.telegram.org/api/obtaining_api_id)

## Relay Pairing

Relay pairing connects one local device to the hosted remote access plane.

The standard hosted relay flow is:

1. Sign in on `https://remote-codex.com`
2. Create a pairing code on the `devices` page
3. Open local `Config`
4. Enter the `Pairing Code` and `Relay Server URL`
5. Once paired, the device becomes selectable from remote web

Default hosted relay URL:

- `https://relay.remote-codex.com`

Local testing example:

- `http://localhost:3100`

URL rules:

- Hosted relay endpoints must use `HTTPS`
- Only localhost development is allowed over plain `HTTP`
- If you paste a relay URL with a path, it is normalized to its origin before storage

## Security

This section describes the current implementation as it actually works, not as marketing.

### What Is Protected

- Remote relay access requires an authenticated remote web session first
- After a device is selected, the relay issues a short-lived `connect token`
  - current implementation TTL: `5 minutes`
- Pairing also uses a short-lived one-time `pairing code`
  - current implementation TTL: `10 minutes`
- Workspace request and response payloads crossing the relay are wrapped in `nacl-box` encrypted envelopes
- Device-side `device secret` and public/secret key material are used for device authentication and encrypted bridge sessions

In other words, the relay decides who can attach to which device, while the actual workspace HTTP and realtime payloads are forwarded in encrypted form.

### What the Relay Can Still Know

The relay is not a full zero-knowledge service.

It can still see control-plane metadata such as:

- which account owns which device
- whether a device is online or offline
- pairing code and connect token lifecycle data
- device identifiers, owner labels or emails, and protocol or app version metadata

What it is meant to protect:

- workspace request bodies
- workspace response bodies
- plaintext contents of realtime payloads

The right mental model is:

- you still trust the relay operator with control-plane and metadata visibility
- the workspace traffic itself is forwarded as encrypted payloads
- calling it a fully zero-knowledge relay would be inaccurate

## Current Status

This README intentionally documents the stable path, not every experimental surface.

- Local web and hosted relay web are the main supported usage flows
- Telegram integration exists and is part of the local runtime
- Relay pairing and remote workspace entry are implemented and documentable
- The mobile app exists in the repo, but it is not ready to be the primary path documented here

## Troubleshooting

### Local web does not open

- Check `remote-codex status`
- If needed, run `remote-codex start`
- Make sure you are opening `http://localhost:3000`
- If you changed the port, verify `REMOTE_CODEX_PORT`

### Telegram authentication fails

- Recheck `api_id`, `api_hash`, phone number, and bot token
- Make sure the login code arrived in the official Telegram app
- If 2FA is enabled, the password step may be required

### Relay pairing fails

- Check whether the pairing code expired
- Check whether the relay URL is `https://relay.remote-codex.com` or a valid localhost development URL
- If the device was already paired, try `Unpair` in `Config` and then pair again

### `redirect_mismatch` happens during relay login

- For hosted usage, restart from the official login entrypoint
- In monorepo local development, relay web uses `http://localhost:5173` for its callback configuration, so `127.0.0.1` or another port can fail

## Developer Notes

These commands are for monorepo development, not for the packaged end-user install.

### Monorepo Commands

```bash
npm install
npm run dev
npm run dev:local
npm run dev:relay
npm run build
npm run test
```

### Local Dev Endpoints

- local agent: `http://localhost:3000`
- local web dev: `http://localhost:4173`
- relay API dev: `http://localhost:3100`
- relay web dev: `http://localhost:5173`

Additional references:

- package runtime guide: [packages/remote-codex/README.md](packages/remote-codex/README.md)
- beta readiness checklist: [docs/public-beta-checklist.md](docs/public-beta-checklist.md)
