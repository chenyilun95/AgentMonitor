import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Skill } from '../models/Skill.js';

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

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.resolve(__dirname, '..', '..', '..', 'skills');
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
}
