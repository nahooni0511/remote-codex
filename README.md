# Remote Codex

Remote Codex is a monorepo for running Codex-backed workspaces on a local machine and reaching them remotely through a relay.

The repository contains:

- `apps/remote-codex-agent`: the local runtime, HTTP API, WebSocket server, Telegram integration, relay bridge, and update flow
- `apps/remote-codex-web`: the local browser shell that talks directly to the local agent
- `apps/relay-api`: the relay control plane and encrypted bridge server
- `apps/relay-web`: the remote web shell for login, device selection, pairing code issuance, and remote workspace entry
- `apps/relay-mobile`: the Expo mobile shell
- `packages/workspace-web`: the shared workspace UI used by local and remote web
- `packages/client-core`: shared relay client, encryption, and rendering helpers
- `packages/contracts`: shared DTOs, bridge protocol types, and realtime contracts
- `packages/remote-codex`: the publishable npm package for home-server installs

## Architecture

Remote Codex is split into two execution planes:

- `device plane`: your machine runs `remote-codex-agent` and exposes a local workspace at `http://localhost:3000`
- `relay plane`: a hosted relay accepts authenticated remote clients, issues pairing codes, and forwards encrypted workspace traffic to the paired device

After a device is paired, local and remote web both use the same shared workspace app. The main difference is transport:

- local web -> direct HTTP and WebSocket to the local agent
- remote web/mobile -> authenticated relay bridge with encrypted payloads

## Monorepo Commands

Install dependencies:

```bash
npm install
```

Run everything needed for local development:

```bash
npm run dev
```

Useful subsets:

```bash
npm run dev:local
npm run dev:relay
npm run build
npm run test
```

E2E entry points:

```bash
npm run e2e
npm run e2e:remote
npm run e2e:remote:blocked
```

## Local Runtime

The local runtime is the part you install on a workstation or home server. It bundles:

- the local agent
- the local web UI
- the relay pairing flow

When running locally, the main UI is served from:

- `http://localhost:3000`

The local `Config` screen includes the relay pairing flow. A user can:

1. sign in to the remote relay web
2. create a pairing code
3. open local `Config`
4. enter the pairing code and relay URL
5. connect the device to the relay

## Publishable Package

The publish target is:

- `@everyground/remote-codex`

After publish, a machine with Node.js and npm installed can run:

```bash
npm install -g @everyground/remote-codex
remote-codex
```

By default, runtime data is stored in:

- `~/.remote-codex`

## Relay Stack

The current hosted layout is:

- `remote-codex.com`: remote web shell
- `relay.remote-codex.com`: relay API and bridge

Typical remote flow:

1. sign in on `remote-codex.com`
2. choose a paired device
3. enter the shared workspace
4. relay routes HTTP and realtime traffic to the paired device

## Major Features

- Telegram-backed project and thread integration
- local browser workspace
- remote browser workspace
- device pairing via pairing codes
- relay bridge with encrypted payload forwarding
- remote device updates triggered from UI
- shared workspace UI across local and remote web
- Expo-based mobile relay shell

## Repository Notes

- The root workspace is private and is not published.
- The npm package is produced from `packages/remote-codex`.
- The published CLI command remains `remote-codex`.
- Internal workspace packages continue to use the `@remote-codex/*` scope inside the monorepo.
