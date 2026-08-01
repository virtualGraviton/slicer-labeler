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

// ─── Entry APIs ───

export async function fetchEntries(datasetId, page = 1, pageSize = 10) {
  return request(`/api/datasets/${datasetId}/entries?page=${page}&page_size=${pageSize}`);
}

export async function saveEntries(datasetId, entries) {
  return request(`/api/datasets/${datasetId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
}

export async function deleteEntry(entryId) {
  return request(`/api/entries/${entryId}`, { method: 'DELETE' });
}

// ─── Audio ───

export function getAudioUrl(entryId) {
  return `/api/entries/${entryId}/audio`;
}

// ─── Split ───

export async function splitAudio(entryId, { splitTime, text, splitTextIndex, speaker, language }) {
  return request(`/api/entries/${entryId}/split`, {
    method: 'POST',
    body: JSON.stringify({ splitTime, text, splitTextIndex, speaker, language }),
  });
}

// ─── Merge ───

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

// ─── Quality ───

export async function fetchQualityCache(datasetId) {
  return request(`/api/datasets/${datasetId}/quality/cache`);
}

export async function checkQuality(entryId, { force = false } = {}) {
  return request(`/api/entries/${entryId}/quality/check`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}
