const BTN = 'inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_DANGER = 'inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--danger)] border border-[color:var(--danger)] shadow-[0_4px_14px_var(--danger-glow)] hover:bg-[color:var(--danger-hover)] hover:shadow-[0_6px_20px_var(--danger-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const MODAL = 'bg-[color:var(--panel-bg)] border border-[color:var(--card-border)] rounded-2xl p-8 max-w-[560px] w-[90vw] max-h-[85vh] overflow-y-auto shadow-[0_25px_60px_rgba(15,23,42,0.22)] animate-[modalIn_0.3s_cubic-bezier(0.34,1.56,0.64,1)]';

export default function DeleteConfirmModal({ target, loading, onClose, onConfirm }) {
  if (!target?.entry) return null;

  const { entry, globalIndex } = target;
  const filename = entry.wavPath.split('/').pop() || entry.wavPath;

  return (
    <div className="fixed inset-0 z-[1000] bg-[rgba(15,23,42,0.45)] backdrop-blur-[6px] flex items-center justify-center animate-[fadeIn_0.2s_ease]" onClick={loading ? undefined : onClose}>
      <div className={MODAL} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[22px] font-semibold mb-6 text-[color:var(--text-primary)]">确认删除条目 #{globalIndex + 1}</h2>

        <div className="mb-4 px-3.5 py-3 rounded-lg border border-[rgba(225,29,72,0.28)] bg-[rgba(255,205,210,0.5)] text-[#9f1239] text-[13px] leading-[1.55] dark:bg-[rgba(159,18,57,0.34)] dark:text-[#fecdd3]">
          这个操作会删除当前条目的 ASR 文本记录，并删除对应的音频文件。删除后不可从界面撤销。
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-[color:var(--text-secondary)] mb-2 uppercase tracking-[0.5px]">音频文件</label>
          <div className="p-2.5 rounded-lg border border-[color:var(--card-border)] bg-[color:var(--input-bg)] text-[13px] leading-[1.45] font-mono break-all" title={entry.wavPath}>{filename}</div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-[color:var(--text-secondary)] mb-2 uppercase tracking-[0.5px]">文本</label>
          <div className="p-2.5 rounded-lg border border-[color:var(--card-border)] bg-[color:var(--input-bg)] text-[13px] leading-[1.45] max-h-[120px] overflow-y-auto">{entry.text || '(空文本)'}</div>
        </div>

        <div className="flex gap-2.5 justify-end mt-6 pt-4 border-t border-[color:var(--card-border)]">
          <button className={BTN} onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className={BTN_DANGER} onClick={onConfirm} disabled={loading}>
            {loading ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
