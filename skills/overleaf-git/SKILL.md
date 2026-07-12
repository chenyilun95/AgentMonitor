---
name: overleaf-git
description: Manage Overleaf projects through their Git remotes. Use when Codex needs to clone an Overleaf project URL, organize local Overleaf project folders with readable names, inspect or preserve Overleaf Git remotes, explain Overleaf version history versus Git, or help sync local Git edits with web-based Overleaf collaborators.
---

# Overleaf Git

Use this skill for Overleaf projects accessed through `git.overleaf.com`.

## Core Model

Treat Overleaf Git as a normal Git remote for local operations, with these caveats:

- The readable web URL is usually `https://cn.overleaf.com/project/<project-id>` or `https://www.overleaf.com/project/<project-id>`.
- The Git remote is usually `https://git.overleaf.com/<project-id>`.
- Some existing clones may use forms such as `https://git@git.overleaf.com/<project-id>`; preserve a working remote unless there is a concrete reason to change it.
- Overleaf web history and Git history are related but not identical. Web editing can create generic commits such as `Update on Overleaf.`
- Web-based simultaneous editing is handled by Overleaf. Git pushes still follow normal Git rules and may require `pull`, rebase, or conflict resolution.

## Clone Workflow

1. Extract the project ID from the Overleaf URL.
2. Check remote reachability before cloning when credentials are expected to already exist:

```bash
git ls-remote https://git.overleaf.com/<project-id>
```

3. Clone with an explicit local directory name:

```bash
git clone https://git.overleaf.com/<project-id> <readable-folder-name>
```

4. Verify the clone:

```bash
git -C <readable-folder-name> status --short --branch
git -C <readable-folder-name> log -1 --oneline
git -C <readable-folder-name> remote -v
```

If authentication fails, report that the Overleaf Git token or credentials are missing or invalid. Do not ask the user to paste tokens into chat unless there is no safer local credential path.

## Local Folder Naming

Prefer readable local folder names over raw Overleaf project IDs. The folder name does not affect the remote.

Derive names from project contents when possible:

- Search `main.tex` and nearby files for `\title{...}`, `\author{...}`, README text, or obvious project names.
- Use lowercase hyphen-case ASCII names.
- Keep names short and stable, for example `academic-cv` or `lambda0-humanoid-control`.
- Avoid speculative names based on a single incidental commit unless the user approves.

Rename only the local folder:

```bash
mv <old-folder> <new-folder>
git -C <new-folder> status --short --branch
```

## Moving Existing Clones

When consolidating Overleaf projects into a directory such as `~/rep/overleaf`:

1. List candidate directories and identify raw project-ID folder names.
2. Confirm each candidate is a Git repository and a LaTeX/Overleaf project:

```bash
git -C <candidate> status --short --branch
git -C <candidate> remote -v
find <candidate> -maxdepth 2 -type f | sort | head
```

3. Pick a readable destination name from content, not just from commit messages.
4. Move the directory with `mv`, preserving `.git`.
5. Run `git status --short --branch` after the move.

Do not move a directory into itself. Check current working directory and destination contents before moving.

## Sync Guidance

For local editing when collaborators may use the Overleaf web editor:

```bash
git pull
# edit locally
git add .
git commit -m "Describe the change"
git pull --rebase
git push
```

Use normal Git conflict handling if the web editor or another Git user changed the same files. Avoid `git push --force` unless the user explicitly requests it and the collaboration risk is understood.

## Explaining Version History

When asked how Overleaf stores versions, explain:

- Overleaf web History is an automatic collaborative editing history with compare and restore features.
- Overleaf Git exposes the project as a Git remote for local `pull`, `commit`, and `push`.
- They are practically connected, but the web History is not a perfect substitute for clean, intentional local Git commits.
- For auditable versions, recommend meaningful local commits; use Overleaf History as web-side recovery and collaboration history.
