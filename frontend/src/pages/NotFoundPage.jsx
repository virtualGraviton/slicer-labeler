import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-teal-600 flex items-center justify-center">
        <Compass size={26} className="text-white" />
      </div>
      <div>
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100">404</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          页面不存在，或已经被移动
        </p>
      </div>
      <Link
        to="/"
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
      >
        <Home size={16} />
        返回模型管理
      </Link>
    </div>
  );
}
