# Agents API

## List Agents

```
GET /api/agents
```

Returns an array of all agents.

## Get Agent

```
GET /api/agents/:id
```

Returns a single agent with full message history.

## Create Agent

```
POST /api/agents
```

**Body:**
```json
{
  "name": "my-agent",
  "provider": "claude",
  "directory": "/path/to/project",
  "prompt": "What should the agent do?",
  "providerInstructions": "Optional provider-specific instructions",
  "adminEmail": "admin@example.com",
  "flags": {
    "dangerouslySkipPermissions": true,
    "model": "claude-sonnet-4-20250514"
  }
}
```

## Stop Agent

```
POST /api/agents/:id/stop
```

## Stop All Agents

```
POST /api/agents/actions/stop-all
```

## Delete Agent

```
DELETE /api/agents/:id
```

**Optional body:**
```json
{
  "purgeSessionFiles": true
}
```

If omitted, the server uses the dashboard setting `deleteSessionFilesPolicy`.
When provided, `purgeSessionFiles` overrides the default for this delete request only.

## Send Message

```
POST /api/agents/:id/message
```

**Body:**
```json
{
  "text": "Your message to the agent"
}
```

## Interrupt Agent

```
POST /api/agents/:id/interrupt
```

Sends SIGINT to the agent process (equivalent to double-Esc).

## Rename Agent

```
PUT /api/agents/:id/rename
```

**Body:**
```json
{
  "name": "new-agent-name"
}
```

## Update Provider Instructions

```
PUT /api/agents/:id/instructions
```

**Body:**
```json
{
  "content": "Updated provider instructions"
}
```

`PUT /api/agents/:id/claude-md` remains available as a deprecated compatibility alias.
