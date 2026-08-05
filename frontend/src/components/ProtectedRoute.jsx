import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getToken } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
