import { motion } from 'framer-motion';
import { Pencil, Trash2, Layers, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ModelCard({ model, index, onEdit, onDelete }) {
  const navigate = useNavigate();
  const createdAt = new Date(model.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25, ease: 'easeOut' }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      onClick={() => navigate(`/models/${model.id}`)}
      className="group relative rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/60
        backdrop-blur-sm shadow-sm hover:shadow-xl hover:border-teal-300/60 dark:hover:border-teal-700/60
        cursor-pointer transition-all duration-300 p-6"
    >
      {/* Hover actions */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(model); }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:text-teal-400 dark:hover:bg-teal-900/40 transition-colors"
          title="编辑"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(model); }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/40 transition-colors"
          title="删除"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Icon */}
      <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center mb-4">
        <Layers size={20} className="text-teal-600 dark:text-teal-400" />
      </div>

      {/* Name */}
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors line-clamp-1">
        {model.name}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4 min-h-[40px]">
        {model.description || '暂无描述'}
      </p>

      {/* Meta */}
      <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500 pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {createdAt}
        </span>
      </div>
    </motion.div>
  );
}
