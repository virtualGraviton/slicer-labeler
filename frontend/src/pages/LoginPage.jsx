import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Github, Loader2 } from 'lucide-react';
import { devLogin } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [devLoading, setDevLoading] = useState(false);
  const [error, setError] = useState('');

  // OAuth callback lands here with ?token=...
  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) return;
    login(token)
      .then(() => navigate('/', { replace: true }))
      .catch(() => {
        setError('登录失败，请重试');
        window.history.replaceState({}, '', '/login');
      });
  }, [searchParams, login, navigate]);

  const handleDevLogin = async () => {
    setDevLoading(true);
    setError('');
    try {
      const res = await devLogin();
      await login(res.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/20 to-blue-50 dark:from-gray-950 dark:via-teal-950/20 dark:to-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl p-8 shadow-2xl">
          <img
            src="/icon-1280-832.svg"
            alt="Slicer Labeler"
            className="w-56 mx-auto rounded-lg mb-4"
          />
          <h1 className="text-center text-lg font-semibold text-gray-900 dark:text-gray-100">Slicer Labeler</h1>
          <p className="text-center text-xs text-gray-500 dark:text-gray-400 mb-6">登录后访问标注工作台</p>

          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs">{error}</div>
          )}

          {authLoading ? (
            <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <a
                href="/api/auth/login"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-gray-900 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white transition-colors"
              >
                <Github size={16} />
                使用 GitHub 登录
              </a>
              {/* 仅开发环境（vite dev）显示；生产构建（vite build）自动隐藏 */}
              {import.meta.env.DEV && (
                <button
                  onClick={handleDevLogin}
                  disabled={devLoading}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-lg border border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-colors disabled:opacity-50"
                >
                  {devLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  开发环境一键登录
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
