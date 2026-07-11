# Configuration

## Environment Variables

All configuration is done through environment variables. Copy `.env.example` to `.env` and fill in the values you need. All variables are optional — Agent Monitor works with sensible defaults.

For local-only use, you can ignore every `RELAY_*` variable in this file.

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3456` | Port the server listens on |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI binary |
| `CODEX_BIN` | `codex` | Path to the Codex CLI binary |

```bash
PORT=8080 npm start
```

For most local setups, this is the only section you need.

### OpenCLI Integration

During `server` dependency installation, Agent Monitor runs a best-effort sync to `@jackwener/opencli@latest` so agents can call `opencli` directly during execution.

- OpenCLI runtime requires Node.js 20+.
- Agent subprocess PATH is extended to include local `node_modules/.bin`, so `opencli` is available without global install.
- To skip automatic OpenCLI sync in CI/offline environments, set:

```bash
AGENT_MONITOR_SKIP_OPENCLI=1 npm install
```

### Email Notifications (SMTP)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | _(none)_ | SMTP server hostname (e.g., `smtp.gmail.com`) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | `true` for port 465 (TLS), `false` for port 587 (STARTTLS) |
| `SMTP_USER` | _(none)_ | SMTP authentication username |
| `SMTP_PASS` | _(none)_ | SMTP authentication password |
| `SMTP_FROM` | `agent-monitor@localhost` | "From" address in notification emails |

See the [Notifications](./notifications.md) guide for detailed setup instructions.

### WhatsApp Notifications (Twilio)

| Variable | Default | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | _(none)_ | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | _(none)_ | Twilio Auth Token |
| `TWILIO_WHATSAPP_FROM` | _(none)_ | WhatsApp-enabled Twilio phone number |

See the [Notifications](./notifications.md) guide for detailed setup instructions.

### Slack Notifications (Webhook)

| Variable | Default | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | _(none)_ | Slack Incoming Webhook URL |

See the [Notifications](./notifications.md) guide for detailed setup instructions.

### Optional: Remote Relay

| Variable | Default | Description |
|---|---|---|
| `RELAY_URL` | _(none)_ | WebSocket URL of the relay server (e.g., `ws://1.2.3.4:3457/tunnel`) |
| `RELAY_TOKEN` | _(none)_ | Shared secret for tunnel authentication |

Leave both unset for local-only mode. See the [Remote Access](./remote-access.md) guide only if you need to access the dashboard through another machine or public server.

## Agent Flags

When creating an agent, you can configure these flags:

### Claude Code Flags
- **dangerouslySkipPermissions**: Skip all permission prompts (for sandboxed environments)
- **chrome**: Enable Chrome browser integration
- **permissionMode**: Permission mode (`default`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `plan`)
- **maxBudgetUsd**: Maximum dollar amount to spend on API calls
- **allowedTools**: Comma/space-separated list of allowed tools (e.g., `Bash(git:*) Edit Read`)
- **disallowedTools**: Comma/space-separated list of denied tools (e.g., `Bash(rm:*) Write`)
- **addDirs**: Additional directories to allow tool access to (comma-separated)
- **mcpConfig**: Path to MCP server config JSON file
- **model**: Select from runtime-detected model options in Create Agent (applied via `--model`)

### Codex Flags
- **dangerouslySkipPermissions**: Auto-approve all operations
- **fullAuto**: Compatibility setting that maps to `approval_policy="never"` for current Codex CLI versions
- **model**: Select from runtime-detected model options in Create Agent (applied by `/model <name>` at the start of the first turn)

## Runtime Capabilities

Agent Monitor detects provider capabilities from your locally installed CLI binaries and exposes them to the UI:
- Reasoning effort options
- Model options

API:
- `GET /api/settings/runtime-capabilities`

The Create Agent page uses this endpoint to render provider-specific dropdowns instead of requiring manual model input.

## CLAUDE.md

Each agent can have custom instructions via CLAUDE.md content. You can:
1. Write inline content when creating the agent
2. Load from saved templates
3. Edit at any time via the chat interface (`/memory` command or Edit CLAUDE.md button)

## Git Worktree Isolation

When the working directory is a **git repository**, each agent runs in an isolated git worktree (under `.agent-worktrees/`) to prevent conflicts when multiple agents work in the same repo. The worktree is created automatically on a dedicated branch.

If the working directory is **not a git repo**, the agent works directly in the target directory with no worktree created. This avoids unnecessary git initialization and ensures agent changes land in the correct location.

## Notifications

Set an admin email, WhatsApp phone number, or Slack webhook URL when creating an agent to receive notifications when the agent needs human interaction. See the [Notifications](./notifications.md) guide for full setup details.
