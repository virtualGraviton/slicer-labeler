import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Users } from 'lucide-react';
import { fetchUserDirectory, fetchGrants, addGrant, removeGrant } from '../../utils/api';

// Permission options per resource type (matching the backend whitelist).
const PERM_OPTIONS = {
  model: [
    { perm: 'model-read', label: '读' },
    { perm: 'model-write', label: '写' },
    { perm: 'model-delete', label: '删' },
  ],
  dataset: [
    { perm: 'dataset-read', label: '读' },
    { perm: 'dataset-write', label: '写' },
    { perm: 'dataset-delete', label: '删' },
  ],
};

export default function GrantModal({ open, resourceType, resourceId, resourceName, onClose }) {
  const [users, setUsers] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null); // "userId:perm" while a toggle is in flight

  const permOptions = PERM_OPTIONS[resourceType] || [];

  const load = async () => {
    setLoading(true);
    try {
      const [u, g] = await Promise.all([
        fetchUserDirectory(),
        fetchGrants(resourceType, resourceId),
      ]);
      setUsers(u.data || []);
      setGrants(g.data || []);
    } catch (err) {
      alert(err.message || '加载授权信息失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceType, resourceId]);

  // userId -> Set(permission)
  const grantMap = {};
  for (const g of grants) {
    if (!grantMap[g.userId]) grantMap[g.userId] = new Set();
    grantMap[g.userId].add(g.permission);
  }

  const toggle = async (user, perm) => {
    const key = `${user.id}:${perm}`;
    if (savingKey) return;
    setSavingKey(key);
    try {
      const has = grantMap[user.id]?.has(perm);
      if (has) {
        await removeGrant(resourceType, resourceId, user.id, perm);
      } else {
        await addGrant(resourceType, resourceId, user.id, perm);
      }
      await load();
    } catch (err) {
      alert(err.message || '操作失败');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-lg mx-4 rounded-2xl border border-gray-200 dark:border-gray-700
              bg-white dark:bg-gray-900 shadow-2xl p-6"
            initial={{ scale: 0.9, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{ type: 'spring', duration: 0.4 }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Users size={18} className="text-teal-600 dark:text-teal-400" />
                资源授权
              </h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {resourceType === 'model' ? '模型' : '数据集'}「<span className="font-medium text-gray-700 dark:text-gray-200">{resourceName}</span>」 — 为其他用户勾选具体操作权限
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-teal-600 dark:text-teal-400" />
              </div>
            ) : users.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">暂无其他用户</p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto space-y-1">
                {users.map((u) => (
                  <div key={u.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-colors">
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                        {(u.displayName || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{u.displayName}</div>
                      <div className="text-[11px] text-gray-400 truncate">@{u.githubLogin || '—'}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {permOptions.map(({ perm, label }) => {
                        const checked = grantMap[u.id]?.has(perm);
                        const saving = savingKey === `${u.id}:${perm}`;
                        return (
                          <button
                            key={perm}
                            onClick={() => toggle(u, perm)}
                            disabled={!!savingKey && !saving}
                            title={checked ? `取消「${label}」权限` : `授予「${label}」权限`}
                            className={`min-w-[34px] px-2 py-1 text-xs font-medium rounded-lg border transition-colors
                              disabled:opacity-40 disabled:cursor-not-allowed ${
                              checked
                                ? 'text-white bg-teal-600 border-teal-600 hover:bg-teal-700'
                                : 'text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400'
                            }`}
                          >
                            {saving ? <Loader2 size={11} className="animate-spin mx-auto" /> : label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
              >
                完成
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
