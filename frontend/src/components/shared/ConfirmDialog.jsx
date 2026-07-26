import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, danger }) {
  const snap = useRef({ title: '', message: '', confirmLabel: '确认' });

  // 仅在 open 时快照，退出动画期间 AnimatePresence 仍会用当前 props 重渲染退出中的节点，
  // 此时父组件已将 deleteTarget 置空，必须用快照避免闪现 undefined。
  useEffect(() => {
    if (open) {
      snap.current = { title, message, confirmLabel: confirmLabel || '确认' };
    }
  }, [open, title, message, confirmLabel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
          <motion.div
            className={`relative w-full max-w-md mx-4 rounded-2xl border p-6 shadow-2xl
              ${danger
                ? 'bg-red-50 border-red-200 dark:bg-red-950/60 dark:border-red-800'
                : 'bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700'}`}
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
          >
            <h3 className={`text-lg font-semibold mb-2 ${
              danger ? 'text-red-800 dark:text-red-200' : 'text-gray-900 dark:text-gray-100'
            }`}>
              {snap.current.title}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{snap.current.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600
                  text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
                  danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {snap.current.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
