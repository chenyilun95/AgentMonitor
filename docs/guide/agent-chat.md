# Agent Chat

The chat interface provides a web-based terminal for interacting with individual agents, similar to using Claude Code or Codex in a terminal.

## Features

- **Real-time message streaming**: See agent responses as they arrive
- **Remote terminal attachment**: Toggle a live embedded terminal to see raw CLI output with full ANSI color rendering
- **Expandable tool details**: Click on tool calls to expand/collapse full input and output
- **Session resume**: Send a message to a stopped agent to automatically restart with `--resume`
- **Dash-prefixed input safety**: Codex messages beginning with `--` are forwarded as plain prompt text, not interpreted as CLI options
- **Optimistic messages**: User messages appear instantly with a thinking indicator while waiting for agent response
- **Slash commands**: 25 commands matching Claude Code CLI (see [Slash Commands](/guide/slash-commands))
- **CLAUDE.md editor**: Edit agent instructions mid-session
- **Double Esc interrupt**: Press Escape twice quickly to interrupt a running agent
- **Cost tracking**: Live cost and token usage in the header

## Chat Header

The header shows:
- Provider badge and agent name
- Working directory and cost summary
- Status indicator with color coding
- Clone button — duplicate agent configuration
- Edit CLAUDE.md button
- **Terminal button** — toggle the embedded terminal view
- Stop button (when agent is running)

## Terminal View (PTY Web Shell)

Click the **Terminal** button in the header to switch from the chat view to a full interactive terminal. This spawns a real PTY (pseudo-terminal) shell in the agent's working directory using `node-pty` on the server and xterm.js in the browser — giving you the same experience as opening a local terminal.

- **Fully interactive**: Type commands, run `claude`, `git`, or any CLI tool directly in the browser
- **Real shell**: Uses your system shell (bash/zsh) with full color support (xterm-256color)
- **5000-line scrollback**: Scroll up to review past output
- **Auto-resize**: The terminal fits the available space and adapts to window resizing
- **Works remotely**: PTY data streams through the relay tunnel, so you can use the terminal from any device
- **Keyboard focus**: Terminal auto-focuses when activated for immediate keyboard input

Toggle back to chat view by clicking the Terminal button again. Both views stay mounted so no data is lost when switching. The PTY session persists while you switch between views.

### Two Interfaces, Your Choice

Agent Monitor offers two complementary ways to interact with agents:

1. **Chat View** (default) — Structured JSON-based interface with message bubbles, tool call expansion, slash commands, and cost tracking. Best for monitoring and reviewing agent work.

2. **Terminal View** — Real PTY shell in the agent's working directory. Best for hands-on work: running commands, launching `claude` manually, debugging, or any task where you want a full terminal experience.

## File Attachments

Attach images, documents, code files, or any other file type to your messages.

- **Clipboard paste**: Press **Ctrl+V** (or Cmd+V) to attach an image or file from your clipboard
- **Attach button**: Click the paperclip button next to the input area to browse and select files
- **Size limit**: Up to 50 MB per file
- **Preview chips**: Each attached file appears as a chip below the input showing filename, size, and an **X** button to remove it before sending
- **Lazy upload**: Files are stored locally in the browser until you click **Send** — nothing is uploaded until then
- **Server storage**: On send, files are uploaded to `/tmp/agentmonitor-uploads/` and the file paths are included in the message text as `[Image: /path]` or `[File: /path]` so the agent can access them
- **Relay support**: In remote/relay mode, file uploads are forwarded through the tunnel to the agent machine

## Message Types

Messages are color-coded by role:
- **User messages**: Your input to the agent
- **Assistant messages**: Agent responses (highlighted)
- **Tool messages**: Tool usage indicators (click to expand full input/output)
- **System messages**: Local command output (from slash commands)

## Safety Notes

When Agent Monitor starts or resumes a Codex session, it inserts an explicit end-of-options separator before positional prompt arguments. That means messages like `--help`, `--model gpt-5`, or other dash-prefixed text stay normal chat content instead of being parsed as Codex CLI flags.
