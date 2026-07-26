import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import ModelCard from '../components/model/ModelCard';
import ModelFormModal from '../components/model/ModelFormModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { fetchModels, createModel, updateModel, deleteModel } from '../utils/api';

export default function ModelListPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadModels = useCallback(async () => {
    try {
      const data = await fetchModels();
      setModels(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load models:', err);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleCreate = () => { setEditingModel(null); setFormOpen(true); };
  const handleEdit = (m) => { setEditingModel(m); setFormOpen(true); };

  const handleSave = async (data) => {
    try {
      if (editingModel) await updateModel(editingModel.id, data);
      else await createModel(data);
      setFormOpen(false);
      setEditingModel(null);
      await loadModels();
    } catch (err) { alert(err.message || '操作失败'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteModel(deleteTarget.id);
      setDeleteTarget(null);
      await loadModels();
    } catch (err) { alert(err.message || '删除失败'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 size={32} className="animate-spin text-teal-600 dark:text-teal-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">模型管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">管理用于训练的数据模型项目</p>
        </div>
        <button onClick={handleCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl text-white
            bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all">
          <Plus size={16} />新建模型
        </button>
      </div>

      {models.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4"><Plus size={24} /></div>
          <p className="text-sm">暂无模型，点击上方按钮创建</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {models.map((m, i) => (
            <ModelCard key={m.id} model={m} index={i} onEdit={handleEdit} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      <ModelFormModal open={formOpen} model={editingModel} onSave={handleSave}
        onClose={() => { setFormOpen(false); setEditingModel(null); }} />

      <ConfirmDialog open={!!deleteTarget} title="删除模型"
        message={`确定要删除模型「${deleteTarget?.name}」吗？该模型下的所有数据集和标注条目将被一并删除。`}
        confirmLabel="确认删除" danger onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
