import React, { createContext, useContext, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import App from '../App';

// Context to inject datasetId into the existing label page
export const LabelPageContext = createContext(null);
export function useDatasetId() {
  return useContext(LabelPageContext);
}

// Set a module-level variable that api.js can read
let currentDatasetId = null;
export function getCurrentDatasetId() {
  return currentDatasetId;
}

export default function LabelPage() {
  const { datasetId } = useParams();
  const navigate = useNavigate();
  const id = parseInt(datasetId, 10);

  // Update module-level variable so api.js wrappers can read it
  currentDatasetId = id;

  const ctxValue = useMemo(() => ({ datasetId: id }), [id]);

  return (
    <LabelPageContext.Provider value={ctxValue}>
      <button
        onClick={() => navigate(`/models/${id ? '..' : '/'}`)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 dark:text-gray-400 dark:hover:text-teal-400 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        返回数据集
      </button>
      <App datasetId={id} />
    </LabelPageContext.Provider>
  );
}
