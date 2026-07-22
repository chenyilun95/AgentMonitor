# Agent Monitor

**English** | [中文](README-zh.md)

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

Agent Monitor is a local-first workspace for running **Claude Code** and **Codex**. It turns CLI coding sessions into a persistent web application: organize agents by repository, chat with them, inspect their files, open a real terminal, isolate changes in Git worktrees, and coordinate multi-agent pipelines from one place.

It is more than a process monitor. The current product is a control plane around the complete lifecycle of coding agents:

```text
Choose a project → start or discover an agent → chat / terminal / files
                 → review its state and changes → resume, clone, or orchestrate more agents
```

![Agent Monitor dashboard](docs/screenshots/dashboard.png)

## What the application contains

The top-level navigation reflects the current product structure.

| Page | Purpose |
| --- | --- |
| **Agent Panel** | The main workspace. View agents by time or project directory, see live state and usage, and create direct-edit or worktree agents for a project. |
| **Agent Chat** | A full session workspace with streamed conversation, tool calls, plan approval, interactive questions, attachments, file browsing, and a PTY terminal. |
| **Agent Team Panel** | Run manually ordered sequential/parallel tasks, or use Harness mode to plan, generate, evaluate, and revise work. |
| **Templates** | Maintain reusable `CLAUDE.md` / `AGENTS.md` instruction content. |
| **Skills** | Create reusable skills, attach scripts, and import skills already installed for Claude or Codex. |
| **GPU Servers** | Optionally monitor SSH-accessible NVIDIA servers and open an interactive remote terminal. |

### Agent Panel: projects, not just processes

The dashboard can group cards chronologically or by working directory. Project grouping makes a repository the center of the workflow: each directory section shows its agents and exposes one-click creation for either workspace mode.

Each card surfaces the information needed to operate a session without opening it: provider, source, status, project, Git branch/workspace mode, prompt summary, activity time, and cost or token usage. From the card you can open, clone, stop, delete, or ask a completed agent to commit its work.

The server can scan local Claude Code and Codex processes and import selected external sessions through the external-agent API. Imported sessions appear with an `EXT` badge while the underlying process is alive and can be hidden without affecting monitor-created agents.

### One session, three working surfaces

Opening an agent gives you three views over the same working directory:

- **Chat** streams assistant output and tool calls over Socket.IO. It supports Markdown, image output, file attachments, queued follow-up messages, slash commands, and adjustable reasoning effort.
- **Terminal** is a real PTY backed by `node-pty`, useful for running tests, Git commands, or the provider CLI without leaving the browser.
- **Files** browses the active workspace and previews common text and Markdown files.

The session page also handles the interaction patterns that autonomous agents need:

- default and plan modes, including approve/revise controls;
- structured questions and permission choices;
- single-Escape interrupt and double-Escape history restore;
- conversation resume after a process stops;
- optional restoration of both conversation and Git snapshot for isolated worktrees;
- editing the active provider instruction file without recreating the agent.

![Agent chat](docs/screenshots/agent-chat.png)

### Direct edit and isolated worktrees

Every monitor-created agent uses one of two workspace modes:

| Mode | Behavior | Best for |
| --- | --- | --- |
| **Direct Edit** | The agent works in the selected directory. Agent Monitor creates only a link under `.agent-worktrees` for a consistent runtime path. | A single agent, non-Git folders, or changes you want immediately in the current checkout. |
| **Worktree** | Agent Monitor creates an isolated branch and Git worktree under `<repo>/.agent-worktrees/`. | Concurrent agents, reviewable changes, and safe conversation/code restore points. |

Agent Monitor injects workspace instructions into `CLAUDE.md` or `AGENTS.md`, tracks the branch on the dashboard, and keeps integration into the base branch an explicit Git step.

### Agent teams and Harness mode

The Agent Team Panel offers two orchestration styles:

- **Simple Pipeline** — define tasks manually. Tasks at the same order run in parallel; later orders wait for earlier ones.
- **Harness Mode** — give the system a goal and optional evaluation criteria. A planner decomposes the work, generator agents execute it, and evaluator agents accept it or request revisions up to a configured limit.

Pipeline agents use the same providers, directories, instruction templates, status model, and session UI as individually created agents.

![Agent team pipeline](docs/screenshots/pipeline.png)

## Feature summary

- Run Claude Code and Codex side by side, with installed CLI capabilities detected at runtime.
- Create from scratch, clone an existing agent, or resume a provider session.
- Use project-aware direct-edit and Git worktree workflows.
- Stream messages, status, context usage, tokens, and Claude cost in real time.
- Interact through web chat, PTY terminal, file browser, Telegram, or Feishu.
- Manage instruction templates and portable skills from the UI.
- Import local skills from `~/.claude/skills` and `~/.codex/skills` with duplicate detection.
- Scan and import externally started Claude/Codex sessions through the API without taking ownership of their files.
- Send attention and pipeline notifications through Email, WhatsApp, Slack, Telegram, and Feishu.
- Protect the dashboard with a password and expose it remotely through the optional outbound relay tunnel.
- Use the UI in English or Chinese, with light/dark themes and selectable color schemes.

## Quick start

### Requirements

- Node.js 20 or newer
- At least one provider CLI available on `PATH`: [`claude`](https://docs.anthropic.com/en/docs/claude-code) or [`codex`](https://github.com/openai/codex)
- Git when using worktree mode
- A build toolchain supported by `node-pty` on your platform

### Install and run for development

```bash
git clone git@github.com:chenyilun95/AgentMonitor.git
cd AgentMonitor
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite client proxies API and Socket.IO traffic to the server on port `3456`.

The repository is an npm workspace, so one root `npm install` installs `client`, `server`, `shared`, and `relay`. The server postinstall also performs a best-effort installation/update of `@jackwener/opencli`.

### Production build

```bash
npm run build
npm start -w server
```

Open <http://localhost:3456>. Express serves the built React client and the API from the same process.

No `.env` file is required for local-only use. To enable authentication, notifications, GPU monitoring, or relay access, copy the example first:

```bash
cp .env.example .env
```

## Creating an agent

1. Open **New Agent**, choose Claude Code or Codex, and select a working directory.
2. Choose **Direct Edit** or **Worktree**.
3. Enter the initial task. Optionally load a template, attach skills, or resume an existing provider session.
4. Select a detected model and reasoning effort, then adjust provider permissions or tool flags if needed.
5. Create the agent. Agent Monitor opens its session page immediately and keeps it available after the CLI process stops.

The creation form detects an existing provider instruction file in the selected directory and can load it automatically. Provider-specific advanced options include permission mode, budget, allowed/disallowed tools, extra directories, MCP config, Chrome integration, and Codex sandbox/full-auto controls.

## Configuration

All optional server settings live in the root `.env`. See [.env.example](.env.example) for the complete, documented list.

| Area | Main variables |
| --- | --- |
| Server | `PORT`, `DASHBOARD_PASSWORD`, `CLAUDE_BIN`, `CODEX_BIN`, `AGENTMONITOR_IDLE_TIMEOUT_MINUTES` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| WhatsApp | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| Slack | `SLACK_WEBHOOK_URL` |
| Telegram | `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` |
| Feishu / Lark | `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ALLOWED_USERS`, `FEISHU_ADMIN_CHAT_ID` |
| GPU monitor | `GPU_SERVERS_CONF`, `GPU_SSH_JUMP`, `GPU_SSH_IDENTITY`, `GPU_POLL_INTERVAL` and related SSH options |
| Relay client | `RELAY_URL`, `RELAY_TOKEN`, `RELAY_ENCRYPT` |

Dashboard preferences such as retention time, session-file deletion policy, path history, prompt suggestions, language, grouping, and theme are managed through the UI and local settings storage.

### Remote relay

The optional `relay` package lets the agent machine make an outbound WebSocket connection to a public relay. This is useful when the machine running the provider CLIs cannot accept inbound connections.

```text
Browser ── HTTP/Socket.IO ──▶ Public relay :3457 ◀── outbound WebSocket ── Agent Monitor :3456
```

The relay supports shared-token authentication, optional AES-256-GCM tunnel encryption, a dashboard password, and reconnect/backoff behavior. See the [remote access guide](docs/guide/remote-access.md).

### GPU servers

Set `GPU_SERVERS_CONF` to enable the GPU Servers page. The server polls configured hosts over SSH using `nvidia-smi`; selecting a host can open a browser-based SSH terminal. Start with [server/data/gpu-servers.example.conf](server/data/gpu-servers.example.conf).

## CLI and API

After building, the bundled CLI talks to a running Agent Monitor server:

```bash
node server/dist/cli.js --help
node server/dist/cli.js run "Fix the failing tests" --dir /path/to/repo --detach
node server/dist/cli.js ls
node server/dist/cli.js logs <agent-id>
node server/dist/cli.js send <agent-id> "Continue with the second approach"
node server/dist/cli.js wait <agent-id>
```

Set `AGENTMONITOR_URL` or pass `--url` when the server is not at `http://localhost:3456`. The CLI also supports stopping and deleting agents, label/status filters, structured JSON output, and JSON Schema output for `run`.

The REST API covers agents, tasks, templates, skills, sessions, directories, settings, uploads, and GPU state. Socket.IO carries live agent deltas, prompts, terminal I/O, task events, and GPU snapshots. See the [API documentation](docs/api/index.md) for endpoint details.

## Repository architecture

```text
AgentMonitor/
├── client/                 React 19 + Vite web application
│   └── src/
│       ├── pages/          Dashboard, AgentChat, Pipeline, Templates, Skills, GPU
│       ├── components/     Terminal, file browser, prompts, history, attachments
│       ├── api/            REST client and Socket.IO connection
│       └── i18n/           Seven-language UI strings
├── server/                 Express + Socket.IO control plane
│   └── src/
│       ├── routes/         REST resources and authentication
│       ├── services/       Agent processes, worktrees, sessions, pipelines, bots, GPU
│       ├── socket/         Live chat and terminal event handlers
│       └── store/          Persistent agents, tasks, templates, and settings
├── shared/                 Shared TypeScript models, DTOs, events, and crypto
├── relay/                  Optional public HTTP/WebSocket proxy and tunnel server
├── skills/                 Skills available for attachment through Agent Monitor
└── docs/                   VitePress guides, API reference, plans, and screenshots
```

At runtime, the server is the source of truth. It spawns or resumes provider CLIs, parses their structured output/session logs, manages workspaces, persists snapshots, and emits small live deltas to the client. The client is an operational UI; the `shared` package keeps its data and event contracts aligned with the server. Relay mode forwards the same HTTP and Socket.IO surface rather than implementing a second control plane.

## Development

```bash
npm run dev          # shared watcher + server watcher + Vite client
npm run build        # shared, client, and server production builds
npm test             # shared, server, and client Vitest suites
npm run docs:dev     # local VitePress documentation
npm run docs:build   # build documentation
```

More detailed guides are available under [docs/](docs/index.md), including [agent chat](docs/guide/agent-chat.md), [pipelines](docs/guide/pipeline.md), [notifications](docs/guide/notifications.md), and [configuration](docs/guide/configuration.md).
