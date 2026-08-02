import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { importDataset, subscribeImportJob } from '../../utils/api';

// 处理阶段（与后端 import.go 的 stage 对应）
const STAGES = [
  { key: 'extract', label: '解压解析' },
  { key: 'upload', label: '上传对象存储' },
  { key: 'upsert', label: '写入数据库' },
];

function ProgressBar({ percent }) {
  return (
    <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div
        className="h-full rounded-full bg-teal-500 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export default function ImportModal({ open, dataset, onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | done | error
  const [uploadPercent, setUploadPercent] = useState(0);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const reset = () => {
    setPhase('idle');
    setUploadPercent(0);
    setJob(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleStart = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('请选择 .zip 或 .tar.gz 压缩包');
      return;
    }
    setError('');
    setPhase('uploading');
    setUploadPercent(0);
    try {
      const { jobId } = await importDataset(dataset.id, file, setUploadPercent);
      setPhase('processing');
      subscribeImportJob(jobId, {
        onEvent: (ev) => setJob(ev),
        onDone: (ev) => { setJob(ev); setPhase('done'); },
        onError: (msg) => { setError(msg); setPhase('error'); },
      });
    } catch (err) {
      setError(err.message || '上传失败');
      setPhase('error');
    }
  };

  const currentStage = job?.stage;
  const currentIdx = currentStage ? STAGES.findIndex((s) => s.key === currentStage) : -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={phase === 'idle' ? onClose : undefined} />
          <motion.div
            className="relative w-full max-w-md mx-4 rounded-2xl border border-gray-200 dark:border-gray-700
              bg-white dark:bg-gray-900 shadow-2xl p-6"
            initial={{ scale: 0.9, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{ type: 'spring', duration: 0.4 }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">导入数据集</h3>
              <button
                onClick={onClose}
                disabled={phase === 'uploading' || phase === 'processing'}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {phase === 'idle' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  选择来自推理机的压缩包（.zip / .tar.gz），包含 <span className="font-mono">asr_opt/*.list</span> 与
                  <span className="font-mono"> slicer_opt/*.wav</span>，导入到数据集「{dataset?.name}」。
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed
                  border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 cursor-pointer
                  hover:border-teal-400 dark:hover:border-teal-600 hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                  <Upload size={18} />
                  <span className="text-sm">点击选择压缩包</span>
                  <input ref={fileRef} type="file" accept=".zip,.tar.gz,.tgz" className="hidden"
                    onChange={() => setError('')} />
                </label>
                {error && <p className="text-sm text-red-500 flex items-center gap-1"><AlertCircle size={14} />{error}</p>}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600
                      text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleStart}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                  >
                    开始导入
                  </button>
                </div>
              </div>
            )}

            {phase === 'uploading' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin text-teal-500" />上传中
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 font-mono">{uploadPercent}%</span>
                </div>
                <ProgressBar percent={uploadPercent} />
              </div>
            )}

            {phase === 'processing' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin text-teal-500" />处理中
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 font-mono">{job?.progress ?? 0}%</span>
                </div>
                <ProgressBar percent={job?.progress ?? 0} />
                <div className="space-y-2">
                  {STAGES.map((s, i) => {
                    const active = i === currentIdx;
                    const done = currentIdx > i;
                    return (
                      <div key={s.key} className="flex items-center gap-2 text-sm">
                        {done ? (
                          <CheckCircle2 size={16} className="text-teal-500" />
                        ) : active ? (
                          <Loader2 size={16} className="animate-spin text-teal-500" />
                        ) : (
                          <span className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                        )}
                        <span className={active || done ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {phase === 'done' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400">
                  <CheckCircle2 size={20} /> <span className="text-sm font-medium">导入完成</span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                  <p>成功写入：<span className="font-semibold">{job?.imported ?? 0}</span> 条</p>
                  {(job?.missing?.length ?? 0) > 0 && (
                    <p className="text-amber-600 dark:text-amber-400">
                      缺失音频（list 引用但包内没有）：<span className="font-semibold">{job.missing.length}</span> 条
                      <span className="block text-xs text-gray-400 ml-4 truncate">{job.missing.join('、')}</span>
                    </p>
                  )}
                  {(job?.orphans?.length ?? 0) > 0 && (
                    <p className="text-amber-600 dark:text-amber-400">
                      孤立音频（包内存在但 list 未引用）：<span className="font-semibold">{job.orphans.length}</span> 条
                      <span className="block text-xs text-gray-400 ml-4 truncate">{job.orphans.join('、')}</span>
                    </p>
                  )}
                </div>
                <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertCircle size={20} /> <span className="text-sm font-medium">导入失败</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">{error}</p>
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={reset}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600
                      text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    重试
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
