const BASE = '';

// ─── Auth token (localStorage-backed) ───
let _token = localStorage.getItem('token') || '';

export function getToken() {
  return _token;
}

export function setToken(token) {
  _token = token || '';
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

function authHeaders(options) {
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm && !(options.method && options.method !== 'GET' && headers['Content-Type'])) {
    headers['Content-Type'] = 'application/json';
  }
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  return headers;
}

async function request(url, options = {}) {
  const res = await fetch(BASE + url, { ...options, headers: authHeaders(options) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken('');
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

// ─── Auth APIs ───

export async function getMe() {
  return request('/api/auth/me');
}

export async function devLogin() {
  return request('/api/auth/dev-login', { method: 'POST' });
}

// ─── Users / Roles / Grants APIs ───

export async function fetchUsers() {
  return request('/api/users');
}

// Minimal user directory for the grant UI (visible to any authenticated user).
export async function fetchUserDirectory() {
  return request('/api/users/directory');
}

export async function updateUserRole(userId, roleId) {
  return request(`/api/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ roleId }) });
}

export async function toggleUserActive(userId, active) {
  return request(`/api/users/${userId}/active`, { method: 'PUT', body: JSON.stringify({ active }) });
}

export async function fetchRoles() {
  return request('/api/roles');
}

export async function createRole(data) {
  return request('/api/roles', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateRole(roleId, data) {
  return request(`/api/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteRole(roleId) {
  return request(`/api/roles/${roleId}`, { method: 'DELETE' });
}

export async function fetchGrants(resourceType, resourceId) {
  return request(`/api/grants?resourceType=${resourceType}&resourceId=${resourceId}`);
}

export async function addGrant(resourceType, resourceId, userId, permission) {
  return request(`/api/grants?resourceType=${resourceType}&resourceId=${resourceId}`, {
    method: 'POST',
    body: JSON.stringify({ userId, permission }),
  });
}

export async function removeGrant(resourceType, resourceId, userId, permission) {
  return request(`/api/grants?resourceType=${resourceType}&resourceId=${resourceId}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId, permission }),
  });
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

export async function setEntriesVerified(datasetId, entryIds, verified) {
  return request(`/api/datasets/${datasetId}/entries/verified`, {
    method: 'POST',
    body: JSON.stringify({ entryIds, verified }),
  });
}

// ─── Audio ───

export function getAudioUrl(entryId) {
  const q = _token ? `?token=${encodeURIComponent(_token)}` : '';
  return `/api/entries/${entryId}/audio${q}`;
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

// 64MB 分片：单分片远低于 Cloudflare 100MB 请求体上限，同时避开 nginx ingress 32m 限制
const CHUNK_SIZE = 64 * 1024 * 1024;

// 小于该值的文件走单次直传（省一次会话往返）；更大的走分片上传
const DIRECT_UPLOAD_LIMIT = 32 * 1024 * 1024;

// uploadOne uploads a single file via XHR so the browser reports upload
// progress (0-100). extraFields are appended to the multipart form body.
// Resolves to the parsed JSON response.
function uploadOne(url, file, onProgress, extraFields = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${url}`);
    if (_token) xhr.setRequestHeader('Authorization', `Bearer ${_token}`);
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
    for (const [key, value] of Object.entries(extraFields)) {
      form.append(key, value);
    }
    xhr.send(form);
  });
}

// importDataset uploads a zip/tar.gz bundle. Small files go in one request;
// larger files are sliced into CHUNK_SIZE pieces uploaded sequentially, then
// reassembled by the backend (init -> chunk xN -> complete).
export async function importDataset(datasetId, file, onProgress) {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    return uploadOne(`/api/datasets/${datasetId}/import`, file, onProgress);
  }

  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  const init = await request(`/api/datasets/${datasetId}/import/init`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, size: file.size, chunks: chunkCount }),
  });
  const uploadId = init.uploadId;

  let uploaded = 0;
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    await uploadOne(`/api/datasets/${datasetId}/import/chunk`, chunk, (p) => {
      // 单分片进度折算到总体进度（保留当前分片起点）
      const chunkTotal = end - start;
      const chunkLoaded = Math.round((p / 100) * chunkTotal);
      if (onProgress) onProgress(Math.round(((uploaded + chunkLoaded) / file.size) * 100));
    }, { uploadId, index: String(i) });
    uploaded += end - start;
    if (onProgress) onProgress(Math.round((uploaded / file.size) * 100));
  }

  return request(`/api/datasets/${datasetId}/import/complete`, {
    method: 'POST',
    body: JSON.stringify({ uploadId }),
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
// EventSource cannot set custom headers, so the token travels as a query param.
function esUrl(path) {
  const q = _token ? `?token=${encodeURIComponent(_token)}` : '';
  return `${BASE}${path}${q}`;
}

export function subscribeTasks({ onSnapshot, onTaskCreated }) {
  const es = new EventSource(esUrl('/api/tasks/events'));
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
  const es = new EventSource(esUrl(`/api/tasks/${taskId}/stream`));
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
