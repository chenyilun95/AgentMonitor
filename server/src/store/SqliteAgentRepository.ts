import Database from 'better-sqlite3';
import type { Agent, AgentLogEntry, AgentMessage } from '../models/Agent.js';

type AgentMetadata = Omit<Agent, 'messages' | 'logs'>;

interface AgentRow {
  id: string;
  data: string;
}

interface ChildRow {
  agent_id: string;
  data: string;
}

export class SqliteAgentRepository {
  private db: Database.Database;
  private upsertAgent;
  private upsertMessage;
  private upsertLog;
  private selectMessageIds;
  private selectLogIds;
  private deleteMessage;
  private deleteLog;
  private deleteAgentStatement;
  private saveTransaction;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (agent_id, id)
      );
      CREATE INDEX IF NOT EXISTS messages_agent_position
        ON messages(agent_id, position);
      CREATE TABLE IF NOT EXISTS logs (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (agent_id, id)
      );
      CREATE INDEX IF NOT EXISTS logs_agent_position
        ON logs(agent_id, position);
    `);

    this.upsertAgent = this.db.prepare(`
      INSERT INTO agents (id, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
      WHERE agents.data <> excluded.data
    `);
    this.upsertMessage = this.db.prepare(`
      INSERT INTO messages (agent_id, id, position, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, id) DO UPDATE SET
        position = excluded.position,
        data = excluded.data
      WHERE messages.position <> excluded.position OR messages.data <> excluded.data
    `);
    this.upsertLog = this.db.prepare(`
      INSERT INTO logs (agent_id, id, position, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, id) DO UPDATE SET
        position = excluded.position,
        data = excluded.data
      WHERE logs.position <> excluded.position OR logs.data <> excluded.data
    `);
    this.selectMessageIds = this.db.prepare('SELECT id FROM messages WHERE agent_id = ?');
    this.selectLogIds = this.db.prepare('SELECT id FROM logs WHERE agent_id = ?');
    this.deleteMessage = this.db.prepare('DELETE FROM messages WHERE agent_id = ? AND id = ?');
    this.deleteLog = this.db.prepare('DELETE FROM logs WHERE agent_id = ? AND id = ?');
    this.deleteAgentStatement = this.db.prepare('DELETE FROM agents WHERE id = ?');
    this.saveTransaction = this.db.transaction((agent: Agent) => this.saveInsideTransaction(agent));
  }

  loadAll(): Agent[] {
    const agents = new Map<string, Agent>();
    for (const row of this.db.prepare('SELECT id, data FROM agents').all() as AgentRow[]) {
      const metadata = JSON.parse(row.data) as AgentMetadata;
      agents.set(row.id, { ...metadata, messages: [] });
    }

    const messages = this.db.prepare(`
      SELECT agent_id, data FROM messages ORDER BY agent_id, position
    `).all() as ChildRow[];
    for (const row of messages) {
      agents.get(row.agent_id)?.messages.push(JSON.parse(row.data) as AgentMessage);
    }

    const logs = this.db.prepare(`
      SELECT agent_id, data FROM logs ORDER BY agent_id, position
    `).all() as ChildRow[];
    for (const row of logs) {
      const agent = agents.get(row.agent_id);
      if (agent) (agent.logs ??= []).push(JSON.parse(row.data) as AgentLogEntry);
    }
    return [...agents.values()];
  }

  save(agent: Agent): void {
    this.saveTransaction(agent);
  }

  delete(id: string): boolean {
    return this.deleteAgentStatement.run(id).changes > 0;
  }

  private saveInsideTransaction(agent: Agent): void {
    const { messages, logs, ...metadata } = agent;
    this.upsertAgent.run(agent.id, JSON.stringify(metadata), Date.now());
    this.syncChildren(
      agent.id,
      messages,
      this.selectMessageIds,
      this.upsertMessage,
      this.deleteMessage,
    );
    this.syncChildren(
      agent.id,
      logs ?? [],
      this.selectLogIds,
      this.upsertLog,
      this.deleteLog,
    );
  }

  private syncChildren(
    agentId: string,
    children: Array<{ id: string }>,
    selectIds: Database.Statement,
    upsert: Database.Statement,
    remove: Database.Statement,
  ): void {
    const currentIds = new Set(children.map(child => child.id));
    children.forEach((child, position) => {
      upsert.run(agentId, child.id, position, JSON.stringify(child));
    });
    for (const row of selectIds.all(agentId) as Array<{ id: string }>) {
      if (!currentIds.has(row.id)) remove.run(agentId, row.id);
    }
  }
}
