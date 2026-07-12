import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import type { LocalSkillCandidate, LocalSkillSource, Skill } from '@agent-monitor/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function parseFrontmatter(content: string): { name: string; description: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { name: '', description: '', body: content };

  const yaml = match[1];
  const body = match[2].trim();
  let name = '';
  let description = '';

  for (const line of yaml.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      name = nameMatch[1].replace(/^["']|["']$/g, '').trim();
    }
    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) {
      description = descMatch[1].replace(/^["']|["']$/g, '').trim();
    }
  }

  return { name, description, body };
}

function buildSkillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: "${description.replace(/"/g, '\\"')}"\n---\n\n${body}\n`;
}

export class SkillManager {
  private skillsDir: string;
  private localSkillRoots: Record<LocalSkillSource, string>;

  constructor(skillsDir?: string, localSkillRoots?: Partial<Record<LocalSkillSource, string>>) {
    this.skillsDir = skillsDir || path.resolve(__dirname, '..', '..', '..', 'skills');
    this.localSkillRoots = {
      codex: localSkillRoots?.codex || path.join(os.homedir(), '.codex', 'skills'),
      claude: localSkillRoots?.claude || path.join(os.homedir(), '.claude', 'skills'),
    };
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }

  listSkills(): Skill[] {
    if (!fs.existsSync(this.skillsDir)) return [];

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = this.readSkill(entry.name);
      if (skill) skills.push(skill);
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  getSkill(name: string): Skill | null {
    return this.readSkill(name);
  }

  discoverLocalSkills(): LocalSkillCandidate[] {
    const installed = this.listSkills();
    const installedByName = new Map<string, { name: string; fingerprint: string }>();
    const installedByFingerprint = new Map<string, string>();
    for (const skill of installed) {
      const fingerprint = this.fingerprintSkillDir(path.join(this.skillsDir, skill.name));
      installedByName.set(skill.name.toLowerCase(), { name: skill.name, fingerprint });
      installedByFingerprint.set(fingerprint, skill.name);
    }

    const localNames = new Map<string, string>();
    const localFingerprints = new Map<string, string>();
    const candidates: LocalSkillCandidate[] = [];

    for (const source of ['codex', 'claude'] as const) {
      const root = this.localSkillRoots[source];
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && VALID_NAME.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        const skillDir = path.join(root, entry.name);
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        const raw = fs.readFileSync(skillMd, 'utf-8');
        const parsed = parseFrontmatter(raw);
        const name = VALID_NAME.test(parsed.name) ? parsed.name : entry.name;
        const fingerprint = this.fingerprintSkillDir(skillDir);
        const installedNameMatch = installedByName.get(name.toLowerCase());
        const installedContentMatch = installedByFingerprint.get(fingerprint);
        const localNameMatch = localNames.get(name.toLowerCase());
        const localContentMatch = localFingerprints.get(fingerprint);

        let status: LocalSkillCandidate['status'] = 'available';
        let duplicateOf: string | undefined;
        if (installedNameMatch) {
          status = installedNameMatch.fingerprint === fingerprint ? 'already_imported' : 'name_conflict';
          duplicateOf = installedNameMatch.name;
        } else if (installedContentMatch) {
          status = 'duplicate_content';
          duplicateOf = installedContentMatch;
        } else if (localNameMatch || localContentMatch) {
          status = 'duplicate_local';
          duplicateOf = localNameMatch || localContentMatch;
        }

        const id = `${source}:${entry.name}`;
        candidates.push({ id, name, description: parsed.description, source, status, duplicateOf });
        if (status === 'available') {
          localNames.set(name.toLowerCase(), id);
          localFingerprints.set(fingerprint, id);
        }
      }
    }

    return candidates;
  }

  importLocalSkill(id: string): { imported: boolean; skill: Skill } {
    const candidate = this.discoverLocalSkills().find(item => item.id === id);
    if (!candidate) throw new Error('Local skill not found');
    if (candidate.status === 'already_imported') {
      const existing = this.readSkill(candidate.name);
      if (existing) return { imported: false, skill: existing };
    }
    if (candidate.status !== 'available') {
      throw new Error(`Skill cannot be imported: ${candidate.status}${candidate.duplicateOf ? ` (${candidate.duplicateOf})` : ''}`);
    }

    const [source, directoryName] = id.split(':', 2) as [LocalSkillSource, string];
    if (!(source in this.localSkillRoots) || !VALID_NAME.test(directoryName)) {
      throw new Error('Invalid local skill identifier');
    }
    const sourceDir = path.join(this.localSkillRoots[source], directoryName);
    const destination = path.join(this.skillsDir, candidate.name);
    if (fs.existsSync(destination)) throw new Error(`Skill "${candidate.name}" already exists`);

    fs.cpSync(sourceDir, destination, { recursive: true, errorOnExist: true });
    const skill = this.readSkill(candidate.name);
    if (!skill) {
      fs.rmSync(destination, { recursive: true, force: true });
      throw new Error('Imported skill is missing a valid SKILL.md');
    }
    return { imported: true, skill };
  }

  createSkill(name: string, description: string, body: string): Skill {
    if (!VALID_NAME.test(name)) {
      throw new Error('Skill name must contain only letters, numbers, hyphens, and underscores');
    }

    const skillDir = path.join(this.skillsDir, name);
    if (fs.existsSync(skillDir)) {
      throw new Error(`Skill "${name}" already exists`);
    }

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMd(name, description, body));

    return { name, description, body, scripts: [] };
  }

  updateSkill(name: string, description?: string, body?: string): Skill {
    const existing = this.readSkill(name);
    if (!existing) throw new Error(`Skill "${name}" not found`);

    const newDesc = description ?? existing.description;
    const newBody = body ?? existing.body;

    fs.writeFileSync(
      path.join(this.skillsDir, name, 'SKILL.md'),
      buildSkillMd(name, newDesc, newBody),
    );

    return { name, description: newDesc, body: newBody, scripts: existing.scripts };
  }

  deleteSkill(name: string): boolean {
    const skillDir = path.join(this.skillsDir, name);
    if (!fs.existsSync(skillDir)) return false;
    fs.rmSync(skillDir, { recursive: true, force: true });
    return true;
  }

  addScript(name: string, filename: string, content: Buffer): void {
    const skillDir = path.join(this.skillsDir, name);
    if (!fs.existsSync(skillDir)) throw new Error(`Skill "${name}" not found`);

    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, filename), content);
  }

  deleteScript(name: string, filename: string): boolean {
    const scriptPath = path.join(this.skillsDir, name, 'scripts', filename);
    if (!fs.existsSync(scriptPath)) return false;
    fs.unlinkSync(scriptPath);
    return true;
  }

  private readSkill(name: string): Skill | null {
    const skillMdPath = path.join(this.skillsDir, name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) return null;

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { name: parsedName, description, body } = parseFrontmatter(content);

    const scriptsDir = path.join(this.skillsDir, name, 'scripts');
    let scripts: string[] = [];
    if (fs.existsSync(scriptsDir)) {
      scripts = fs.readdirSync(scriptsDir).filter(f => !f.startsWith('.'));
    }

    return { name: parsedName || name, description, body, scripts };
  }

  private fingerprintSkillDir(skillDir: string): string {
    const hash = createHash('sha256');
    const visit = (dir: string, relativeDir = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.name !== '.DS_Store')
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath, relativePath);
        } else if (entry.isSymbolicLink()) {
          hash.update(`link:${relativePath}:${fs.readlinkSync(fullPath)}\n`);
        } else if (entry.isFile()) {
          hash.update(`file:${relativePath}\n`);
          let content = fs.readFileSync(fullPath);
          if (relativePath === 'SKILL.md') {
            // Identity is based on executable instructions/assets, not display
            // metadata, so renamed copies are still recognized as duplicates.
            content = Buffer.from(parseFrontmatter(content.toString('utf-8')).body.trim());
          }
          hash.update(content);
        }
      }
    };
    visit(skillDir);
    return hash.digest('hex');
  }
}
