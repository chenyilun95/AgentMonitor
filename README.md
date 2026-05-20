# Agent Monitor

**English** | [中文文档](README-zh.md)

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Tests-159%20passing-22c55e?style=for-the-badge)](server/__tests__)
[![Docs](https://img.shields.io/badge/Docs-VitePress-646cff?style=for-the-badge&logo=vitepress&logoColor=white)](https://ericonaldo.github.io/AgentMonitor/)

A web dashboard to run, monitor, and manage **Claude Code** and **Codex** agents in one place. Create agents with a cloneable task template. Real-time streaming, task pipelines, and notifications via Email / WhatsApp / Slack — all from your browser.

**[Documentation](https://ericonaldo.github.io/AgentMonitor/)** | **[Quick Start](#quick-start)**

---

## Table of Contents

- [Key Features](#key-features)
- [Demo](#demo)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Remote Access (Relay Mode)](#remote-access-relay-mode)
- [Feishu (Lark) Bot Integration](#feishu-lark-bot-integration)
- [Provider Support](#provider-support)
- [Testing](#testing)
- [Architecture](#architecture)
- [License](#license)

---

## Key Features

### Spin Up Agents Instantly with Cloneable Templates
- **Clone agent** — Duplicate any agent's configuration (directory, provider, flags, instruction content) to instantly spin up a new one with the same setup — no re-entering settings
- **Instruction templates** — Create reusable instruction sets and load them when spawning agents or pipeline tasks (`CLAUDE.md` for Claude, `AGENTS.md` for Codex), with built-in `OpenCLI Skill Starter` and `Karpathy Coding Guardrails` templates auto-seeded on first run
- **Auto-detect instruction files** — When selecting a project directory, automatically detects existing instruction files with provider-aware fallback
- **Auto-detect model options** — Create Agent shows provider-specific model choices detected from your locally installed CLI version
- **Live editing** — Modify an agent's instruction content at any time without restarting

### Multi-Agent Orchestration
- **Unified dashboard** — Create, monitor, and manage Claude Code and Codex agents from a single interface
- **Task pipelines** — Define sequential and parallel task workflows; the built-in Meta Agent Manager automates execution end-to-end (validates pending tasks before start)
- **Git worktree isolation** — When the working directory is a git repo, each agent operates in its own worktree branch, preventing conflicts. Non-git directories are used directly with no worktree overhead

### External Agent Discovery
- **Auto-detect running agents** — Claude Code and Codex processes started outside the dashboard (e.g., from a terminal) are automatically discovered and displayed with an **EXT** badge
- **Automatic session import** — Existing local sessions are loaded from provider logs (`~/.claude/projects/**.jsonl` and `~/.codex/sessions/**.jsonl`) so history appears automatically after discovery
- **History + live tail sync** — User/assistant/tool messages, token/context metadata, and status changes continue syncing from local session files in real time
- **Running-only visibility** — External cards are only shown while their underlying process is alive; closed external sessions are removed automatically
- **Safe deletion model** — External cards cannot be deleted from Agent Monitor (source of truth is the local CLI process/session files)
- **Internal-agent visibility unchanged** — Internal agents created by Agent Monitor remain visible after stop (until manual delete or retention cleanup)
- **Toggle visibility** — Show or hide external agents on the dashboard with a single click; preference persists across sessions

### Real-Time Monitoring & Interaction
- **Live streaming** — Watch agent output in real-time over WebSocket (works locally and through relay), with automatic polling fallback
- **PTY web terminal** — Toggle a fully interactive shell (node-pty + xterm.js) in the agent's working directory — run any command, launch `claude`, or debug directly from the browser
- **Built-in OpenCLI toolchain** — `server` install automatically syncs `@jackwener/opencli` to latest and exposes `opencli` to agent subprocesses via PATH
- **Web chat interface** — Structured chat view with 25+ slash commands matching CLI behavior; both interfaces coexist and you can switch freely
- **Session resume** — Send a message to a stopped agent to automatically restart it with `--resume`, continuing the conversation with full history. Dash-prefixed Codex prompts such as `--help` are forwarded as plain chat input, not CLI flags
- **Clone agent** — Duplicate an existing agent's configuration to quickly create a new one with the same settings
- **Interactive prompts** — When an agent needs input (permission prompts, choices), the web UI shows notification banners and clickable choice buttons
- **Cost & token tracking** — Per-agent cost (Claude) and token usage (Codex) displayed in real time
- **File attachments** — Paste images/files from clipboard (Ctrl+V) or click the attach button to send files with your message; supports all file types up to 50 MB, with inline preview chips showing filename, size, and a remove button
- **Double-Esc interrupt** — Press Escape twice to send SIGINT to any running agent
- **Auto-delete expired agents** — Configurable retention period for stopped internal agents (default 24h, adjustable in Settings)
- **Configurable delete behavior** — For monitor-created agents, choose per-delete strategy for session files: ask every time, do not purge session files, or always purge session files by `sessionId`

### Notifications — Email, WhatsApp & Slack
Stay informed wherever you are. Agent Monitor sends instant notifications when agents need human attention.

| Channel | Provider | Setup |
|---------|----------|-------|
| **Email** | Any SMTP server (Gmail, Outlook, Mailgun, etc.) | Configure `SMTP_*` environment variables |
| **WhatsApp** | Twilio API | Configure `TWILIO_*` environment variables |
| **Slack** | Slack Incoming Webhooks | Configure `SLACK_WEBHOOK_URL` or per-agent webhook |
| **Feishu (Lark)** | Feishu Open Platform (WebSocket bot) | Configure `FEISHU_*` variables — sends **interactive cards with reply buttons** |

Notifications are triggered when:
- An agent enters `waiting_input` state and needs human intervention
- A pipeline task fails
- A stuck agent exceeds the configurable timeout threshold
- The entire pipeline completes

All channels can be enabled simultaneously — configure an admin email, WhatsApp phone number, and/or Slack webhook per agent or globally for the Agent Manager.

> See the [Notifications Guide](docs/guide/notifications.md) for detailed setup instructions.

### Feishu (Lark) Bot & Notifications
Chat with your agents and receive rich interactive alerts directly in Feishu. The bot connects via WebSocket — no public URL required — and displays live, updateable agent cards with clickable choice buttons for permission prompts and pipeline alerts.

### Remote Access via Relay Server
- **Access from anywhere** — Manage agents from your phone, laptop, or any device through a public relay server
- **Secure WebSocket tunnel** — The agent machine connects outbound to the relay; no inbound ports needed
- **Batch remote agents** — Run and monitor dozens of agents on a powerful remote machine while controlling them from any lightweight device
- **Password-protected dashboard** — JWT-based authentication with 24-hour session expiry
- **Auto-reconnect** — Tunnel reconnects automatically if the connection drops (exponential backoff)
- **Zero overhead locally** — When relay is not configured, the server runs in local-only mode with no extra cost

```
Phone / Laptop ──HTTP──▶ Public Server (Relay :3457) ◀──WS tunnel── Agent Machine (:3456)
```

> See the [Remote Access Guide](docs/guide/remote-access.md) for setup instructions.

### Internationalization
- **7 languages**: English, Chinese (中文), Japanese (日本語), Korean (한국어), Spanish, French, German
- Language selector persisted across sessions

---

## Demo

### Quick Start — Create Agent with Template
![Quick Start Demo](docs/screenshots/demo-quickstart.gif)

*Create agent with CLAUDE.md template → agent runs autonomously → task completes*

### Chat & Terminal
![Chat & Terminal Demo](docs/screenshots/demo-chat-terminal.gif)

*Interactive chat → agent responds with tool calls → PTY terminal → clone agent*

### Task Pipeline
![Pipeline Demo](docs/screenshots/demo-pipeline.gif)

*Agent Manager: add tasks → start manager → watch agents run sequentially*

---

## Screenshots

| Dashboard | Meta Agent Pipeline |
|-----------|---------------------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Pipeline](docs/screenshots/pipeline.png) |

| Create Agent | Agent Chat (Markdown) |
|--------------|----------------------|
| ![Create Agent](docs/screenshots/create-agent.png) | ![Agent Chat](docs/screenshots/agent-chat.png) |

| External Agent Discovery | PTY Web Terminal |
|--------------------------|------------------|
| ![External Agent](docs/screenshots/external-agent.png) | ![Terminal](docs/screenshots/terminal.png) |

| Templates | Multi-Language Support |
|-----------|-----------------------|
| ![Templates](docs/screenshots/templates.png) | ![Dashboard (Chinese)](docs/screenshots/dashboard-zh.png) |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** (`claude`) — for Claude agents. Agent Monitor detects supported `--effort` values from your installed CLI at runtime; older Claude Code releases may expose only `low`, `medium`, and `high`, while newer releases may also expose `max`
- **Codex CLI** (`codex`) — for Codex agents
- **OpenCLI runtime** (`@jackwener/opencli`) — installed automatically during `server` dependency install (Node.js >= 20 required by OpenCLI itself)
- **Git** — for worktree isolation (optional; non-git directories work without it)

### Installation

```bash
git clone <repo-url> && cd AgentMonitor
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

`cd server && npm install` now includes an automatic best-effort sync of `@jackwener/opencli@latest`.

For **local-only use**, that's enough. You do **not** need to configure relay mode.

### Production

```bash
cd client && npx vite build && cd ..
cd server && npx tsx src/index.ts
```

Open **http://localhost:3456** in your browser.

### Development

```bash
npm run dev    # Starts server (tsx watch) + client (vite dev) concurrently
```

- Client dev server: http://localhost:5173 (proxies API to :3456)
- API server: http://localhost:3456

If you're running on the same machine as your agents, stop here. The relay setup below is only for remote access from another device or public server.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and set the values you need.

For a normal local setup, you can ignore all `RELAY_*` variables.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `CLAUDE_BIN` | `claude` | Path to Claude CLI binary |
| `CODEX_BIN` | `codex` | Path to Codex CLI binary |

### Email Notifications (SMTP)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname (e.g., `smtp.gmail.com`) |
| `SMTP_PORT` | `587` | SMTP port (`587` for STARTTLS, `465` for TLS) |
| `SMTP_SECURE` | `false` | Set `true` for port 465 |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password or app-specific password |
| `SMTP_FROM` | `agent-monitor@localhost` | Sender address |

### WhatsApp Notifications (Twilio)

| Variable | Default | Description |
|----------|---------|-------------|
| `TWILIO_ACCOUNT_SID` | — | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio Auth Token |
| `TWILIO_WHATSAPP_FROM` | — | WhatsApp-enabled Twilio phone number (e.g., `+14155238886`) |

### Slack Notifications (Webhook)

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_WEBHOOK_URL` | — | Default Slack Incoming Webhook URL |

### Optional: Remote Relay (Tunnel)

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_URL` | — | WebSocket URL of relay server (e.g., `ws://your-server:3457/tunnel`) |
| `RELAY_TOKEN` | — | Shared secret for tunnel authentication |

Leave both unset for local-only mode. See [Remote Access (Relay Mode)](#remote-access-relay-mode) only if you need remote access.

> If SMTP, Twilio, or Slack credentials are not set, the respective notification channel is disabled gracefully — events are logged to the server console.

---

## Usage

### Creating an Agent

1. Click **"+ New Agent"** on the Dashboard
2. Select **Provider** — Claude Code or Codex
3. Set **Name**, **Working Directory** (use Browse to pick a directory), and **Prompt**
4. If the selected directory contains an instruction file (`CLAUDE.md` or `AGENTS.md`), you'll be prompted to load it automatically (provider-aware with compatibility fallback)
5. Select a **Model** from the runtime-detected dropdown (or leave `default`)
6. Configure **Flags** (e.g., `--dangerously-skip-permissions`, `--chrome`, `--permission-mode`)
7. Optionally load an instruction template and edit it inline (`CLAUDE.md` for Claude, `AGENTS.md` for Codex)
8. Enter an **Admin Email**, **WhatsApp Phone**, and/or **Slack Webhook URL** for notifications
9. Click **Create Agent**

When a model is selected:
- Claude starts with CLI `--model <selected>`
- Codex prefixes the first turn with `/model <selected>` before executing your task prompt

**Tip — Clone an existing agent:** Hit the **Clone** button on any agent card to create a new agent pre-filled with the same directory, provider, flags, and instruction file content (`CLAUDE.md` / `AGENTS.md`). Combine with templates for a reusable agent library: create a template with your standard instructions → create one agent using it → clone whenever you need a fresh instance.

Template quick start: use the built-in `OpenCLI Skill Starter` template to make agents proactively discover and use `opencli` (`opencli list`, `opencli doctor`, and JSON-first outputs), or `Karpathy Coding Guardrails` for stricter coding behavior inspired by the andrej-karpathy-skills `CLAUDE.md`.

### Dashboard

Each agent is represented by a rich information card displaying:
- **Project & git branch** — which repository and branch the agent is working on
- **Pull Request link** — if the agent created a PR, a direct link is shown (auto-detected)
- **Model & context usage** — which LLM model and a visual bar for context window consumption
- **Status** — whether the agent is actively working, idle, or waiting for permission
- **Task description** — a summary of what the agent is currently doing
- **MCP servers** — connected Model Context Protocol servers (parsed from `--mcp-config`)
- **Cost / token tracking** — per-agent cost (Claude) or token usage (Codex)

Click any card to open the full chat interface.

### Agent Chat

Send messages, view conversation history, interrupt with Double-Esc, and use slash commands:

`/help` `/clear` `/status` `/cost` `/stop` `/compact` `/model` `/export`

For Codex agents, messages that begin with `--` are safely passed after an explicit end-of-options separator, so text like `--help` or `--sandbox danger-full-access` is treated as normal conversation content.

### Task Pipeline

Orchestrate multi-step workflows with sequential and parallel task definitions. The Meta Agent Manager automatically provisions agents, monitors progress, sends notifications on failures, and cleans up on completion.

### Templates

Create, edit, and reuse instruction templates across agents (`CLAUDE.md` / `AGENTS.md`).

---

## API Reference

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get agent details |
| POST | `/api/agents` | Create agent |
| POST | `/api/agents/:id/stop` | Stop agent |
| POST | `/api/agents/:id/message` | Send message |
| POST | `/api/agents/:id/interrupt` | Interrupt agent (SIGINT) |
| PUT | `/api/agents/:id/claude-md` | Update CLAUDE.md |
| DELETE | `/api/agents/:id` | Delete agent (optional body: `{ "purgeSessionFiles": true|false }`) |
| POST | `/api/agents/actions/stop-all` | Stop all agents |

### Pipeline Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List pipeline tasks |
| POST | `/api/tasks` | Create task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/reset` | Reset task status |
| POST | `/api/tasks/clear-completed` | Clear completed/failed tasks |
| GET | `/api/meta/config` | Get meta agent config |
| PUT | `/api/meta/config` | Update meta agent config |
| POST | `/api/meta/start` | Start meta agent manager |
| POST | `/api/meta/stop` | Stop meta agent manager |

### Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List templates |
| GET | `/api/templates/:id` | Get template |
| POST | `/api/templates` | Create template |
| PUT | `/api/templates/:id` | Update template |
| DELETE | `/api/templates/:id` | Delete template |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get server settings (internal-agent retention, session-file delete policy, etc.) |
| GET | `/api/settings/runtime-capabilities` | Get runtime-detected provider capabilities (reasoning efforts + model options) |
| PUT | `/api/settings` | Update server settings |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload file attachment (multipart, max 50 MB) |
| GET | `/api/sessions` | List previous Claude sessions |
| GET | `/api/directories?path=/home` | Browse server directories |
| GET | `/api/directories/claude-md?path=/project&provider=codex` | Check instruction file (`CLAUDE.md` / `AGENTS.md`) with compatibility fallback |
| GET | `/api/health` | Health check |

### Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `agent:join` | Client → Server | Subscribe to agent messages |
| `agent:leave` | Client → Server | Unsubscribe |
| `agent:send` | Client → Server | Send message |
| `agent:interrupt` | Client → Server | Send interrupt |
| `agent:message` | Server → Client | Agent output (legacy) |
| `agent:update` | Server → Client | Full agent snapshot (real-time streaming) |
| `agent:snapshot` | Server → Client | Dashboard broadcast update |
| `agent:status` | Server → Client | Status change |
| `task:update` | Server → Client | Pipeline task updated |
| `pipeline:complete` | Server → Client | Pipeline complete |
| `terminal:open` | Client → Server | Open PTY terminal in agent directory |
| `terminal:input` | Client → Server | Send keystrokes to PTY |
| `terminal:resize` | Client → Server | Resize PTY dimensions |
| `terminal:close` | Client → Server | Close PTY session |
| `terminal:output` | Server → Client | PTY output data |
| `terminal:exit` | Server → Client | PTY process exited |
| `meta:status` | Server → Client | Meta agent status |

---

## Remote Access (Relay Mode)

Access the Agent Monitor dashboard from anywhere — phone, laptop, or any device — via a public relay server. The relay forwards all HTTP and WebSocket traffic through a secure tunnel.

```
Phone/Laptop → HTTP → Public Server (Relay :3457) ← WS tunnel ← Local Machine (:3456)
```

### Setup

1. **Deploy the relay** to a public server:
   ```bash
   bash relay/scripts/deploy.sh <your-secret-token> <your-dashboard-password>
   ```

2. **Connect the local server** by setting environment variables:
   ```bash
   RELAY_URL=ws://your-server:3457/tunnel RELAY_TOKEN=<your-secret-token> npx tsx server/src/index.ts
   ```

3. **Open the dashboard** from any device at `http://your-server:3457` — log in with your password

The relay supports **password-based login** via `RELAY_PASSWORD` to protect the dashboard from unauthorized access. Sessions use JWT tokens with 24-hour expiry. The tunnel auto-reconnects if the connection drops. When `RELAY_URL` is not set, the server runs in local-only mode with no relay overhead.

---

## Feishu (Lark) Bot Integration

Use Feishu (Lark) as an interactive bot interface alongside the web dashboard and terminals. The bot uses Feishu's **WebSocket long-connection** — no public URL needed on your agent machine.

### Features

- **Live agent cards** — Agent status, messages, cost, and branch are displayed as updateable interactive Feishu cards (auto-refreshed on every change, debounced to respect rate limits)
- **Choice buttons everywhere** — When an agent waits for human input, permission prompts and choices appear as clickable card buttons — both in the bound chat *and* in proactive notification alerts
- **Unified notifications** — Feishu replaces or complements email/WhatsApp/Slack: task failures, stuck agents, and pipeline completion all send rich cards to the admin chat instead of plain text
- **Commands** — `/list`, `/attach`, `/detach`, `/stop`, `/status`, `/help`
- **Access control** — Restrict bot access to specific Feishu `open_id`s via `FEISHU_ALLOWED_USERS`
- **Persistent bindings** — Chat-to-agent bindings survive server restarts (stored in `data/feishu_bindings.json`)

### Setup

1. Create a Feishu bot at [Feishu Open Platform](https://open.feishu.cn/app)
2. Enable permissions: **Receive messages** (`im:message.receive_v1`) and **Send messages** (`im:message:create`)
3. Enable **WebSocket long-connection** event subscription
4. Enable **Interactive card** support
5. Set environment variables:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx

# Admin chat for pipeline notifications (task failures, pipeline complete, stuck agents)
FEISHU_ADMIN_CHAT_ID=oc_xxxxxxxxxxxx

# Optional: restrict bot to specific users (comma-separated open_ids)
FEISHU_ALLOWED_USERS=ou_xxxx,ou_yyyy
```

To send Feishu notifications for a specific agent (e.g., `waiting_input`), set `feishuChatId` when creating the agent via API:
```json
{ "feishuChatId": "oc_xxxxxxxxxxxx" }
```

### Usage

| Command | Description |
|---------|-------------|
| `/list` | List all agents with status and a "Connect" button |
| `/attach <name or ID>` | Bind this chat to an agent (shows live card) |
| `/detach` | Unbind from the current agent |
| `/stop` | Stop the currently bound agent |
| `/status` | Refresh the current agent's status card |
| `/help` | Show this help |

Once attached, send free text to forward it directly to the agent. When the agent is waiting for input, click a choice button or type a reply.

---

## Provider Support

| | Claude Code | Codex |
|---|---|---|
| **Binary** | `claude` | `codex` |
| **Flags** | `--dangerously-skip-permissions`, `--permission-mode`, `--chrome`, `--max-budget-usd`, `--allowedTools`, `--disallowedTools`, `--add-dir`, `--mcp-config`, `--resume`, `--model` | `--dangerously-bypass-approvals-and-sandbox`, `--full-auto` |
| **Model Selection** | Runtime-detected dropdown, applied via `--model` on start | Runtime-detected dropdown, applied via `/model <name>` at the beginning of the first turn |
| **Tracking** | Cost (USD) | Token usage |

---

## Testing

```bash
npm test    # 40 tests
```

---

## Architecture

```
AgentMonitor/
  server/                   # Node.js + Express + Socket.IO
    src/
      services/
        AgentProcess.ts     # CLI process wrapper
        AgentManager.ts     # Agent lifecycle
        MetaAgentManager.ts # Pipeline orchestration
        TunnelClient.ts     # Outbound tunnel to relay server
        tunnelBridge.ts     # Event bridge for tunnel
        TerminalService.ts  # PTY terminal management (node-pty)
        WorktreeManager.ts  # Git worktree ops
        EmailNotifier.ts    # SMTP email notifications
        WhatsAppNotifier.ts # Twilio WhatsApp notifications
        SlackNotifier.ts    # Slack webhook notifications
        SessionReader.ts    # Session history
        DirectoryBrowser.ts # Directory listing
      store/AgentStore.ts   # JSON persistence
      routes/               # REST endpoints
      socket/handlers.ts    # WebSocket handlers
    __tests__/              # Test suite
  relay/                    # Public relay server (deployed independently)
    src/
      index.ts              # Relay entry point
      tunnel.ts             # TunnelManager (WS server)
      httpProxy.ts          # HTTP forwarding through tunnel
      socketBridge.ts       # Socket.IO ↔ tunnel bridge
      config.ts             # Relay configuration
    scripts/deploy.sh       # Build & deploy to public server
  client/                   # React + Vite
    src/
      pages/                # Dashboard, Chat, Pipeline, Templates
      i18n/                 # 7-language localization (EN/ZH/JA/KO/ES/FR/DE)
      api/                  # REST + Socket.IO clients
```

---

## License

MIT
