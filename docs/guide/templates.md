# Templates & Instruction Files

Templates let you save and reuse instruction-file content across agents. Combined with the **Clone Agent** feature, you can quickly spin up new agents with pre-configured instructions and settings.

- Claude agents use `CLAUDE.md`
- Codex agents use `AGENTS.md`

## Auto-Detect Instruction Files

When creating a new agent, **Agent Monitor automatically detects** whether the selected working directory already contains an instruction file for the chosen provider.

If found, you'll see a prompt offering to:

- **Load existing** — Use the project's instruction file as the agent's instructions
- **Keep custom** — Dismiss the prompt and write your own instructions

Detection is provider-aware and includes compatibility fallback (for example, a Codex agent can still load a directory that currently has `CLAUDE.md`, and vice versa). The detection happens via `GET /api/directories/claude-md?path=...&provider=...`.

## Managing Templates

Navigate to **Templates** in the nav bar to:

- **Use built-in templates**: Agent Monitor auto-seeds `OpenCLI Skill Starter` and `Karpathy Coding Guardrails` on first run
- **Create**: Click **+ New Template**, enter a name and instruction content
- **Edit**: Click the edit button on any template to modify it
- **Delete**: Remove templates you no longer need

## Using Templates

When creating a new agent:
1. Click **Load template...** in the instruction-file section
2. Select a template from the dropdown
3. The template content is loaded into the editor
4. Modify as needed before creating the agent

## Live Editing

You can modify an agent's instruction file content at any time from the Chat view without restarting the agent.

## Cloning Agents

The **Clone** button (visible on every agent card and in the chat header) creates a new agent pre-filled with:

- Same working directory
- Same provider (Claude Code / Codex)
- Same flags and configuration
- Same instruction-file content (`CLAUDE.md` / `AGENTS.md`)

This is the fastest way to run a variation of an existing agent — clone it, adjust the prompt or flags, and launch. Cloning does **not** copy the conversation history; the new agent starts fresh.

### Workflow: Template → Clone

A common pattern for reusable agent setups:

1. **Create a template** with your standard instructions (e.g., "TypeScript coding standards")
2. **Create an agent**, load the template into its instruction file, set the directory and flags
3. **Clone** that agent whenever you need a fresh instance with the same setup

This gives you a library of reusable agent configurations without manually re-entering settings each time.

## Template Tips

- Create a base template with common instructions (coding style, testing requirements)
- Create specialized templates for different task types (frontend, backend, testing)
- Start from `OpenCLI Skill Starter` when the task may need web/browser/desktop automation via `opencli`
- Start from `Karpathy Coding Guardrails` when you want the agent to bias toward clarification, simplicity, surgical diffs, and explicit verification
- Templates are stored server-side and available to all users
- Use Clone + Template together: template provides the instructions, clone replicates the full agent config
