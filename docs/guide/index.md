# Quick Start

## Prerequisites

- Node.js 18+
- Claude Code CLI (`claude`) or OpenAI Codex CLI (`codex`)
- OpenCLI runtime (`@jackwener/opencli`) is auto-synced during `server` install (OpenCLI itself requires Node.js 20+)
- Git (optional; needed for worktree isolation in git repos)

## Installation

```bash
git clone <repo-url> && cd AgentMonitor
npm install
```

For local-only use, you do not need relay setup. Install the CLI you want to use, then run the app directly on your machine.
When you run `cd server && npm install`, Agent Monitor also performs a best-effort sync to `@jackwener/opencli@latest`.

## Running

```bash
# Development mode (hot reload)
npm run dev

# Production build
npm run build
cd server && npm start
```

The local dev UI is available at `http://localhost:5173`, and the API server runs on `http://localhost:3456`.

## Creating Your First Agent

1. Navigate to **New Agent** in the nav bar
2. Enter a name, working directory, and prompt
3. Use **Browse** to pick a directory — if a `CLAUDE.md` or `AGENTS.md` exists, you'll be prompted to load it
4. Select provider (Claude Code or Codex)
5. Select a model from the runtime-detected dropdown (or keep `default`)
6. Configure flags (e.g., `--dangerously-skip-permissions`, `--chrome`, `--permission-mode`)
7. Click **Create Agent**

Tip: use the built-in `OpenCLI Skill Starter` template from **Load template...** if the task needs website/browser/desktop automation, or `Karpathy Coding Guardrails` if you want stricter coding guardrails.

If the working directory is a git repo, the agent will start in an isolated worktree branch. Otherwise, it works directly in the target directory.

Agent Monitor keeps instruction content compatible across providers:
- Claude agents use `CLAUDE.md`
- Codex agents use `AGENTS.md`
- If only one exists, Create Agent can still load it and write the provider-specific file when the agent is created

Model behavior is provider-specific:
- Claude applies the selected model via `--model` at process start
- Codex applies the selected model by prefixing the first turn with `/model <name>`

## Using the Dashboard

The dashboard shows all active agents as cards with:
- Provider badge (CLAUDE / CODEX)
- Current status (running, stopped, error, waiting_input)
- Cost and token usage
- Latest message preview

Click any card to enter the full chat interface.

## Settings

Open **Settings** from the dashboard to configure:
- **Auto-delete retention**: Automatically remove stopped internal agents after a configurable period (default 24h, set to 0 to keep forever)
- **Session-file delete policy**: Choose how delete handles provider session files (`ask every time`, `do not purge session files`, `always purge session files`)

## Language

Use the language dropdown in the top-right corner to switch between 7 supported languages: English, 中文, 日本語, 한국어, Español, Français, Deutsch.
