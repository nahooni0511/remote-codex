# Public Beta Checklist

This document tracks the minimum remaining work before Remote Codex is ready for a public beta.

It is intentionally narrower than a full roadmap. The goal is to capture the items that block a stable, repeatable, and supportable first beta release.

## Release Position

Current status:

- local runtime packaging exists
- relay web and relay API exist
- remote device pairing exists
- hosted deployment exists
- npm package publishing path exists

Current release recommendation:

- acceptable for a small operator-managed closed beta
- not yet acceptable for a self-serve public beta

## Public Beta Minimum Conditions

### 1. Fully isolated remote E2E

Goal:

- remote E2E must run without relying on shared Cognito, shared MySQL, shared Valkey, or the live hosted relay

Why it matters:

- shared infrastructure makes tests flaky
- test data can leak across runs
- CI cannot be trusted if it mutates production-like state

Required work:

- spin up relay API in a disposable local test stack
- run remote web against that disposable stack
- isolate auth for tests with a local or explicitly test-only auth path
- seed disposable database state for pairing, devices, and sessions
- run remote WebSocket and HTTP flows end to end inside the test stack

Definition of done:

- `npm run e2e:remote` can run from a clean machine without touching hosted AWS resources
- the test creates and tears down its own state
- CI can run the suite repeatedly without manual cleanup

### 2. Split `store.ts` again

Current risk area:

- `/Users/nahooni0511/workspace/remote-codex/apps/relay-api/src/relay/store.ts`

Goal:

- separate persistence, connection registry, and orchestration concerns

Why it matters:

- the file currently mixes DB access, token/session validation, Valkey presence, socket routing, and business rules
- debugging production relay issues will stay expensive until these responsibilities are separated

Required work:

- extract MySQL repositories into a repository layer
- extract Valkey presence and pub/sub into a socket/session registry layer
- keep `store.ts` as orchestration only, or rename it to reflect that responsibility
- add focused tests around repository operations and pub/sub routing

Suggested target structure:

- `apps/relay-api/src/relay/repositories/*`
- `apps/relay-api/src/relay/registry/*`
- `apps/relay-api/src/relay/store.ts` or `service.ts` for orchestration

Definition of done:

- DB queries do not live in the registry layer
- WebSocket client maps do not live in repository code
- the main relay orchestration file is materially smaller and easier to reason about

### 3. Guarantee `RELAY_TEST_AUTH_*` is never present in production

Goal:

- test-only authentication paths must be impossible to enable in deployed environments

Why it matters:

- test bypasses are acceptable in local E2E
- they are unacceptable in public deployments

Required work:

- document every `RELAY_TEST_AUTH_*` environment variable
- fail fast at process startup if any of them are set in production
- add a deployment check in the production startup path
- add a deployment checklist item for Amplify, Beanstalk, and any future CI pipeline

Definition of done:

- production startup exits on test auth env presence
- deployment docs explicitly forbid these env vars
- no deployed environment can silently run with test auth enabled

### 4. Review logs, alarms, and operating playbooks

Goal:

- operators must be able to detect, triage, and recover from the most likely beta failures

Why it matters:

- relay, device bridge, auth, and websocket failures are operational problems first
- a public beta without response playbooks will degrade quickly

Required work:

- verify relay API structured logs cover auth, pairing, connect-token issuance, bridge failures, heartbeat timeouts, and protocol mismatch
- verify CloudWatch alarms for:
  - relay API 5xx spike
  - unhealthy targets
  - auth failure spike
  - device disconnect spike
  - database connectivity failures
  - Valkey connectivity failures
- write operator runbooks for:
  - relay unavailable
  - Cognito login failures
  - paired device stuck offline
  - invalid device registration
  - protocol mismatch blocking workspace access

Definition of done:

- alarms exist and are actionable
- each major failure mode has a written response path
- on-call can follow the docs without digging through code

## `install.sh` Work Item

The npm package is publishable, but a first-run installer script is still needed for smoother self-hosting on home servers and workstations.

Target file:

- `install.sh`

Primary goal:

- verify prerequisites and install missing local dependencies before launching `@everyground/remote-codex`

Recommended scope:

- support Linux first
- keep macOS support explicit if included
- fail clearly on unsupported distributions

The script should check for:

- `node` and supported Node.js version
- `npm`
- `git`
- `curl`
- `codex` CLI availability
- logged-in Codex state if detectable

The script should handle:

- installing `@everyground/remote-codex`
- printing the local URL after install
- explaining how to complete first-run setup
- exiting with clear next steps when a dependency cannot be auto-installed

Suggested behavior:

1. detect OS and package manager
2. verify Node.js version
3. verify npm
4. verify or install `git` and `curl`
5. verify `codex` CLI exists
6. if missing, install Codex CLI or stop with exact instructions
7. install `@everyground/remote-codex`
8. print how to run `remote-codex`
9. print where runtime data is stored

Open decisions:

- whether the script is allowed to install Node.js automatically
- whether Codex CLI installation should be automatic or documented only
- whether the script should start the service immediately or only install it

Definition of done:

- a new Linux machine can run the installer and end in a usable local setup
- unsupported cases fail with exact remediation steps
- installer output is short, deterministic, and easy to support remotely

## Suggested Execution Order

1. isolate remote E2E
2. split relay `store.ts`
3. add production guardrails for `RELAY_TEST_AUTH_*`
4. finish logs, alarms, and runbooks
5. implement `install.sh`

## Notes

- This checklist is a release gate, not a wishlist.
- Anything here should be treated as beta-blocking until explicitly reclassified.
