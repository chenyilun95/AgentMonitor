import { describe, expect, it } from 'vitest';
import { AgentProcess, type ProcessStartOpts } from '../src/services/AgentProcess.js';

function buildCommand(opts: Partial<ProcessStartOpts>) {
  const proc = new AgentProcess() as unknown as {
    buildCommand: (opts: ProcessStartOpts) => { bin: string; args: string[] };
  };

  return proc.buildCommand({
    provider: 'codex',
    directory: '/tmp/project',
    prompt: 'hello',
    ...opts,
  });
}

describe('AgentProcess codex args', () => {
  it('does not pass removed codex exec approval flags', () => {
    const { args } = buildCommand({
      fullAuto: true,
      askForApprovalNever: true,
      sandboxDangerFullAccess: true,
    });

    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('--ask-for-approval');
    expect(args).toContain('-c');
    expect(args).toContain("'approval_policy=\"never\"'");
    expect(args).toContain('--sandbox');
    expect(args).toContain('danger-full-access');
  });

  it('uses the dangerous bypass flag when skip permissions is enabled', () => {
    const { args } = buildCommand({
      dangerouslySkipPermissions: true,
      fullAuto: true,
      askForApprovalNever: true,
    });

    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('--ask-for-approval');
    expect(args).not.toContain("'approval_policy=\"never\"'");
  });

  it('uses config overrides for codex exec resume sandbox settings', () => {
    const { args } = buildCommand({
      resume: '019ec14b-a998-7a93-a0b4-6ecc22953324',
      sandboxDangerFullAccess: true,
    });

    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '--json']);
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('-c');
    expect(args).toContain("'sandbox_mode=\"danger-full-access\"'");
  });
});
