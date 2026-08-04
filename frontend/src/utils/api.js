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

export async function updateEntry(entryId, text) {
  return request(`/api/entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
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

// ─── Import / Archive ───

// importDataset uploads a zip/tar.gz bundle via XHR so the browser reports
// upload progress (0-100). Resolves to { jobId } once the server received it.
export function importDataset(datasetId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/datasets/${datasetId}/import`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* keep {} */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || '上传失败'));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

// ─── Tasks ───

// fetchTasks returns all known tasks (newest first), including terminal ones.
export async function fetchTasks() {
  return request('/api/tasks');
}

// subscribeTasks opens the long-lived global task event stream. onSnapshot
// receives the full task list (sent on connect/reconnect); onTaskCreated fires
// for each newly started task. The EventSource auto-reconnects on drop.
export function subscribeTasks({ onSnapshot, onTaskCreated }) {
  const es = new EventSource(`${BASE}/api/tasks/events`);
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === 'snapshot' && onSnapshot) onSnapshot(ev.tasks || []);
    else if (ev.type === 'task_created' && ev.task && onTaskCreated) onTaskCreated(ev.task);
  };
  return es;
}

// subscribeTask consumes the SSE progress stream of a single task (import or
// archive). onEvent fires on each push; the stream closes at terminal states.
export function subscribeTask(taskId, { onEvent, onDone, onError }) {
  const es = new EventSource(`${BASE}/api/tasks/${taskId}/stream`);
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (onEvent) onEvent(ev);
    if (ev.status === 'done') {
      es.close();
      if (onDone) onDone(ev);
    } else if (ev.status === 'error') {
      es.close();
      if (onError) onError(ev.error || '任务失败');
    }
  };
  es.onerror = () => {
    es.close();
    if (onError) onError('进度连接中断');
  };
  return es;
}

// archiveDataset starts an async archive task and resolves to { jobId }.
export async function archiveDataset(datasetId) {
  return request(`/api/datasets/${datasetId}/archive`, { method: 'POST' });
}
