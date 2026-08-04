import { useEffect, useRef, useState } from 'react';
import { ListTodo, Upload, Archive, CheckCircle2, XCircle } from 'lucide-react';
import { useTasks } from '../../context/TaskContext';

const STAGE_LABEL = {
  extract: '解压解析',
  upload: '上传对象存储',
  upsert: '写入数据库',
  copy: '复制文件',
  write: '写入 list',
};

const TYPE_LABEL = { import: '导入', archive: '归档' };

function TaskRow({ t }) {
  const stageLabel = STAGE_LABEL[t.stage] || t.stage || '';
  return (
    <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        {t.type === 'import' ? (
          <Upload size={13} className="text-teal-500 shrink-0" />
        ) : (
          <Archive size={13} className="text-blue-500 shrink-0" />
        )}
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
          {TYPE_LABEL[t.type] || t.type} · {t.datasetName}
        </span>
        <span className="ml-auto text-[10px] text-gray-400 shrink-0">
          {new Date(t.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      </div>
      <div className="mt-1.5">
        {t.status === 'processing' && (
          <>
            <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
              <span>{stageLabel}</span>
              <span>{t.progress}%</span>
            </div>
            <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
              <div className="h-1 bg-teal-500 rounded-full transition-all" style={{ width: `${t.progress}%` }} />
            </div>
          </>
        )}
        {t.status === 'done' && (
          <div className="text-[11px] text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle2 size={12} />
            {t.type === 'import' ? `导入 ${t.imported} 条` : `归档 ${t.count} 条`}
          </div>
        )}
        {t.status === 'error' && (
          <div className="text-[11px] text-red-500 flex items-center gap-1 truncate">
            <XCircle size={12} className="shrink-0" />
            <span className="truncate">{t.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TaskListPanel() {
  const { tasks } = useTasks();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const running = tasks.filter((t) => t.status === 'processing').length;

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title="任务列表"
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ListTodo size={16} />
        {running > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-teal-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {running}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl z-[120]">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">任务列表</span>
            {running > 0 && (
              <span className="text-[10px] text-teal-600 dark:text-teal-400">{running} 个进行中</span>
            )}
          </div>
          {tasks.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400 dark:text-gray-500">暂无任务</div>
          ) : (
            tasks.map((t) => <TaskRow key={t.id} t={t} />)
          )}
        </div>
      )}
    </div>
  );
}
