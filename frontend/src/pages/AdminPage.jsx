import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchUsers, fetchRoles, updateUserRole, toggleUserActive,
  createRole, updateRole, deleteRole,
} from '../utils/api';

export const ALL_PERMISSIONS = [
  'model-read-all', 'model-write-all', 'model-delete-all', 'model-manage-all',
  'dataset-read-all', 'dataset-write-all', 'dataset-delete-all', 'dataset-manage-all',
  'task-read-all', 'admin-config-read', 'admin-config-write', 'user-manage-all',
];

export const PERM_LABELS = {
  'model-read-all': '模型·读全部',
  'model-write-all': '模型·写全部',
  'model-delete-all': '模型·删全部',
  'model-manage-all': '模型·授权管理',
  'dataset-read-all': '数据集·读全部',
  'dataset-write-all': '数据集·写全部',
  'dataset-delete-all': '数据集·删全部',
  'dataset-manage-all': '数据集·授权管理',
  'task-read-all': '任务·看全部',
  'admin-config-read': '配置·读',
  'admin-config-write': '配置·写',
  'user-manage-all': '用户·管理',
};

function PermissionPicker({ value, onChange }) {
  const toggle = (p) => {
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {ALL_PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={value.includes(p)} onChange={() => toggle(p)} className="accent-teal-600" />
          {PERM_LABELS[p] || p}
        </label>
      ))}
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [u, r] = await Promise.all([fetchUsers(), fetchRoles()]);
    setUsers(u.data || []);
    setRoles(r.data || []);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const changeRole = async (u, roleId) => {
    setBusyId(u.id);
    try { await updateUserRole(u.id, roleId); await load(); }
    finally { setBusyId(null); }
  };

  const toggle = async (u) => {
    setBusyId(u.id);
    try { await toggleUserActive(u.id, !u.isActive); await load(); }
    finally { setBusyId(null); }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
            <th className="px-4 py-3 font-medium">用户</th>
            <th className="px-4 py-3 font-medium">GitHub</th>
            <th className="px-4 py-3 font-medium">角色</th>
            <th className="px-4 py-3 font-medium">状态</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
              <td className="px-4 py-3 flex items-center gap-2">
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-semibold">
                    {(u.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-gray-800 dark:text-gray-200">{u.displayName}</span>
              </td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.githubLogin || '—'}</td>
              <td className="px-4 py-3">
                <select
                  value={u.roleId}
                  disabled={busyId === u.id}
                  onChange={(e) => changeRole(u, parseInt(e.target.value, 10))}
                  className="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-gray-700 dark:text-gray-200"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${u.isActive ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                  {u.isActive ? '正常' : '已停用'}
                </span>
              </td>
              <td className="px-4 py-3">
                {busyId === u.id ? (
                  <Loader2 size={14} className="animate-spin text-gray-400" />
                ) : (
                  <button
                    onClick={() => toggle(u)}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${u.isActive
                      ? 'text-red-500 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/40'
                      : 'text-green-600 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/40'}`}
                  >
                    {u.isActive ? '停用' : '启用'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_ROLE = { name: '', description: '', permissions: [] };

function RoleForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { ...EMPTY_ROLE });
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="角色名"
          className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200"
        />
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="描述（可选）"
          className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200"
        />
      </div>
      <PermissionPicker value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">取消</button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  );
}

function RolesTab() {
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null); // { mode: 'new' } | { mode: 'edit', role } | null

  const load = useCallback(async () => {
    const r = await fetchRoles();
    setRoles(r.data || []);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const save = async (form) => {
    if (editing?.mode === 'edit') await updateRole(editing.role.id, form);
    else await createRole(form);
    setEditing(null);
    await load();
  };

  const remove = async (role) => {
    if (!window.confirm(`确定删除角色「${role.name}」？`)) return;
    try {
      await deleteRole(role.id);
      await load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing({ mode: 'new' })}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700"
        >
          <Plus size={13} /> 新建角色
        </button>
      </div>

      {editing && (
        <RoleForm
          initial={editing.mode === 'edit' ? editing.role : null}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="space-y-2">
        {roles.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{r.name}</span>
              {r.isSystem && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">内置</span>
              )}
              {r.description && <span className="text-xs text-gray-400 truncate">{r.description}</span>}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setEditing({ mode: 'edit', role: r })}
                  disabled={r.isSystem}
                  title={r.isSystem ? '系统角色不可修改' : undefined}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => remove(r)}
                  disabled={r.isSystem}
                  title={r.isSystem ? '系统角色不可删除' : undefined}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {r.permissions.length === 0 && <span className="text-xs text-gray-400">无全局权限（仅管理自己创建的资源）</span>}
              {r.permissions.map((p) => (
                <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                  {PERM_LABELS[p] || p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('users');

  if (!isAdmin) {
    return (
      <div className="py-20 text-center text-sm text-gray-400">无权限访问管理页面</div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">管理</h2>
      <div className="flex gap-1 mb-4">
        {[['users', '用户管理'], ['roles', '角色管理']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === key
              ? 'bg-teal-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}
