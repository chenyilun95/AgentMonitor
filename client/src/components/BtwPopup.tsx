import type { RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface BtwState {
  status: 'input' | 'loading' | 'answer';
  question?: string;
  answer?: string;
  error?: string;
}

interface BtwPopupProps {
  btwState: BtwState;
  onClose: () => void;
  onSubmit: (question: string) => void;
  btwInputRef: RefObject<HTMLTextAreaElement | null>;
  t: (key: string) => string;
}

export function BtwPopup({ btwState, onClose, onSubmit, btwInputRef, t }: BtwPopupProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="btw-popup" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}>
        <div className="btw-popup-header">
          <span>/btw</span>
          <button className="btn btn-sm btn-outline" onClick={onClose}>&times;</button>
        </div>
        {btwState.status === 'input' && (
          <div className="btw-popup-body">
            <textarea
              ref={btwInputRef}
              className="btw-input"
              placeholder={t('chat.slashBtw')}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const q = (e.target as HTMLTextAreaElement).value;
                  if (q.trim()) onSubmit(q);
                }
                if (e.key === 'Escape') onClose();
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Enter {t('common.send')} · Esc {t('common.cancel')}</div>
          </div>
        )}
        {btwState.status === 'loading' && (
          <div className="btw-popup-body">
            <div className="btw-question">{btwState.question}</div>
            <div className="btw-loading">{t('common.loading')}</div>
          </div>
        )}
        {btwState.status === 'answer' && (
          <div className="btw-popup-body">
            <div className="btw-question">{btwState.question}</div>
            <div className="btw-answer">
              {btwState.error ? (
                <span style={{ color: 'var(--danger)' }}>{btwState.error}</span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{btwState.answer || ''}</ReactMarkdown>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Esc {t('common.close')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
