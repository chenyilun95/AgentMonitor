export type DeleteSessionFilesPolicy = 'ask' | 'keep' | 'purge';

export interface ServerSettings {
  agentRetentionMs: number;
  promptSuggestions: string[];
  pathHistory: Record<string, string[]>;
  deleteSessionFilesPolicy: DeleteSessionFilesPolicy;
  opencliTemplateSeeded?: boolean;
}
