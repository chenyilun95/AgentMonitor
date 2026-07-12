export interface Skill {
  name: string;
  description: string;
  body: string;
  scripts: string[];
}

export type LocalSkillSource = 'codex' | 'claude';
export type LocalSkillStatus = 'available' | 'already_imported' | 'name_conflict' | 'duplicate_content' | 'duplicate_local';

export interface LocalSkillCandidate {
  id: string;
  name: string;
  description: string;
  source: LocalSkillSource;
  status: LocalSkillStatus;
  duplicateOf?: string;
}
