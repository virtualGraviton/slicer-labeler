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

export async function fetchList() {
  return request('/api/list');
}

export async function saveList(entries) {
  return request('/api/save', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
}

export async function deleteEntry({ deleteEntry, entries }) {
  return request('/api/delete-entry', {
    method: 'POST',
    body: JSON.stringify({ deleteEntry, entries }),
  });
}

export function getAudioUrl(relPath) {
  return `/api/audio?path=${encodeURIComponent(relPath)}`;
}

export async function splitAudio({ audioPath, splitTime, text, splitTextIndex, speaker, language }) {
  return request('/api/split', {
    method: 'POST',
    body: JSON.stringify({ audioPath, splitTime, text, splitTextIndex, speaker, language }),
  });
}

export async function mergeAudio({ entries, mergedText, speaker, language }) {
  return request('/api/merge', {
    method: 'POST',
    body: JSON.stringify({ entries, mergedText, speaker, language }),
  });
}


export async function polishMergeText({ entries, hardMergedText, speaker, language }) {
  return request('/api/merge/polish', {
    method: 'POST',
    body: JSON.stringify({ entries, hardMergedText, speaker, language }),
  });
}
export async function fetchQualityCache() {
  return request('/api/quality/cache');
}

export async function checkQuality({ entry, nextEntry, force = false }) {
  return request('/api/quality/check', {
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
