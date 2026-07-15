import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LABELER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_ROOT = path.resolve(LABELER_ROOT, '..');
const DATA_ROOT = path.resolve(process.env.LABELER_DATA_ROOT || DEFAULT_DATA_ROOT);
const PROJECT_ROOT = DATA_ROOT;
const LIST_PATH = path.resolve(
  process.env.LABELER_LIST_PATH || path.join(DATA_ROOT, 'output', 'asr_opt', 'slicer_opt.list')
);
const DEFAULT_CACHE_PATH = process.env.LABELER_DATA_ROOT
  ? path.join(DATA_ROOT, '.slicer-labeler', 'quality-cache.json')
  : path.join(LABELER_ROOT, 'quality-cache.json');
const QUALITY_CACHE_PATH = path.resolve(
  process.env.LABELER_CACHE_PATH || process.env.QUALITY_CACHE_PATH || DEFAULT_CACHE_PATH
);
const LEGACY_QUALITY_CACHE_PATH = path.join(LABELER_ROOT, 'quality-cache.json');
const QUALITY_CACHE_READ_PATHS = Array.from(
  new Set([QUALITY_CACHE_PATH, LEGACY_QUALITY_CACHE_PATH].map((cachePath) => path.resolve(cachePath)))
);
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function qualityKey(wavPath) {
  const normalized = String(wavPath || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  const outputIndex = parts.map((part) => part.toLowerCase()).lastIndexOf('output');
  if (outputIndex >= 0) {
    return parts.slice(outputIndex).join('/');
  }
  return normalized;
}

function normalizeQualityResult(rawKey, value) {
  const result = value && typeof value === 'object' ? value : {};
  const key = qualityKey(result.wavPath || rawKey);
  return [key, { ...result, wavPath: key }];
}

function normalizeQualityResults(results = {}) {
  return Object.fromEntries(
    Object.entries(results).map(([rawKey, value]) => normalizeQualityResult(rawKey, value))
  );
}

function emptyQualityCache() {
  return { version: 1, results: {} };
}

function readQualityCacheFile(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return {
      version: parsed.version || 1,
      results: normalizeQualityResults(parsed.results || {}),
    };
  } catch (_) {
    return null;
  }
}

function readQualityCache() {
  const merged = emptyQualityCache();
  for (const cachePath of QUALITY_CACHE_READ_PATHS) {
    const parsed = readQualityCacheFile(cachePath);
    if (!parsed) continue;
    merged.version = Math.max(merged.version, parsed.version || 1);
    merged.results = { ...merged.results, ...parsed.results };
  }
  return merged;
}

function qualityCacheExists() {
  return QUALITY_CACHE_READ_PATHS.some((cachePath) => fs.existsSync(cachePath));
}

function writeQualityCache(cache) {
  const normalizedCache = {
    version: cache.version || 1,
    results: normalizeQualityResults(cache.results || {}),
  };
  ensureParentDir(QUALITY_CACHE_PATH);
  fs.writeFileSync(QUALITY_CACHE_PATH, JSON.stringify(normalizedCache, null, 2) + '\n', 'utf-8');
}

function writeListEntries(entries) {
  ensureParentDir(LIST_PATH);
  const lines = entries.map(
    (e) => `${e.wavPath}|${e.speaker}|${e.language}|${e.text}`
  );
  fs.writeFileSync(LIST_PATH, lines.join('\n') + '\n', 'utf-8');
}

function textHash(entry, nextEntry) {
  return crypto
    .createHash('sha1')
    .update(`${qualityKey(entry?.wavPath)}\n${entry?.text || ''}\n---NEXT---\n${qualityKey(nextEntry?.wavPath)}\n${nextEntry?.text || ''}`)
    .digest('hex');
}

function readListEntries() {
  if (!fs.existsSync(LIST_PATH)) return null;

  const content = fs.readFileSync(LIST_PATH, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map((line) => {
    const cleanLine = line.replace(/\r$/, '');
    const parts = cleanLine.split('|');
    return {
      wavPath: (parts[0] || '').replace(/\\/g, '/'),
      speaker: parts[1] || '',
      language: parts[2] || '',
      text: parts.slice(3).join('|').replace(/\r$/, '') || '',
    };
  });
}

function filterValidQualityResults(cache, entries) {
  const results = {};
  if (!entries) return results;

  entries.forEach((entry) => {
    const key = qualityKey(entry.wavPath);
    const cached = cache.results?.[key];
    if (cached?.status === 'ok') {
      results[key] = { ...cached, wavPath: key };
    }
  });
  return results;
}

function resolveProjectPath(relPath) {
  const absPath = path.resolve(PROJECT_ROOT, relPath || '');
  const root = path.resolve(PROJECT_ROOT);
  const lowerAbs = absPath.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lowerAbs !== lowerRoot && !lowerAbs.startsWith(lowerRoot + path.sep.toLowerCase())) {
    throw new Error('Path outside project root');
  }
  return absPath;
}

function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf-8', windowsHide: true });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${output.trim().slice(0, 800)}`);
  }
  return output;
}

function durationFromFilename(absAudioPath) {
  const name = path.basename(absAudioPath);
  const match = name.match(/_(\d{10})_(\d{10})\.wav$/i);
  if (!match) return 0;
  return Math.max(0, (parseInt(match[2], 10) - parseInt(match[1], 10)) / 32000);
}

function getAudioDuration(absAudioPath) {
  try {
    const output = runTool('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absAudioPath,
    ]);
    const duration = parseFloat(output);
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch (_) {}
  return durationFromFilename(absAudioPath);
}

function parseSilenceLog(log, durationSec) {
  const starts = [];
  const ends = [];
  let match;
  const startRe = /silence_start:\s*([\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

  while ((match = startRe.exec(log)) !== null) {
    starts.push(parseFloat(match[1]));
  }
  while ((match = endRe.exec(log)) !== null) {
    ends.push({ end: parseFloat(match[1]), duration: parseFloat(match[2]) });
  }

  let leadingSilenceSec = 0;
  if (starts.length > 0 && starts[0] <= 0.03) {
    const firstEnd = ends.find((e) => e.end >= starts[0]);
    leadingSilenceSec = firstEnd ? firstEnd.duration : Math.max(0, durationSec - starts[0]);
  }

  let trailingSilenceSec = 0;
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1];
    let endAfterLastStart = null;
    for (const item of ends) {
      if (item.end >= lastStart) endAfterLastStart = item;
    }
    if (!endAfterLastStart) {
      trailingSilenceSec = Math.max(0, durationSec - lastStart);
    } else if (durationSec - endAfterLastStart.end <= 0.05) {
      trailingSilenceSec = endAfterLastStart.duration;
    }
  }

  return {
    leadingSilenceMs: Math.round(leadingSilenceSec * 1000),
    trailingSilenceMs: Math.round(trailingSilenceSec * 1000),
    silenceEvents: starts.length,
  };
}

function analyzeTailEnergy(absAudioPath, durationSec) {
  const tailSec = Math.min(0.12, Math.max(0.03, durationSec || 0.12));
  const output = runTool('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-sseof', `-${tailSec.toFixed(3)}`,
    '-i', absAudioPath,
    '-af', 'volumedetect',
    '-f', 'null',
    '-',
  ]);
  const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const maxMatch = output.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  const tailMeanDb = meanMatch ? parseFloat(meanMatch[1]) : null;
  const tailMaxDb = maxMatch ? parseFloat(maxMatch[1]) : null;
  const tailEnergyHigh =
    (tailMeanDb != null && tailMeanDb > -38) ||
    (tailMaxDb != null && tailMaxDb > -16);

  return { tailWindowMs: Math.round(tailSec * 1000), tailMeanDb, tailMaxDb, tailEnergyHigh };
}

function analyzeAudioBoundary(absAudioPath) {
  const durationSec = getAudioDuration(absAudioPath);
  const silenceLog = runTool('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i', absAudioPath,
    '-af', 'silencedetect=noise=-35dB:d=0.02',
    '-f', 'null',
    '-',
  ]);
  const silence = parseSilenceLog(silenceLog, durationSec);
  const tail = analyzeTailEnergy(absAudioPath, durationSec);
  const boundarySuspicious = silence.trailingSilenceMs < 100 && tail.tailEnergyHigh;
  const reasons = [];

  if (boundarySuspicious) {
    reasons.push(`尾部静音 ${silence.trailingSilenceMs}ms 且尾部能量偏高`);
  }
  if (silence.leadingSilenceMs < 40) {
    reasons.push(`句首停顿较短 (${silence.leadingSilenceMs}ms)`);
  }

  return {
    durationSec: Number(durationSec.toFixed(3)),
    ...silence,
    ...tail,
    boundarySuspicious,
    reasons,
  };
}

function readDeepSeekApiKey() {
  return (process.env.DEEPSEEK_API_KEY || '').trim();
}

function postDeepSeekJson(payload, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const target = new URL(DEEPSEEK_API_URL);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`DeepSeek API ${res.statusCode}: ${responseBody.slice(0, 800)}`));
            return;
          }
          try {
            resolve(JSON.parse(responseBody));
          } catch (err) {
            reject(new Error('DeepSeek returned invalid JSON: ' + err.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('DeepSeek request timed out'));
    });
    req.write(body);
    req.end();
  });
}

async function analyzeTextRisk(entry, nextEntry) {
  const apiKey = readDeepSeekApiKey();
  if (!apiKey) {
    throw new Error('未配置 DeepSeek API Key，请在启动服务前设置 DEEPSEEK_API_KEY 环境变量');
  }

  const key = qualityKey(entry.wavPath);
  console.log(`[AI质检请求] ${new Date().toISOString()} | wav: ${key} | speaker: ${entry.speaker} | language: ${entry.language}`);
  console.log(`  current_text: ${entry.text?.slice(0, 200) || ''}`);
  console.log(`  next_text:    ${nextEntry?.text?.slice(0, 200) || '(无)'}`);

  const payload = {
    model: DEEPSEEK_MODEL,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content:
          '你是语音切片数据质检器。判断 current_text 在语法上是否是一个自闭环的完整句（语法可用，不需要语义上的连续性），以及下一句 next_text 是否是本句的语义延续。核心原则：只要本句没有明显的语法残缺（缺少主语、谓语残缺、句子被截断等），就认为语法闭环。语义上即使与下一句强相关，也不视为风险。必须只输出合法 json 对象，不要输出 Markdown。json 字段: grammatically_complete(boolean), current_text_grammar_broken(boolean), semantically_continuous(boolean), confidence(number 0-1), reason(string)。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '判断 current_text 是否在语法上是一个自闭环的完整句。不要太关注语义连续性——即使 next_text 语义上紧接本句，只要本句语法完整，就不算风险。只关注明显的语法残缺（句子截断、缺少主语或谓语等）。also note whether the two sentences are semantically continuous.',
          speaker: entry.speaker,
          language: entry.language,
          current_text: entry.text,
          next_text: nextEntry?.text || '',
        }),
      },
    ],
  };

  const data = await postDeepSeekJson(payload, apiKey);
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(content);
  // New fields: grammatically_complete, current_text_grammar_broken, semantically_continuous
  // Backward-compatible with old: text_complete, current_text_unfinished, should_merge_next
  const grammarBroken = !!parsed.current_text_grammar_broken || parsed.grammatically_complete === false;
  const semanticContinuous = !!parsed.semantically_continuous || !!parsed.should_merge_next || !!parsed.next_is_continuation;
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

  const result = {
    textComplete: parsed.grammatically_complete ?? !grammarBroken,
    currentTextUnfinished: grammarBroken,
    shouldMergeNext: semanticContinuous,
    nextIsContinuation: semanticContinuous,
    confidence,
    reason: String(parsed.reason || '').slice(0, 500),
    raw: parsed,
  };

  console.log(`[AI质检返回] ${new Date().toISOString()} | wav: ${key} | grammatically_complete: ${parsed.grammatically_complete} | grammar_broken: ${grammarBroken} | semantic_continuous: ${semanticContinuous} | confidence: ${confidence}`);
  console.log(`  reason: ${result.reason}`);

  return result;
}


function parseDeepSeekJsonContent(content) {
  const raw = String(content || '').trim();
  if (!raw) throw new Error('DeepSeek returned empty content');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('DeepSeek returned invalid JSON');
  }
}

async function polishMergeTextWithDeepSeek({ entries, hardMergedText, speaker, language }) {
  const apiKey = readDeepSeekApiKey();
  if (!apiKey) {
    throw new Error('未配置 DeepSeek API Key，请在启动服务前设置 DEEPSEEK_API_KEY 环境变量');
  }

  const cleanEntries = (Array.isArray(entries) ? entries : []).map((entry, index) => ({
    index: index + 1,
    speaker: entry?.speaker || speaker || '',
    language: entry?.language || language || '',
    text: String(entry?.text || '').trim(),
  }));

  console.log(`[AI合并润色请求] ${new Date().toISOString()} | entries: ${cleanEntries.length} | speaker: ${speaker} | language: ${language}`);
  console.log(`  hard_merged_text: ${String(hardMergedText || '').slice(0, 300)}`);
  cleanEntries.forEach((ce) => {
    console.log(`  segment[${ce.index}]: ${ce.text?.slice(0, 150) || ''}`);
  });
  const baseText = String(hardMergedText || cleanEntries.map((entry) => entry.text).filter(Boolean).join(' ')).trim();
  if (!baseText) throw new Error('hardMergedText required');

  const payload = {
    model: DEEPSEEK_MODEL,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content:
          '你是语音切片 ASR 文本合并润色助手。你处理相邻切片合并时产生的所有文本衔接问题：句尾和下一句句首重复词、重复短语、重复标点、缺失或多余空格、错误断句、以及 ASR 因切分导致的误识别（如尾音被误补全成短语、首音缺失等）。请从整句的语法通顺和语义连贯角度出发，必要时可以对衔接处前后少量词语进行微调或合并，使合并后的句子符合对应语言的自然表达。但严禁翻译、扩写、改写事实、改变说话风格、或新增原文没有的信息——所有改动必须严格基于两段原文已有的内容，且改动范围应尽量小。必须只输出合法 JSON 对象，不要 Markdown。JSON 字段: polished_text(string), explanation_zh(string)。explanation_zh 必须用中文简要说明做了哪些修改以及修改依据（如"语法不通顺"、"ASR 尾音误补"等）。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '请根据 language 的语法润色 hard_merged_text，使它成为自然连贯的完整句子。重点修复切分导致的：重复词/重复标点、句首句尾衔接不通顺、ASR 尾音或首音误识别（如尾音被误补全为短语）等问题。从整句语法和语义角度判断，必要时可对衔接处做小幅词语调整，但不得新增原文没有的信息。',
          speaker,
          language,
          hard_merged_text: baseText,
          segments: cleanEntries,
        }),
      },
    ],
  };

  const data = await postDeepSeekJson(payload, apiKey);
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseDeepSeekJsonContent(content);
  const polishedText = String(parsed.polished_text || parsed.polishedText || '').trim();
  const explanationZh = String(parsed.explanation_zh || parsed.explanationZh || parsed.reason || '').trim();

  if (!polishedText) throw new Error('DeepSeek did not return polished_text');

  console.log(`[AI合并润色返回] ${new Date().toISOString()} | polished_text: ${polishedText.slice(0, 300)}`);
  console.log(`  explanation: ${explanationZh?.slice(0, 300) || '(无)'}`);

  return {
    polishedText: polishedText.slice(0, 5000),
    explanationZh: (explanationZh || '模型未说明具体修改。').slice(0, 1200),
    model: DEEPSEEK_MODEL,
  };
}

async function runQualityCheck(entry, nextEntry) {
  const absAudioPath = resolveProjectPath(entry.wavPath);
  if (!fs.existsSync(absAudioPath)) throw new Error('Audio file not found');

  const audio = analyzeAudioBoundary(absAudioPath);
  const text = await analyzeTextRisk(entry, nextEntry);
  // Grammar broken = always suspicious. Semantic continuity only counts when tail silence < 100ms.
  const textSuspicious = text.currentTextUnfinished
    || (text.shouldMergeNext && audio.trailingSilenceMs < 100);

  let risk = 'low';
  const reasons = [];
  if (audio.boundarySuspicious && textSuspicious) {
    risk = 'high';
    reasons.push('音频尾部边界可疑(静音<100ms且能量偏高)，且文本存在语法问题');
  } else if (audio.boundarySuspicious || textSuspicious) {
    risk = 'medium';
    const parts = [];
    if (audio.boundarySuspicious) parts.push('音频尾部边界可疑');
    if (text.currentTextUnfinished) parts.push('文本语法不完整');
    if (text.shouldMergeNext && audio.trailingSilenceMs < 100) parts.push('语义连续且静音不足');
    reasons.push(parts.join('，'));
  } else {
    const grammarOk = !text.currentTextUnfinished;
    const hasSemantic = text.shouldMergeNext;
    if (grammarOk && hasSemantic && audio.trailingSilenceMs >= 100) {
      reasons.push('文本语法自闭环，语义虽连续但尾部静音充足(>=100ms)，低风险');
    } else {
      reasons.push('文本完整，尾部边界未见明显截断风险');
    }
  }
  reasons.push(...audio.reasons);
  if (text.reason) reasons.push(text.reason);

  return {
    status: 'ok',
    risk,
    wavPath: qualityKey(entry.wavPath),
    checkedAt: new Date().toISOString(),
    model: DEEPSEEK_MODEL,
    textHash: textHash(entry, nextEntry),
    summary: reasons[0],
    reasons,
    audio,
    text,
  };
}

export function apiMiddleware(req, res, next = () => {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const apiPath = url.pathname;

  function json(data, status = 200) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  function readBody() {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });
  }

  // GET /api/health - deployment sanity check
  if (apiPath === '/api/health' && req.method === 'GET') {
    json({
      ok: true,
      paths: getLabelerPaths(),
      listExists: fs.existsSync(LIST_PATH),
      cacheExists: qualityCacheExists(),
    });
    return;
  }

  // GET /api/quality/cache - load persisted quality results
  if (apiPath === '/api/quality/cache' && req.method === 'GET') {
    const cache = readQualityCache();
    const entries = readListEntries();
    json({ results: filterValidQualityResults(cache, entries) });
    return;
  }

  // POST /api/quality/check - run audio boundary + text continuity risk check
  if (apiPath === '/api/quality/check' && req.method === 'POST') {
    readBody().then(async (body) => {
      let key = '';
      try {
        const { entry, nextEntry, force } = JSON.parse(body);
        if (!entry?.wavPath) {
          json({ error: 'entry.wavPath required' }, 400);
          return;
        }

        key = qualityKey(entry.wavPath);
        const cache = readQualityCache();
        const cached = cache.results?.[key];
        if (!force && cached?.status === 'ok') {
          console.log(`[API质检] ${new Date().toISOString()} | wav: ${key} | 命中缓存, 跳过AI审核`);
          json({ result: { ...cached, wavPath: key, cached: true } });
          return;
        }

        console.log(`[API质检] ${new Date().toISOString()} | wav: ${key} | force: ${!!force} | 开始AI审核...`);
        const result = await runQualityCheck(entry, nextEntry);
        cache.results[key] = { ...result, wavPath: key };
        writeQualityCache(cache);
        console.log(`[API质检] ${new Date().toISOString()} | wav: ${key} | risk: ${result.risk} | 审核完成`);
        json({ result });
      } catch (err) {
        console.log(`[API质检] ${new Date().toISOString()} | wav: ${key || '?'} | 审核失败: ${err.message}`);
        json({ error: err.message }, 500);
      }
    });
    return;
  }

  // GET /api/list - read slicer_opt.list
  if (apiPath === '/api/list' && req.method === 'GET') {
    const entries = readListEntries();
    if (!entries) {
      json({ error: 'slicer_opt.list not found' }, 404);
      return;
    }
    json({ entries, total: entries.length });
    return;
  }

  // POST /api/save - save entire slicer_opt.list
  if (apiPath === '/api/save' && req.method === 'POST') {
    readBody().then((body) => {
      try {
        const { entries } = JSON.parse(body);
        writeListEntries(entries);
        json({ success: true });
      } catch (err) {
        json({ error: err.message }, 500);
      }
    });
    return;
  }

  // POST /api/delete-entry - delete one audio file and persist the updated ASR list
  if (apiPath === '/api/delete-entry' && req.method === 'POST') {
    readBody().then((body) => {
      try {
        const { deleteEntry, entries } = JSON.parse(body);
        if (!deleteEntry?.wavPath) {
          json({ error: 'deleteEntry.wavPath required' }, 400);
          return;
        }
        if (!Array.isArray(entries)) {
          json({ error: 'entries must be an array' }, 400);
          return;
        }

        const key = qualityKey(deleteEntry.wavPath);
        if (entries.some((entry) => qualityKey(entry?.wavPath) === key)) {
          json({ error: 'Updated entries still contain the deleted wavPath' }, 400);
          return;
        }

        const audioPath = resolveProjectPath(deleteEntry.wavPath);
        const originalListContent = fs.existsSync(LIST_PATH)
          ? fs.readFileSync(LIST_PATH, 'utf-8')
          : '';
        writeListEntries(entries);
        const audioExists = fs.existsSync(audioPath);
        if (audioExists) {
          try {
            fs.unlinkSync(audioPath);
          } catch (err) {
            fs.writeFileSync(LIST_PATH, originalListContent, 'utf-8');
            throw err;
          }
        }

        try {
          const cache = readQualityCache();
          if (cache.results?.[key]) {
            delete cache.results[key];
            writeQualityCache(cache);
          }
        } catch (_) {}

        json({ success: true, deleted: key, audioDeleted: audioExists });
      } catch (err) {
        json({ error: err.message }, 500);
      }
    });
    return;
  }

  // GET /api/audio?path=... - serve audio file
  if (apiPath === '/api/audio' && req.method === 'GET') {
    const audioRelPath = url.searchParams.get('path');
    if (!audioRelPath) {
      json({ error: 'path required' }, 400);
      return;
    }
    const audioPath = resolveProjectPath(audioRelPath);
    if (!fs.existsSync(audioPath)) {
      json({ error: 'Audio file not found' }, 404);
      return;
    }
    const stat = fs.statSync(audioPath);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(audioPath).pipe(res);
    return;
  }

  // POST /api/split - split audio with ffmpeg
  if (apiPath === '/api/split' && req.method === 'POST') {
    readBody().then((body) => {
      try {
        const { audioPath, splitTime, text, splitTextIndex, speaker, language } = JSON.parse(body);
        const absAudioPath = resolveProjectPath(audioPath);
        if (!fs.existsSync(absAudioPath)) {
          json({ error: 'Audio file not found' }, 404);
          return;
        }

        const basename = path.basename(audioPath, path.extname(audioPath));
        const match = basename.match(/^vocal_(BV\w+)-p(\d+)_ch(\d+)_(\d{6})_(\d{6})\.m4a_10\.wav_(\d{10})_(\d{10})$/);
        if (!match) {
          json({ error: 'Cannot parse filename: ' + basename }, 400);
          return;
        }
        const prefix = `vocal_${match[1]}-p${match[2]}_ch${match[3]}_${match[4]}_${match[5]}.m4a_10.wav`;
        const originalStart = parseInt(match[6], 10);
        const originalEnd = parseInt(match[7], 10);

        const sampleRate = 32000;
        const splitSamples = Math.round(splitTime * sampleRate);
        const firstStart = originalStart;
        const firstEnd = originalStart + splitSamples;
        const secondStart = originalStart + splitSamples;
        const secondEnd = originalEnd;

        const firstBasename = `${prefix}_${String(firstStart).padStart(10, '0')}_${String(firstEnd).padStart(10, '0')}`;
        const secondBasename = `${prefix}_${String(secondStart).padStart(10, '0')}_${String(secondEnd).padStart(10, '0')}`;

        const outputDir = path.dirname(absAudioPath);
        const firstPath = path.join(outputDir, firstBasename + '.wav');
        const secondPath = path.join(outputDir, secondBasename + '.wav');

        runTool('ffmpeg', ['-y', '-i', absAudioPath, '-t', String(splitTime), '-c', 'copy', firstPath]);
        runTool('ffmpeg', ['-y', '-i', absAudioPath, '-ss', String(splitTime), '-c', 'copy', secondPath]);

        const firstRelPath = path.relative(PROJECT_ROOT, firstPath).replace(/\\/g, '/');
        const secondRelPath = path.relative(PROJECT_ROOT, secondPath).replace(/\\/g, '/');

        const text1 = text.slice(0, splitTextIndex).trim();
        const text2 = text.slice(splitTextIndex).trim();

        json({
          success: true,
          first: { wavPath: firstRelPath, speaker, language, text: text1 },
          second: { wavPath: secondRelPath, speaker, language, text: text2 },
        });
      } catch (err) {
        json({ error: err.message }, 500);
      }
    });
    return;
  }

  // POST /api/merge/polish - polish merged transcript text with DeepSeek
  if (apiPath === '/api/merge/polish' && req.method === 'POST') {
    readBody().then(async (body) => {
      try {
        const { entries: entriesToPolish, hardMergedText, speaker, language } = JSON.parse(body);
        if (!Array.isArray(entriesToPolish) || entriesToPolish.length < 2) {
          json({ error: 'Need at least 2 entries' }, 400);
          return;
        }

        console.log(`[API合并润色] ${new Date().toISOString()} | entries: ${entriesToPolish.length} | 开始AI润色...`);
        const result = await polishMergeTextWithDeepSeek({
          entries: entriesToPolish,
          hardMergedText,
          speaker,
          language,
        });
        console.log(`[API合并润色] ${new Date().toISOString()} | 润色完成`);
        json(result);
      } catch (err) {
        console.log(`[API合并润色] ${new Date().toISOString()} | 润色失败: ${err.message}`);
        json({ error: err.message }, 500);
      }
    });
    return;
  }
  // POST /api/merge - merge audio files
  if (apiPath === '/api/merge' && req.method === 'POST') {
    readBody().then((body) => {
      try {
        const { entries: entriesToMerge, mergedText, speaker, language } = JSON.parse(body);
        if (!entriesToMerge || entriesToMerge.length < 2) {
          json({ error: 'Need at least 2 entries' }, 400);
          return;
        }

        const firstBasename = path.basename(entriesToMerge[0].wavPath, path.extname(entriesToMerge[0].wavPath));
        const lastBasename = path.basename(entriesToMerge[entriesToMerge.length - 1].wavPath, path.extname(entriesToMerge[entriesToMerge.length - 1].wavPath));

        const firstMatch = firstBasename.match(/^vocal_(BV\w+)-p(\d+)_ch(\d+)_(\d{6})_(\d{6})\.m4a_10\.wav_(\d{10})_(\d{10})$/);
        const lastMatch = lastBasename.match(/^vocal_(BV\w+)-p(\d+)_ch(\d+)_(\d{6})_(\d{6})\.m4a_10\.wav_(\d{10})_(\d{10})$/);

        if (!firstMatch || !lastMatch) {
          json({ error: 'Cannot parse filename format' }, 400);
          return;
        }

        const prefix = `vocal_${firstMatch[1]}-p${firstMatch[2]}_ch${firstMatch[3]}_${firstMatch[4]}_${firstMatch[5]}.m4a_10.wav`;
        const mergedBasename = `${prefix}_${firstMatch[6]}_${lastMatch[7]}`;
        const outputDir = path.dirname(resolveProjectPath(entriesToMerge[0].wavPath));
        const outputPath = path.join(outputDir, mergedBasename + '.wav');

        // Create concat file for ffmpeg
        const concatFilePath = path.join(outputDir, '_concat_temp.txt');
        const concatLines = entriesToMerge.map((e) => {
          const absPath = resolveProjectPath(e.wavPath);
          return `file '${absPath.replace(/\\/g, '/')}'`;
        });
        fs.writeFileSync(concatFilePath, concatLines.join('\n'), 'utf-8');

        runTool('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatFilePath, '-c', 'copy', outputPath]);

        fs.unlinkSync(concatFilePath);

        const mergedRelPath = path.relative(PROJECT_ROOT, outputPath).replace(/\\/g, '/');

        json({
          success: true,
          merged: { wavPath: mergedRelPath, speaker, language, text: mergedText },
        });
      } catch (err) {
        json({ error: err.message }, 500);
      }
    });
    return;
  }

  next();
}

export function getLabelerPaths() {
  return {
    labelerRoot: LABELER_ROOT,
    dataRoot: DATA_ROOT,
    listPath: LIST_PATH,
    qualityCachePath: QUALITY_CACHE_PATH,
    qualityCacheReadPaths: QUALITY_CACHE_READ_PATHS,
    deepSeekModel: DEEPSEEK_MODEL,
  };
}
