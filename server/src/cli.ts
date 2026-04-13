#!/usr/bin/env node
import { Command } from 'commander';
import { CliClient } from './lib/cliClient.js';

const program = new Command();

function getClient(opts: { url?: string }): CliClient {
  const url = opts.url || process.env.AGENTMONITOR_URL || 'http://localhost:3456';
  return new CliClient(url);
}

program
  .name('agentmonitor')
  .description('AgentMonitor CLI')
  .version('1.0.0')
  .option('--url <url>', 'Server URL (default: $AGENTMONITOR_URL or http://localhost:3456)');

// ── run ──
program
  .command('run <prompt>')
  .description('Create and start an agent')
  .option('-d, --detach', 'Run in background (print id and exit)')
  .option('--provider <provider>', 'Agent provider', 'claude')
  .option('--model <model>', 'Model to use')
  .option('--dir <directory>', 'Working directory', process.cwd())
  .option('--name <name>', 'Agent name')
  .option('--label <kv...>', 'Labels as key=value (repeatable)')
  .option('--output-schema <file>', 'Path to JSON Schema file for structured output')
  .option('--json', 'Output JSON')
  .option('--skip-permissions', 'Skip permission prompts')
  .action(async (prompt: string, opts) => {
    const client = getClient(program.opts());
    const labels: Record<string, string> = {};
    if (opts.label) {
      for (const kv of opts.label) {
        const eq = kv.indexOf('=');
        if (eq > 0) labels[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    }
    let outputSchema: Record<string, unknown> | undefined;
    if (opts.outputSchema) {
      const fs = await import('fs');
      outputSchema = JSON.parse(fs.readFileSync(opts.outputSchema, 'utf-8'));
    }
    try {
      const agent = await client.createAgent({
        name: opts.name || `cli-${Date.now()}`,
        provider: opts.provider,
        directory: opts.dir,
        prompt,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
        flags: {
          model: opts.model || undefined,
          dangerouslySkipPermissions: opts.skipPermissions || undefined,
          outputSchema,
        },
      }) as Record<string, unknown>;

      if (opts.detach) {
        if (opts.json) {
          console.log(JSON.stringify(agent, null, 2));
        } else {
          console.log(`Agent created: ${agent.id}`);
        }
        return;
      }

      // Stream messages until agent finishes
      console.log(`Agent ${agent.id} started. Streaming output...\n`);
      await new Promise<void>((resolve) => {
        const ws = client.streamMessages(
          agent.id as string,
          (msg) => {
            const role = msg.role as string;
            const content = msg.content as string;
            if (role === 'assistant') {
              process.stdout.write(content + '\n');
            } else if (role === 'tool') {
              const toolName = msg.toolName as string || 'tool';
              console.log(`[${toolName}] ${content}`);
            }
          },
          () => {
            ws.close();
            resolve();
          },
        );
      });

      // Print structured output if available
      const final = await client.getAgent(agent.id as string);
      if (final.structuredOutput != null) {
        console.log('\n--- Structured Output ---');
        console.log(JSON.stringify(final.structuredOutput, null, 2));
      }

      if (opts.json) {
        console.log(JSON.stringify(final, null, 2));
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── ls ──
program
  .command('ls')
  .description('List agents')
  .option('--label <kv...>', 'Filter by label key:value (repeatable)')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const client = getClient(program.opts());
    try {
      const agents = await client.listAgents({
        label: opts.label,
        status: opts.status,
      }) as Array<Record<string, unknown>>;

      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      if (agents.length === 0) {
        console.log('No agents found.');
        return;
      }

      // Table output
      const header = ['ID', 'NAME', 'STATUS', 'PROVIDER', 'LABELS'].map(h => h.padEnd(14)).join('  ');
      console.log(header);
      console.log('-'.repeat(header.length));
      for (const a of agents) {
        const labels = a.labels ? Object.entries(a.labels as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(',') : '';
        const row = [
          (a.id as string).slice(0, 12),
          ((a.name as string) || '').slice(0, 14),
          (a.status as string),
          ((a.config as Record<string, unknown>)?.provider as string) || 'claude',
          labels.slice(0, 14),
        ].map(c => (c || '').padEnd(14)).join('  ');
        console.log(row);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── logs ──
program
  .command('logs <id>')
  .description('Stream agent messages')
  .action(async (id: string) => {
    const client = getClient(program.opts());
    try {
      // Print existing messages first
      const agent = await client.getAgent(id) as Record<string, unknown>;
      const messages = (agent.messages as Array<Record<string, unknown>>) || [];
      for (const msg of messages) {
        const role = msg.role as string;
        const content = msg.content as string;
        if (role === 'assistant') {
          process.stdout.write(content + '\n');
        } else if (role === 'user') {
          console.log(`[user] ${content}`);
        } else if (role === 'tool') {
          console.log(`[${msg.toolName || 'tool'}] ${content}`);
        }
      }

      if (agent.status === 'stopped' || agent.status === 'error') {
        console.log(`\nAgent ${agent.status}.`);
        return;
      }

      // Stream new messages
      await new Promise<void>((resolve) => {
        const ws = client.streamMessages(
          id,
          (msg) => {
            const role = msg.role as string;
            const content = msg.content as string;
            if (role === 'assistant') {
              process.stdout.write(content + '\n');
            } else if (role === 'tool') {
              console.log(`[${msg.toolName || 'tool'}] ${content}`);
            }
          },
          () => {
            console.log('\nAgent finished.');
            ws.close();
            resolve();
          },
        );
      });
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── send ──
program
  .command('send <id> <message>')
  .description('Send a message to an agent')
  .action(async (id: string, message: string) => {
    const client = getClient(program.opts());
    try {
      await client.sendMessage(id, message);
      console.log('Message sent.');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── stop ──
program
  .command('stop <id>')
  .description('Stop an agent')
  .action(async (id: string) => {
    const client = getClient(program.opts());
    try {
      await client.stopAgent(id);
      console.log('Agent stopped.');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── wait ──
program
  .command('wait <id>')
  .description('Wait for an agent to finish')
  .option('--timeout <ms>', 'Timeout in milliseconds', '60000')
  .option('--json', 'Output JSON')
  .action(async (id: string, opts) => {
    const client = getClient(program.opts());
    try {
      const result = await client.waitForAgent(id, Number(opts.timeout));
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const r = result as Record<string, unknown>;
        if (r.timedOut) {
          console.log('Timed out waiting for agent.');
          process.exit(2);
        } else {
          console.log(`Agent finished with status: ${r.status}`);
        }
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

// ── delete ──
program
  .command('delete <id>')
  .description('Delete an agent')
  .action(async (id: string) => {
    const client = getClient(program.opts());
    try {
      await client.deleteAgent(id);
      console.log('Agent deleted.');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse();
