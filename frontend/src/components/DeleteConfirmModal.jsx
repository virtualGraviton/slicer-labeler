import React from 'react';

export default function DeleteConfirmModal({ target, loading, onClose, onConfirm }) {
  if (!target?.entry) return null;

  const { entry, globalIndex } = target;
  const filename = entry.wavPath.split('/').pop() || entry.wavPath;

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
        <h2>确认删除条目 #{globalIndex + 1}</h2>

        <div className="delete-warning">
          这个操作会删除当前条目的 ASR 文本记录，并删除对应的音频文件。删除后不可从界面撤销。
        </div>

        <div className="modal-section">
          <label>音频文件</label>
          <div className="delete-file-name" title={entry.wavPath}>{filename}</div>
        </div>

        <div className="modal-section">
          <label>文本</label>
          <div className="delete-text-preview">{entry.text || '(空文本)'}</div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
