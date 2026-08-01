import { useState, useEffect } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { Sun, Moon, Settings, ChevronRight, Home, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AppLayout() {
  const location = useLocation();
  const isLabelPage = location.pathname.includes('/entries');
  const [dark, setDark] = useState(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem('slicer-labeler.theme');
    return stored === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('slicer-labeler.theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Breadcrumb logic
  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = [];
  if (pathParts.length >= 1 && pathParts[0] === 'models') {
    breadcrumbs.push({ label: '模型管理', to: '/' });
    if (pathParts.length >= 3 && pathParts[1] && pathParts[2] === 'entries') {
      breadcrumbs.push({ label: '数据集', to: `/models/${pathParts[1]}` });
      breadcrumbs.push({ label: '标注' });
    } else if (pathParts.length >= 2 && pathParts[1]) {
      breadcrumbs.push({ label: '数据集列表' });
    }
  } else if (pathParts.length >= 1 && pathParts[0] === 'datasets') {
    breadcrumbs.push({ label: '模型管理', to: '/' });
    breadcrumbs.push({ label: '数据集', to: `/models/${pathParts[1] || ''}` });
    breadcrumbs.push({ label: '标注' });
  } else {
    breadcrumbs.push({ label: '模型管理' });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/20 to-blue-50 dark:from-gray-950 dark:via-teal-950/20 dark:to-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-[100] h-14 border-b border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex items-center px-6 gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center">
            <Database size={14} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Slicer Labeler</span>
        </Link>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 flex-1 min-w-0">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors truncate">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-gray-700 dark:text-gray-300 truncate">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setDark(!dark)}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* popLayout: 旧页面立即脱流，新页面在顶部正常渲染，避免挤压 */}
      <main className={`relative mx-auto px-6 py-6 ${isLabelPage ? 'max-w-screen-2xl' : 'max-w-7xl'}`}>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
