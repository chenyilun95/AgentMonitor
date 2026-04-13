import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { HandoffFile } from '../models/Handoff.js';

const HANDOFF_DIR = '.agent-harness/handoffs';

export class HandoffManager {
  /**
   * Write a handoff file for a task into the working directory.
   */
  writeHandoff(workingDir: string, handoff: HandoffFile): string {
    const dir = path.join(workingDir, HANDOFF_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, `${handoff.taskId}.json`);
    writeFileSync(filePath, JSON.stringify(handoff, null, 2));
    return filePath;
  }

  /**
   * Read a handoff file for a task. Returns null if not found.
   */
  readHandoff(workingDir: string, taskId: string): HandoffFile | null {
    const filePath = path.join(workingDir, HANDOFF_DIR, `${taskId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as HandoffFile;
    } catch {
      return null;
    }
  }

  /**
   * Try to extract a JSON handoff from agent messages as fallback
   * when the agent didn't write a proper handoff file.
   */
  extractHandoffFromMessages(messages: Array<{ role: string; content: string }>): Partial<HandoffFile> | null {
    // Search from the end for a JSON block in assistant messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      const jsonMatch = msg.content.match(/```json\s*\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          return this.normalizeHandoff(JSON.parse(jsonMatch[1]));
        } catch {
          continue;
        }
      }

      // Try parsing the whole message as JSON
      const braceMatch = msg.content.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return this.normalizeHandoff(JSON.parse(braceMatch[0]));
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  /**
   * Normalize parsed JSON to match HandoffFile shape.
   * The planner prompt asks for "tasks" but HandoffFile uses "decomposedTasks".
   */
  private normalizeHandoff(raw: Record<string, unknown>): Partial<HandoffFile> {
    if (raw.tasks && !raw.decomposedTasks) {
      raw.decomposedTasks = raw.tasks;
      delete raw.tasks;
    }
    return raw as Partial<HandoffFile>;
  }

  /**
   * Get the handoff directory path for a working directory.
   */
  getHandoffDir(workingDir: string): string {
    return path.join(workingDir, HANDOFF_DIR);
  }
}
