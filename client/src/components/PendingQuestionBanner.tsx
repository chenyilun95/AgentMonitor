import { useState } from 'react';
import type { PendingQuestionItem } from '@agent-monitor/shared';

interface PendingQuestion {
  id: string;
  toolUseId: string;
  questions: PendingQuestionItem[];
  sourceMessageId: string;
  createdAt: number;
  answeredAt?: number;
}

interface PendingQuestionBannerProps {
  pending: PendingQuestion;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
}

export function PendingQuestionBanner({ pending, onSubmit }: PendingQuestionBannerProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const toggle = (question: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = prev[question] || [];
      if (multi) {
        return {
          ...prev,
          [question]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
        };
      }
      return { ...prev, [question]: [label] };
    });
  };

  const allAnswered = pending.questions.every((q) => {
    const picked = selections[q.question] || [];
    if (picked.includes('__custom__')) return (customAnswers[q.question] || '').trim().length > 0;
    return picked.length > 0;
  });

  const submit = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    const answers: Record<string, string> = {};
    for (const q of pending.questions) {
      const picked = selections[q.question] || [];
      if (picked.includes('__custom__')) {
        answers[q.question] = customAnswers[q.question]?.trim() || '';
      } else {
        answers[q.question] = picked.join(', ');
      }
    }
    try {
      await onSubmit(answers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      padding: 14,
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--accent, #4f8cff)',
      margin: '0 0 8px 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>❓</span> Agent is asking a question (AskUserQuestion)
      </div>
      {pending.questions.map((q, qi) => {
        const picked = selections[q.question] || [];
        const showCustom = picked.includes('__custom__');
        return (
          <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.header && <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{q.header}</div>}
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{q.question}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {q.options.map((opt, oi) => {
                const selected = picked.includes(opt.label);
                return (
                  <button
                    key={oi}
                    onClick={() => toggle(q.question, opt.label, q.multiSelect === true)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: `1px solid ${selected ? 'var(--accent, #4f8cff)' : 'var(--border)'}`,
                      background: selected ? 'var(--accent, #4f8cff)' : 'var(--bg-tertiary)',
                      color: selected ? '#fff' : 'var(--text)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{opt.label}</div>
                    {opt.description && (
                      <div style={{ fontSize: 12, color: selected ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)', marginTop: 2 }}>{opt.description}</div>
                    )}
                  </button>
                );
              })}
              <button
                onClick={() => toggle(q.question, '__custom__', q.multiSelect === true)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `1px solid ${showCustom ? 'var(--accent, #4f8cff)' : 'var(--border)'}`,
                  background: showCustom ? 'var(--accent, #4f8cff)' : 'var(--bg-tertiary)',
                  color: showCustom ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Other (custom answer)
              </button>
              {showCustom && (
                <input
                  type="text"
                  value={customAnswers[q.question] || ''}
                  onChange={(e) => setCustomAnswers((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  placeholder="Type your answer..."
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-sm"
          onClick={submit}
          disabled={!allAnswered || submitting}
          style={{ opacity: !allAnswered || submitting ? 0.5 : 1 }}
        >
          {submitting ? 'Submitting...' : 'Submit answer'}
        </button>
      </div>
    </div>
  );
}
