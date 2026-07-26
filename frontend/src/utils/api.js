const BASE = '';

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Model APIs ───

export async function fetchModels() {
  return request('/api/models');
}

export async function getModel(id) {
  return request(`/api/models/${id}`);
}

export async function createModel(data) {
  return request('/api/models', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModel(id, data) {
  return request(`/api/models/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteModel(id) {
  return request(`/api/models/${id}`, { method: 'DELETE' });
}

// ─── Dataset APIs ───

export async function fetchDatasets(modelId) {
  return request(`/api/models/${modelId}/datasets`);
}

export async function getDataset(id) {
  return request(`/api/datasets/${id}`);
}

export async function createDataset(modelId, data) {
  return request(`/api/models/${modelId}/datasets`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDataset(id, data) {
  return request(`/api/datasets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDataset(id) {
  return request(`/api/datasets/${id}`, { method: 'DELETE' });
}

// ─── Entry APIs (adapted for new three-layer routing) ───

export async function fetchEntries(datasetId, page = 1, pageSize = 10) {
  return request(`/api/datasets/${datasetId}/entries?page=${page}&page_size=${pageSize}`);
}

export async function saveEntries(datasetId, entries) {
  return request(`/api/datasets/${datasetId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
}

// Legacy wrappers for the label page (App.jsx compatibility)
export async function fetchList() {
  throw new Error('fetchList requires datasetId, use fetchEntries(datasetId, page, pageSize)');
}

export async function saveList(entries) {
  throw new Error('saveList requires datasetId, use saveEntries(datasetId, entries)');
}

export async function deleteEntry(entryId) {
  return request(`/api/entries/${entryId}`, { method: 'DELETE' });
}

// Legacy: deleteEntry with full entries array (App.jsx uses this)
export async function deleteEntryLegacy({ deleteEntry: entry, entries }) {
  // First delete the entry via the new API
  await request(`/api/entries/${entry.id}`, { method: 'DELETE' });
  return { success: true };
}

export function getAudioUrl(relPath, entryId) {
  if (entryId) {
    return `/api/entries/${entryId}/audio`;
  }
  // Fallback for legacy usage
  return `/api/audio?path=${encodeURIComponent(relPath)}`;
}

export async function splitAudio({ audioPath, splitTime, text, splitTextIndex, speaker, language }) {
  // The split endpoint now requires entryId - for label page, we pass via entry context
  // Legacy wrapper: the handler will accept the old format
  return request('/api/entries/split-legacy', {
    method: 'POST',
    body: JSON.stringify({ audioPath, splitTime, text, splitTextIndex, speaker, language }),
  });
}

export async function mergeAudio({ entries, mergedText, speaker, language }) {
  return request('/api/entries/merge', {
    method: 'POST',
    body: JSON.stringify({ entries, mergedText, speaker, language }),
  });
}

export async function polishMergeText({ entries, hardMergedText, speaker, language }) {
  return request('/api/entries/merge/polish', {
    method: 'POST',
    body: JSON.stringify({ entries, hardMergedText, speaker, language }),
  });
}

export async function fetchQualityCache(datasetId) {
  return request(`/api/datasets/${datasetId}/quality/cache`);
}

export async function checkQuality({ entry, nextEntry, force = false }) {
  return request(`/api/entries/${entry.id}/quality/check`, {
    method: 'POST',
    body: JSON.stringify({ entry, nextEntry, force }),
  });
}

export async function updateText(wavPath, text) {
  return request('/api/update-text', {
    method: 'POST',
    body: JSON.stringify({ wavPath, text }),
  });
}
