import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Play, Square, Settings, GitMerge, Volume2, ArrowLeft, Check, X, Minus, CheckCheck } from 'lucide-react';

export default function LabelSidebar({
  autoPlayOn,
  onToggleAutoPlay,
  onOpenSettings,
  onBack,
  checkedCount,
  onMergeClick,
  selectAllState = 'none',
  onSelectAll,
  hasEntries = false,
  onSetVerified,
  setVerifiedBusy = false,
  volume,
  onVolumeChange,
  busy = false,
  readOnly = false,
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const trackRef = useRef(null);
  const pct = Math.round(volume * 100);

  const computeVolume = useCallback(
    (e) => {
      const track = trackRef.current;
      if (!track) return volume;
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      return Math.round((x / rect.width) * 100) / 100;
    },
    [volume],
  );

  const handleVolumeMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      onVolumeChange(computeVolume(e));
      const onMove = (ev) => onVolumeChange(computeVolume(ev));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onVolumeChange, computeVolume],
  );

  return (
    <motion.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-48 shrink-0 flex flex-col gap-3 rounded-2xl border border-gray-200 dark:border-gray-700
        bg-white/60 dark:bg-gray-900/50 backdrop-blur-sm p-4 self-start sticky top-[72px]"
    >
      {/* 返回数据集 */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
          text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ArrowLeft size={14} />
        返回数据集
      </button>

      {/* 自动播放 */}
      <button
        onClick={onToggleAutoPlay}
        className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors
          ${autoPlayOn
            ? 'text-white bg-red-600 hover:bg-red-700'
            : 'text-teal-700 bg-teal-50 hover:bg-teal-100 dark:text-teal-300 dark:bg-teal-900/30 dark:hover:bg-teal-900/50'
          }`}
      >
        {autoPlayOn ? <Square size={14} /> : <Play size={14} />}
        {autoPlayOn ? '停止' : '自动播放'}
      </button>

      {/* 设置 */}
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
          text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <Settings size={14} />
        播放设置
      </button>

      {/* 合并 */}
      <button
        onClick={onMergeClick}
        disabled={busy || readOnly || checkedCount < 2}
        title={busy ? '任务进行中，暂不可合并' : (readOnly ? '无写权限，暂不可合并' : undefined)}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
          text-emerald-700 bg-emerald-50 hover:bg-emerald-100
          dark:text-emerald-300 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50
          disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <GitMerge size={14} />
        合并 ({checkedCount})
      </button>

      {/* 全选 / 取消全选本页 */}
      <button
        onClick={onSelectAll}
        disabled={busy || readOnly || !hasEntries}
        title={busy ? '任务进行中，暂不可全选' : (readOnly ? '无写权限，暂不可全选' : undefined)}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
          text-gray-700 bg-gray-50 hover:bg-gray-100
          dark:text-gray-300 dark:bg-gray-800/60 dark:hover:bg-gray-800
          disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {selectAllState === 'all' ? <X size={14} /> : (selectAllState === 'partial' ? <Minus size={14} /> : <Check size={14} />)}
        {selectAllState === 'all' ? '取消选择' : '全选本页'}
      </button>

      {/* 设置标注状态 */}
      <div className="relative">
        <button
          onClick={() => setStatusMenuOpen((v) => !v)}
          disabled={busy || readOnly || checkedCount === 0 || setVerifiedBusy}
          title={busy ? '任务进行中，暂不可标记' : (readOnly ? '无写权限，暂不可标记' : (checkedCount === 0 ? '请先勾选条目' : undefined))}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
            text-teal-700 bg-teal-50 hover:bg-teal-100
            dark:text-teal-300 dark:bg-teal-900/30 dark:hover:bg-teal-900/50
            disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <CheckCheck size={14} />
          设置标注状态 ({checkedCount})
        </button>
        {statusMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
            <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-gray-200 dark:border-gray-700
              bg-white dark:bg-gray-900 shadow-lg p-1">
              <button
                onClick={() => { onSetVerified?.(true); setStatusMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-md
                  text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-900/40 transition-colors"
              >
                <Check size={14} />
                标记已完成
              </button>
              <button
                onClick={() => { onSetVerified?.(false); setStatusMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-md
                  text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={14} />
                标记未完成
              </button>
            </div>
          </>
        )}
      </div>

      {/* 音量 */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <Volume2 size={12} />
          音量 {pct}%
        </div>
        <div
          ref={trackRef}
          onMouseDown={handleVolumeMouseDown}
          className="w-full h-4 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer relative overflow-hidden"
        >
          <div
            className="absolute left-0 top-0 bottom-0 bg-teal-500 dark:bg-teal-600 rounded-l-lg transition-all duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </motion.aside>
  );
}
