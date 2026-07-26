import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ModelListPage from './pages/ModelListPage';
import DatasetListPage from './pages/DatasetListPage';
import LabelPage from './pages/LabelPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ModelListPage />} />
          <Route path="/models/:modelId" element={<DatasetListPage />} />
          <Route path="/datasets/:datasetId/entries" element={<LabelPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
