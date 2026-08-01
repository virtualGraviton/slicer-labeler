import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ModelListPage from './pages/ModelListPage';
import DatasetListPage from './pages/DatasetListPage';
import LabelPage from './pages/LabelPage';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ModelListPage />} />
          <Route path="/models/:modelId" element={<DatasetListPage />} />
          <Route path="/datasets/:datasetId/entries" element={<LabelPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
