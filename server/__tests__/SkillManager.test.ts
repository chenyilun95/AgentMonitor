import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillManager } from '../src/services/SkillManager.js';

function writeSkill(root: string, directory: string, name: string, body: string, script?: string): void {
  const skillDir = path.join(root, directory);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: "${name} description"\n---\n\n${body}\n`,
  );
  if (script) {
    fs.mkdirSync(path.join(skillDir, 'scripts'));
    fs.writeFileSync(path.join(skillDir, 'scripts', 'run.sh'), script);
  }
}

describe('SkillManager local imports', () => {
  let tmpDir: string;
  let managedDir: string;
  let codexDir: string;
  let claudeDir: string;
  let manager: SkillManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manager-test-'));
    managedDir = path.join(tmpDir, 'managed');
    codexDir = path.join(tmpDir, 'codex');
    claudeDir = path.join(tmpDir, 'claude');
    manager = new SkillManager(managedDir, { codex: codexDir, claude: claudeDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deduplicates matching names and matching content across local sources', () => {
    writeSkill(managedDir, 'installed', 'installed', 'same installed body');
    writeSkill(codexDir, 'installed', 'installed', 'same installed body');
    writeSkill(codexDir, 'shared', 'shared', 'codex version');
    writeSkill(claudeDir, 'shared', 'shared', 'claude version');
    writeSkill(codexDir, 'first-name', 'first-name', 'identical body');
    writeSkill(claudeDir, 'second-name', 'second-name', 'identical body');

    const byId = new Map(manager.discoverLocalSkills().map(candidate => [candidate.id, candidate]));
    expect(byId.get('codex:installed')?.status).toBe('already_imported');
    expect(byId.get('codex:shared')?.status).toBe('available');
    expect(byId.get('claude:shared')?.status).toBe('duplicate_local');
    expect(byId.get('codex:first-name')?.status).toBe('available');
    expect(byId.get('claude:second-name')?.status).toBe('duplicate_local');
  });

  it('copies the complete skill once and treats repeated imports as idempotent', () => {
    writeSkill(codexDir, 'deploy', 'deploy', 'deploy instructions', '#!/bin/sh\necho deploy');

    const first = manager.importLocalSkill('codex:deploy');
    expect(first.imported).toBe(true);
    expect(first.skill.scripts).toEqual(['run.sh']);
    expect(fs.readFileSync(path.join(managedDir, 'deploy', 'scripts', 'run.sh'), 'utf-8')).toContain('deploy');

    const second = manager.importLocalSkill('codex:deploy');
    expect(second.imported).toBe(false);
    expect(manager.listSkills().map(skill => skill.name)).toEqual(['deploy']);
  });

  it('refuses to overwrite an existing skill with different content', () => {
    writeSkill(managedDir, 'deploy', 'deploy', 'managed version');
    writeSkill(codexDir, 'deploy', 'deploy', 'local version');

    expect(manager.discoverLocalSkills()[0].status).toBe('name_conflict');
    expect(() => manager.importLocalSkill('codex:deploy')).toThrow('name_conflict');
    expect(manager.getSkill('deploy')?.body).toBe('managed version');
  });
});
