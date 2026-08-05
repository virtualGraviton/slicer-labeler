import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ModelListPage from './pages/ModelListPage';
import DatasetListPage from './pages/DatasetListPage';
import LabelPage from './pages/LabelPage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import NotFoundPage from './pages/NotFoundPage';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<ModelListPage />} />
            <Route path="/models/:modelId" element={<DatasetListPage />} />
            <Route path="/datasets/:datasetId/entries" element={<LabelPage />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* 兜底：未匹配路由渲染 404（未登录会被 ProtectedRoute 引导到登录页） */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
