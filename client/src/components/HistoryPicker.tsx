import type { AgentClientView } from '@agent-monitor/shared';

type Agent = AgentClientView;

interface HistoryPickerProps {
  agent: Agent | null;
  historyPickerIdx: number;
  historyRestoringIdx: number | null;
  onClose: () => void;
  onRestore: (turnIndex: number) => void;
  onHover: (index: number) => void;
  t: (key: string) => string;
}

export function HistoryPicker({ agent, historyPickerIdx, historyRestoringIdx, onClose, onRestore, onHover, t }: HistoryPickerProps) {
  const currentUserTurns = agent?.messages.filter(m => m.role === 'user') || [];
  const userTurns: Array<{ id: string; content: string; timestamp: number }> =
    (agent as any)?.preRestoreUserTurns ?? currentUserTurns;
  const currentTurnCount = currentUserTurns.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">{t('chat.historyPickerTitle')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('chat.historyPickerHint')}</span>
          <button className="btn btn-sm btn-outline" onClick={onClose}>{t('common.cancel')}</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {userTurns.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>{t('chat.noHistory')}</div>
          ) : [...userTurns].reverse().map((msg, ri) => { const i = userTurns.length - 1 - ri; const isCurrentOrBefore = i < currentTurnCount; return (
            <div
              key={msg.id}
              onClick={() => { if (historyRestoringIdx === null) onRestore(i); }}
              style={{
                padding: '10px 16px',
                cursor: historyRestoringIdx !== null ? 'wait' : 'pointer',
                background: i === historyPickerIdx ? 'var(--primary-dim)' : 'transparent',
                color: 'var(--text)',
                opacity: isCurrentOrBefore ? 1 : 0.6,
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={() => onHover(i)}
            >
              <div style={{ fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {historyRestoringIdx === i ? t('chat.rewinding') : `${msg.content.slice(0, 80)}${msg.content.length > 80 ? '…' : ''}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Turn {i + 1} &nbsp;·&nbsp; {new Date(msg.timestamp).toLocaleString()}
                {!isCurrentOrBefore && ' (restored)'}
              </div>
            </div>
          ); })}
        </div>
      </div>
    </div>
  );
}
