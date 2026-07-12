import { describe, it, expect, vi } from 'vitest';
import { getSlashCommandDefinitions, executeSlashCommand, type SlashCommandContext } from '../../src/lib/slashCommands';

const t = (key: string) => key;

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    agent: {
      id: 'agent-1',
      name: 'Test',
      status: 'running',
      config: {
        provider: 'claude',
        directory: '/tmp',
        prompt: 'test',
        flags: {},
      },
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'hi there', timestamp: 2000 },
        { id: 'm3', role: 'tool', content: 'result', timestamp: 3000 },
      ],
      lastActivity: 3000,
      createdAt: 1000,
    } as any,
    id: 'agent-1',
    addLocalMessage: vi.fn(),
    navigate: vi.fn(),
    fetchAgent: vi.fn(),
    setAgent: vi.fn(),
    setLocalMessages: vi.fn(),
    toggleInteractionMode: vi.fn(),
    renameCurrentAgent: vi.fn(),
    formatReasoningEffort: () => 'medium',
    btwInputRef: { current: null },
    setBtwState: vi.fn(),
    t,
    getAgentStatusLabel: (s: any) => s,
    commands: getSlashCommandDefinitions(t),
    ...overrides,
  };
}

describe('getSlashCommandDefinitions', () => {
  it('returns an array of command definitions', () => {
    const defs = getSlashCommandDefinitions(t);
    expect(defs.length).toBeGreaterThan(30);
    expect(defs[0]).toHaveProperty('cmd');
    expect(defs[0]).toHaveProperty('desc');
  });

  it('all commands start with /', () => {
    const defs = getSlashCommandDefinitions(t);
    for (const def of defs) {
      expect(def.cmd).toMatch(/^\//);
    }
  });

  it('has no duplicate commands', () => {
    const defs = getSlashCommandDefinitions(t);
    const cmds = defs.map(d => d.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
  });
});

describe('executeSlashCommand', () => {
  it('/help outputs all commands', () => {
    const ctx = makeContext();
    executeSlashCommand('/help', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledTimes(1);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('/help');
    expect(output).toContain('/stats');
  });

  it('/exit navigates to /', () => {
    const ctx = makeContext();
    executeSlashCommand('/exit', ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/');
  });

  it('/btw opens the btw popup', () => {
    const ctx = makeContext();
    executeSlashCommand('/btw', ctx);
    expect(ctx.setBtwState).toHaveBeenCalledWith({ status: 'input' });
  });

  it('/side also opens the btw popup', () => {
    const ctx = makeContext();
    executeSlashCommand('/side', ctx);
    expect(ctx.setBtwState).toHaveBeenCalledWith({ status: 'input' });
  });

  it('/plan toggles interaction mode', () => {
    const ctx = makeContext();
    executeSlashCommand('/plan', ctx);
    expect(ctx.toggleInteractionMode).toHaveBeenCalled();
  });

  it('/rename calls renameCurrentAgent', () => {
    const ctx = makeContext();
    executeSlashCommand('/rename', ctx);
    expect(ctx.renameCurrentAgent).toHaveBeenCalled();
  });

  it('/config shows agent config', () => {
    const ctx = makeContext();
    executeSlashCommand('/config', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledTimes(1);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('Provider: claude');
    expect(output).toContain('Directory: /tmp');
  });

  it('/stats shows message statistics', () => {
    const ctx = makeContext();
    executeSlashCommand('/stats', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledTimes(1);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('3'); // total messages
    expect(ctx.fetchAgent).toHaveBeenCalled();
  });

  it('/status shows agent status info', () => {
    const ctx = makeContext();
    executeSlashCommand('/status', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledTimes(1);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('Test');
    expect(output).toContain('CLAUDE');
  });

  it('/context shows context usage', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        tokenUsage: { input: 5000, output: 2000 },
        contextWindow: { used: 7000, total: 200000 },
      } as any,
    });
    executeSlashCommand('/context', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('%');
    expect(output).toContain('200,000');
  });

  it('/memory shows CLAUDE.md', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        config: { ...makeContext().agent!.config, claudeMd: '# Rules\nBe nice' },
      } as any,
    });
    executeSlashCommand('/memory', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('# Rules');
  });

  it('/doctor reports healthy agent', () => {
    const ctx = makeContext();
    executeSlashCommand('/doctor', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('chat.doctorOk');
  });

  it('/doctor reports issues', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        status: 'error',
        config: { ...makeContext().agent!.config, directory: '' },
        messages: [],
      } as any,
    });
    executeSlashCommand('/doctor', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('chat.doctorError');
    expect(output).toContain('error state');
  });

  it('/permissions shows agent flags', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        config: { ...makeContext().agent!.config, flags: { dangerouslySkipPermissions: true } },
      } as any,
    });
    executeSlashCommand('/permissions', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('dangerouslySkipPermissions');
  });

  it('/todos finds TODO patterns in messages', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        messages: [
          { id: 'm1', role: 'assistant', content: 'TODO: fix bug\nFIXME: memory leak', timestamp: 1 },
        ],
      } as any,
    });
    executeSlashCommand('/todos', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('fix bug');
    expect(output).toContain('memory leak');
  });

  it('/todos reports no todos when none found', () => {
    const ctx = makeContext({
      agent: {
        ...makeContext().agent!,
        messages: [{ id: 'm1', role: 'assistant', content: 'all good', timestamp: 1 }],
      } as any,
    });
    executeSlashCommand('/todos', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledWith('chat.noTodos');
  });

  it('does nothing for unhandled commands', () => {
    const ctx = makeContext();
    executeSlashCommand('/nonexistent', ctx);
    expect(ctx.addLocalMessage).not.toHaveBeenCalled();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('/stop does not add local messages', () => {
    // /stop calls api.stopAgent which makes a network request
    // In jsdom, this throws but we just verify no local message is added
    const ctx = makeContext({ id: undefined }); // no id = skips api call
    executeSlashCommand('/stop', ctx);
    expect(ctx.addLocalMessage).not.toHaveBeenCalled();
  });

  it('no-ops when agent is null for agent-dependent commands', () => {
    const ctx = makeContext({ agent: null });
    executeSlashCommand('/config', ctx);
    expect(ctx.addLocalMessage).not.toHaveBeenCalled();
  });

  it('/skills lists all available commands', () => {
    const ctx = makeContext();
    executeSlashCommand('/skills', ctx);
    const output = (ctx.addLocalMessage as any).mock.calls[0][0] as string;
    expect(output).toContain('chat.availableSkills');
    expect(output).toContain('/help');
    expect(output).toContain('/btw');
  });

  it('/plugin shows plugin info', () => {
    const ctx = makeContext();
    executeSlashCommand('/plugin', ctx);
    expect(ctx.addLocalMessage).toHaveBeenCalledWith('chat.pluginInfo');
  });
});
