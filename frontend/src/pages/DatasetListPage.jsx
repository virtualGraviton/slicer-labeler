import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, Loader2, ExternalLink, Pencil, Trash2, Clock, Upload, Archive, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DatasetFormModal from '../components/dataset/DatasetFormModal';
import ImportModal from '../components/dataset/ImportModal';
import GrantModal from '../components/grants/GrantModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { getModel, fetchDatasets, createDataset, updateDataset, deleteDataset, archiveDataset } from '../utils/api';
import { useTasks } from '../context/TaskContext';

const fadeIn = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } };
const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.2 } };

// 数据集行动画常量，避免重复创建内联对象
const rowAnim = (i) => ({
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  transition: { delay: i * 0.04, duration: 0.25, ease: 'easeOut' },
});

export default function DatasetListPage() {
  const { modelId } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [importTarget, setImportTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [grantTarget, setGrantTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const { isDatasetBusy } = useTasks();

  const loadData = useCallback(async () => {
    try {
      const [md, ds] = await Promise.all([getModel(modelId), fetchDatasets(modelId)]);
      setModel(md);
      setDatasets(Array.isArray(ds) ? ds : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = () => { setEditingDataset(null); setFormOpen(true); };
  const handleEdit = (d) => { setEditingDataset(d); setFormOpen(true); };

  const handleSave = async (data) => {
    try {
      if (editingDataset) await updateDataset(editingDataset.id, data);
      else await createDataset(modelId, data);
      setFormOpen(false); setEditingDataset(null);
      await loadData();
    } catch (err) { alert(err.message || '操作失败'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDataset(deleteTarget.id); setDeleteTarget(null); await loadData(); }
    catch (err) { alert(err.message || '删除失败'); }
  };

  const handleArchive = async () => {
    if (!archiveTarget || archiving) return;
    setArchiving(true);
    try {
      await archiveDataset(archiveTarget.id);
      alert('归档任务已创建，可在右上角任务列表查看进度');
      setArchiveTarget(null);
    } catch (err) {
      alert(err.message || '归档失败');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div>
      {/* 返回按钮 + 头部始终渲染 */}
      <button onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors mb-4">
        <ArrowLeft size={14} />返回模型管理
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{model?.name || '数据集'}</h1>
          {model?.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{model.description}</p>}
        </div>
        <button onClick={handleCreate}
          disabled={model?.canWrite === false}
          title={model?.canWrite === false ? '无该模型的写权限' : undefined}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl text-white
            bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-teal-600">
          <Plus size={16} />新建数据集
        </button>
      </div>

      {/* popLayout: 退出元素立即脱离布局流，进入元素正常排版不受挤压 */}
      <AnimatePresence mode="popLayout">
        {loading ? (
          <motion.div key="load" {...fadeIn}
            className="flex items-center justify-center min-h-[50vh]">
            <Loader2 size={32} className="animate-spin text-teal-600 dark:text-teal-400" />
          </motion.div>
        ) : datasets.length === 0 ? (
          <motion.div key="empty" {...fadeUp}
            className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4"><Plus size={24} /></div>
            <p className="text-sm">暂无数据集，点击上方按钮创建</p>
          </motion.div>
        ) : (
          <motion.div key="list" layout {...fadeIn}
            className="space-y-3">
            {datasets.map((ds, i) => (
              <motion.div key={ds.id} layout {...rowAnim(i)}
                className="group flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700
                  bg-white/70 dark:bg-gray-900/60 hover:shadow-md hover:border-teal-300/60 dark:hover:border-teal-700/60 transition-all">
                <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center shrink-0">
                  <span className="text-teal-600 dark:text-teal-400 font-semibold text-xs">{ds.name?.charAt(0)?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {ds.name}
                    {isDatasetBusy(ds.id) && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 text-[10px] font-medium">
                        <Loader2 size={9} className="animate-spin" />任务处理中
                      </span>
                    )}
                  </h3>
                  {ds.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{ds.description}</p>}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1"><Clock size={11} />{new Date(ds.created_at).toLocaleDateString('zh-CN')}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => navigate(`/datasets/${ds.id}/entries`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-teal-700
                      bg-teal-50 hover:bg-teal-100 dark:text-teal-300 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 transition-colors">
                    进入标注 <ExternalLink size={12} />
                  </button>
                  {ds.canManage && (
                    <button onClick={() => setGrantTarget(ds)}
                      title="授权"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/40 transition-colors">
                      <Share2 size={14} />
                    </button>
                  )}
                  <button onClick={() => setImportTarget(ds)} disabled={!ds.canWrite || isDatasetBusy(ds.id)}
                    title={!ds.canWrite ? '无写权限，暂不可导入' : (isDatasetBusy(ds.id) ? '任务进行中，暂不可导入' : undefined)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600
                      bg-gray-50 hover:bg-teal-50 hover:text-teal-700 dark:text-gray-300 dark:bg-gray-800/60
                      dark:hover:bg-teal-900/30 dark:hover:text-teal-300 transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:text-gray-600 dark:disabled:hover:bg-gray-800/60 dark:disabled:hover:text-gray-300">
                    <Upload size={12} />导入
                  </button>
                  <button onClick={() => setArchiveTarget(ds)} disabled={!ds.canWrite || isDatasetBusy(ds.id)}
                    title={!ds.canWrite ? '无写权限，暂不可归档' : (isDatasetBusy(ds.id) ? '任务进行中，暂不可归档' : undefined)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600
                      bg-gray-50 hover:bg-teal-50 hover:text-teal-700 dark:text-gray-300 dark:bg-gray-800/60
                      dark:hover:bg-teal-900/30 dark:hover:text-teal-300 transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:text-gray-600 dark:disabled:hover:bg-gray-800/60 dark:disabled:hover:text-gray-300">
                    <Archive size={12} />归档
                  </button>
                  <button onClick={() => handleEdit(ds)} disabled={!ds.canWrite || isDatasetBusy(ds.id)}
                    title={!ds.canWrite ? '无写权限' : (isDatasetBusy(ds.id) ? '任务进行中，暂不可编辑' : undefined)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/40 opacity-0 group-hover:opacity-100 transition-all disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent disabled:opacity-30 disabled:group-hover:opacity-30"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(ds)} disabled={!ds.canDelete || isDatasetBusy(ds.id)}
                    title={!ds.canDelete ? '无删除权限' : (isDatasetBusy(ds.id) ? '任务进行中，暂不可删除' : undefined)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/40 opacity-0 group-hover:opacity-100 transition-all disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent disabled:opacity-30 disabled:group-hover:opacity-30"><Trash2 size={14} /></button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <DatasetFormModal open={formOpen} dataset={editingDataset} onSave={handleSave}
        onClose={() => { setFormOpen(false); setEditingDataset(null); }} />

      <ImportModal open={!!importTarget} dataset={importTarget}
        onClose={() => setImportTarget(null)} />

      <GrantModal open={!!grantTarget} resourceType="dataset" resourceId={grantTarget?.id}
        resourceName={grantTarget?.name} onClose={() => setGrantTarget(null)} />

      <ConfirmDialog open={!!deleteTarget} title="删除数据集"
        message={`确定要删除数据集「${deleteTarget?.name}」吗？该数据集下的所有标注条目将被一并删除。`}
        confirmLabel="确认删除" danger onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      <ConfirmDialog open={!!archiveTarget} title="归档数据集"
        message={`确定要归档数据集「${archiveTarget?.name}」吗？将把所有音频复制到 archived 目录并生成推理机格式的 .list 文件。`}
        confirmLabel={archiving ? '归档中…' : '开始归档'} danger={false}
        onConfirm={handleArchive} onCancel={() => setArchiveTarget(null)} />
    </div>
  );
}
