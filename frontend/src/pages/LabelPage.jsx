import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { checkQuality, deleteEntry as deleteEntryApi, fetchEntries, fetchQualityCache, updateEntry } from '../utils/api';
import ItemRow from '../components/ItemRow';
import SplitModal from '../components/SplitModal';
import MergeModal from '../components/MergeModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import SettingsPanel from '../components/SettingsPanel';
import LabelSidebar from '../components/label/LabelSidebar';

const PAGE_SIZE = 10;

const DEFAULT_SETTINGS = {
  gapSeconds: 2,
  pageGapSeconds: 4,
  mediumRiskPauseSeconds: 10,
  skipLowRisk: false,
};

const PREFERENCES_STORAGE_KEY = 'slicer-labeler.preferences';

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function readStoredPreferences() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeStoredPreferences(nextPreferences) {
  if (typeof window === 'undefined') return;
  try {
    const current = readStoredPreferences();
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...current, ...nextPreferences })
    );
  } catch (_) {}
}

function readStoredCurrentPage() {
  const pageNumber = Number(readStoredPreferences().currentPage);
  if (!Number.isFinite(pageNumber)) return 0;
  return Math.max(0, Math.floor(pageNumber) - 1);
}

function readStoredSettings() {
  const settings = readStoredPreferences().settings || {};
  return {
    gapSeconds: clampNumber(settings.gapSeconds, DEFAULT_SETTINGS.gapSeconds, 0.5, 30),
    pageGapSeconds: clampNumber(settings.pageGapSeconds, DEFAULT_SETTINGS.pageGapSeconds, 1, 30),
    mediumRiskPauseSeconds: clampNumber(settings.mediumRiskPauseSeconds, DEFAULT_SETTINGS.mediumRiskPauseSeconds, 0, 120),
    skipLowRisk: !!(settings.skipLowRisk ?? DEFAULT_SETTINGS.skipLowRisk),
  };
}

function readStoredVolume() {
  const vol = Number(readStoredPreferences().volume);
  if (Number.isFinite(vol) && vol >= 0 && vol <= 1) return vol;
  return 1;
}

function isHighRisk(result) {
  return result?.risk === 'high';
}

function isMediumRisk(result) {
  return result?.risk === 'medium';
}

function isLowRisk(result) {
  return result?.risk === 'low';
}

const RISK_LABEL = { low: '低风险', medium: '中风险', high: '高风险' };

function qualitySignature(entry, nextEntry) {
  return `${entry?.wavPath || ''}\n${entry?.text || ''}\n---NEXT---\n${nextEntry?.wavPath || ''}\n${nextEntry?.text || ''}`;
}

function findQuality(results, wavPath) {
  return (results || []).find((r) => r.wavPath === wavPath);
}

const BTN_SM = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_ACCENT = 'inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--accent)] border border-[color:var(--accent)] shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[color:var(--accent-hover)] hover:shadow-[0_6px_20px_var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_ACCENT_SM = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--accent)] border border-[color:var(--accent)] shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[color:var(--accent-hover)] hover:shadow-[0_6px_20px_var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const TOAST_BG = {
  success: 'bg-[color:var(--success)]',
  error: 'bg-[color:var(--danger)]',
  info: 'bg-[color:var(--accent)]',
};

export default function LabelPage() {
  const { datasetId: datasetIdParam } = useParams();
  const navigate = useNavigate();
  const datasetId = parseInt(datasetIdParam, 10);

  const [entries, setEntries] = useState([]); // sparse cache: loaded pages filled, others undefined
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(readStoredCurrentPage);
  const [checkedIndices, setCheckedIndices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state
  const [splitTarget, setSplitTarget] = useState(null);
  const [mergeTargets, setMergeTargets] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [jumpInput, setJumpInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityResults, setQualityResults] = useState([]);
  const [qualityLoading, setQualityLoading] = useState({});
  const [volume, setVolume] = useState(readStoredVolume);

  // Auto-play state
  const [autoPlayOn, setAutoPlayOn] = useState(false);
  const [settings, setSettings] = useState(readStoredSettings);
  const [highlightIndices, setHighlightIndices] = useState([]); // global indices to highlight
  const [countdownIdx, setCountdownIdx] = useState(-1);      // global index showing countdown
  const [countdownVal, setCountdownVal] = useState(0);       // countdown value in seconds
  const [countdownTotalVal, setCountdownTotalVal] = useState(0);
  const [playSignal, setPlaySignal] = useState({ nonce: 0 });  // { nonce, targetIdx } — unique each play
  const [stopSignal, setStopSignal] = useState({ nonce: 0 });
  const [riskAlert, setRiskAlert] = useState(null);
  const [mediumRiskPrompt, setMediumRiskPrompt] = useState(null);
  const countdownTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const mediumPromptTimerRef = useRef(null);
  const mediumPromptActionRef = useRef(null);
  const mediumPromptSkipRef = useRef(null);
  const appContainerRef = useRef(null);
  const autoPlayEnabledRef = useRef(false);
  const autoPlayIdxRef = useRef(-1);
  const autoPlayGateRef = useRef({});
  const settingsRef = useRef(readStoredSettings());
  settingsRef.current = settings;
  const scheduleNextRef = useRef(() => {});
  const handleQualityCheckRef = useRef(() => {});
  const entriesRef = useRef([]);
  const qualityInflightRef = useRef({});
  const loadedPagesRef = useRef(new Set());
  const dirtyPathsRef = useRef(new Set());
  const saveTimerRef = useRef(null);

  // Load data
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    writeStoredPreferences({
      currentPage: currentPage + 1,
      settings,
      volume,
    });
  }, [currentPage, settings, volume]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageEntries = (entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) || []).filter(Boolean);

  const loadPage = useCallback(async (page) => {
    const [data, qualityData] = await Promise.all([
      fetchEntries(datasetId, page + 1, PAGE_SIZE),
      fetchQualityCache(datasetId, page + 1, PAGE_SIZE).catch(() => null),
    ]);
    setEntries((prev) => {
      const next = prev.slice();
      (data.data || []).forEach((entry, i) => {
        next[page * PAGE_SIZE + i] = entry;
      });
      return next;
    });
    if (typeof data.total === 'number') setTotal(data.total);
    setQualityResults((prev) => {
      const known = new Set(prev.map((r) => r.wavPath));
      const incoming = (qualityData?.data || []).filter((r) => r.wavPath && !known.has(r.wavPath));
      return incoming.length ? [...prev, ...incoming] : prev;
    });
    loadedPagesRef.current.add(page);
    return data;
  }, [datasetId]);

  const ensurePageLoaded = useCallback(async (page) => {
    if (loadedPagesRef.current.has(page)) return;
    await loadPage(page);
  }, [loadPage]);

  const goToPage = useCallback((page) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, page));
    setCurrentPage(clamped);
    setCheckedIndices({});
    ensurePageLoaded(clamped);
  }, [totalPages, ensurePageLoaded]);

  const resetEntriesCache = useCallback(async (page) => {
    loadedPagesRef.current.clear();
    setEntries([]);
    await ensurePageLoaded(page);
  }, [ensurePageLoaded]);

  const loadData = async () => {
    setLoading(true);
    try {
      loadedPagesRef.current.clear();
      setEntries([]);
      setQualityResults([]);
      await loadPage(0);
      setCheckedIndices({});
      setError(null);
    } catch (err) {
      setError('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 0), totalPages - 1));
  }, [total, totalPages]);

  // Toast
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const invalidateQualityForIndices = useCallback((indices, entries = entriesRef.current) => {
    const paths = new Set();
    indices.forEach((idx) => {
      if (idx >= 0 && idx < entries.length && entries[idx]?.wavPath) {
        paths.add(entries[idx].wavPath);
      }
    });
    if (paths.size === 0) return;

    setQualityResults((prev) => prev.filter((r) => !paths.has(r.wavPath)));
  }, []);

  // Save dirty text edits individually (debounced in handleTextChange)
  const flushDirtySaves = useCallback(async () => {
    const dirty = Array.from(dirtyPathsRef.current);
    if (dirty.length === 0) return;
    const entriesSnapshot = entriesRef.current;
    await Promise.all(dirty.map(async (wavPath) => {
      const entry = entriesSnapshot.find((e) => e && e.wavPath === wavPath);
      if (!entry?.id) return;
      try {
        await updateEntry(entry.id, entry.text);
        dirtyPathsRef.current.delete(wavPath);
      } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
      }
    }));
  }, [showToast]);

  const handleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return flushDirtySaves();
  }, [flushDirtySaves]);

  // Checkbox
  const handleCheck = useCallback((globalIndex, checked) => {
    setCheckedIndices((prev) => {
      const next = { ...prev };
      if (checked) next[globalIndex] = true;
      else delete next[globalIndex];
      return next;
    });
  }, []);

  const checkedGlobalIndices = Object.keys(checkedIndices).map(Number).sort((a, b) => a - b);

  const highlightItems = useCallback((indices, durationMs = 1400) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    const valid = [...new Set(indices.filter((idx) => idx >= 0))];
    setHighlightIndices(valid);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightIndices([]);
      highlightTimerRef.current = null;
    }, durationMs);
  }, []);

  // Page jump
  const handleJumpPage = useCallback(() => {
    const page = parseInt(jumpInput, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      goToPage(page - 1);
      setJumpInput('');
    }
  }, [goToPage, jumpInput, totalPages]);

  // ---- Auto-play engine ----
  const clearAutoTimers = useCallback(() => {
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; }
  }, []);

  const clearMediumRiskPrompt = useCallback(() => {
    if (mediumPromptTimerRef.current) {
      clearInterval(mediumPromptTimerRef.current);
      mediumPromptTimerRef.current = null;
    }
    mediumPromptActionRef.current = null;
    mediumPromptSkipRef.current = null;
    setMediumRiskPrompt(null);
  }, []);

  const continueMediumRiskPrompt = useCallback(() => {
    const action = mediumPromptActionRef.current;
    clearMediumRiskPrompt();
    action?.();
  }, [clearMediumRiskPrompt]);

  const skipMediumRiskPrompt = useCallback(() => {
    const action = mediumPromptSkipRef.current || mediumPromptActionRef.current;
    clearMediumRiskPrompt();
    action?.();
  }, [clearMediumRiskPrompt]);

  const stopAutoPlayByUser = useCallback((message = '自动播放已停止') => {
    const stopTarget = autoPlayIdxRef.current;
    setAutoPlayOn(false);
    autoPlayEnabledRef.current = false;
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    clearAutoTimers();
    clearMediumRiskPrompt();
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setHighlightIndices([]);
    setStopSignal({ nonce: Date.now(), targetIdx: stopTarget >= 0 ? stopTarget : null });
    showToast(message, 'info');
  }, [clearAutoTimers, clearMediumRiskPrompt, showToast]);

  // Text change (debounced per-entry auto-save)
  const handleTextChange = useCallback((globalIndex, value) => {
    const current = entriesRef.current;
    if (!current[globalIndex]) return;
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，文本已修改');
    }

    const next = current.slice();
    const entry = { ...next[globalIndex], text: value };
    next[globalIndex] = entry;
    entriesRef.current = next;
    setEntries(next);
    invalidateQualityForIndices([globalIndex - 1, globalIndex]);
    dirtyPathsRef.current.add(entry.wavPath);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushDirtySaves();
    }, 800);
  }, [invalidateQualityForIndices, stopAutoPlayByUser, flushDirtySaves]);

  const scrollToItem = useCallback((globalIdx) => {
    const page = Math.floor(globalIdx / PAGE_SIZE);
    if (page !== currentPage) {
      setCurrentPage(page);
      ensurePageLoaded(page);
      // Need to scroll after page renders
      setTimeout(() => {
        const rows = document.querySelectorAll('.item-row');
        const targetRow = Array.from(rows).find((r) => {
          const idx = r.closest('[data-global-idx]');
          return idx && parseInt(idx.dataset.globalIdx) === globalIdx;
        });
        // Fallback: find by index within page
        if (!targetRow) {
          const localIdx = globalIdx % PAGE_SIZE;
          if (rows[localIdx]) {
            rows[localIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    } else {
      const rows = document.querySelectorAll('.item-row');
      const localIdx = globalIdx % PAGE_SIZE;
      if (rows[localIdx]) {
        rows[localIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentPage, ensurePageLoaded]);

  const focusItemsAfterListChange = useCallback((indices, scrollIndex = indices[0], durationMs = 1800) => {
    const valid = [...new Set(indices.filter((idx) => idx >= 0))];
    if (valid.length === 0 || scrollIndex == null || scrollIndex < 0) return;

    const targetPage = Math.floor(scrollIndex / PAGE_SIZE);
    setCurrentPage(targetPage);
    ensurePageLoaded(targetPage);
    setTimeout(() => {
      highlightItems(valid, durationMs);
      const rows = document.querySelectorAll('.item-row');
      const targetRow = Array.from(rows).find((row) => (
        Number(row.dataset.globalIdx) === scrollIndex
      ));
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  }, [ensurePageLoaded, highlightItems]);

  const getGapAfterIndex = useCallback((globalIndex) => {
    const nextIdx = globalIndex + 1;
    const currentPageEnd = (Math.floor(globalIndex / PAGE_SIZE) + 1) * PAGE_SIZE - 1;
    const isLastOnPage = globalIndex >= currentPageEnd || nextIdx >= total;
    return isLastOnPage ? settings.pageGapSeconds : settings.gapSeconds;
  }, [total, settings]);

  const showMediumRiskPrompt = useCallback((globalIndex, result, onContinue, onSkip = null) => {
    if (!autoPlayEnabledRef.current) return;

    clearMediumRiskPrompt();
    mediumPromptActionRef.current = onContinue;
    mediumPromptSkipRef.current = onSkip;
    setRiskAlert({ index: globalIndex, risk: 'medium', nonce: Date.now() });
    highlightItems([globalIndex], 1200);
    scrollToItem(globalIndex);
    showToast('遇到中风险条目，可继续或跳过', 'info');

    const startedAt = Date.now();
    const pauseSeconds = clampNumber(
      settings.mediumRiskPauseSeconds,
      DEFAULT_SETTINGS.mediumRiskPauseSeconds,
      0,
      120
    );
    const pauseMs = pauseSeconds * 1000;
    setMediumRiskPrompt({
      index: globalIndex,
      result,
      secondsLeft: Math.ceil(pauseSeconds),
    });

    if (pauseMs <= 0) {
      const action = mediumPromptActionRef.current;
      clearMediumRiskPrompt();
      action?.();
      return;
    }

    mediumPromptTimerRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const secondsLeft = Math.max(0, Math.ceil((pauseMs - elapsedMs) / 1000));
      setMediumRiskPrompt((prev) => prev ? { ...prev, secondsLeft } : prev);

      if (secondsLeft <= 0) {
        const action = mediumPromptActionRef.current;
        clearMediumRiskPrompt();
        action?.();
      }
    }, 250);
  }, [clearMediumRiskPrompt, highlightItems, scrollToItem, settings.mediumRiskPauseSeconds, showToast]);

  const stopAutoPlayForRisk = useCallback((globalIndex, result) => {
    const risk = result?.risk || 'unknown';
    setAutoPlayOn(false);
    autoPlayEnabledRef.current = false;
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    clearAutoTimers();
    clearMediumRiskPrompt();
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setRiskAlert({ index: globalIndex, risk, nonce: Date.now() });
    highlightItems([globalIndex], 1200);
    setStopSignal({ nonce: Date.now(), targetIdx: null });
    scrollToItem(globalIndex);
    showToast(`自动播放已在${RISK_LABEL[risk] || '风险'}条目停止`, risk === 'high' ? 'error' : 'info');
  }, [clearAutoTimers, clearMediumRiskPrompt, highlightItems, scrollToItem, showToast]);

  const beginAutoPlayItem = useCallback((nextGlobalIdx, gapSec, cachedQuality = null, options = {}) => {
    autoPlayGateRef.current[nextGlobalIdx] = {
      audioDone: false,
      qualityDone: !!cachedQuality,
      qualityResult: cachedQuality || null,
      mediumAcknowledged: !!options.mediumAcknowledged,
    };
    autoPlayIdxRef.current = nextGlobalIdx;
    setCountdownIdx(nextGlobalIdx);
    setCountdownVal(gapSec);
    setCountdownTotalVal(gapSec);

    // Scroll to item
    scrollToItem(nextGlobalIdx);

    const startTime = Date.now();

    clearAutoTimers();
    countdownTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = gapSec - elapsed;
      if (remaining <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdownIdx(-1);
        setCountdownTotalVal(0);
        // Highlight and play — use fresh nonce so WavePlayer can distinguish
        highlightItems([nextGlobalIdx], 800);
        setPlaySignal({ nonce: Date.now(), targetIdx: nextGlobalIdx });
      } else {
        setCountdownVal(remaining);
      }
    }, 50);
  }, [clearAutoTimers, highlightItems, scrollToItem]);

  // Start countdown then play
  const scheduleNext = useCallback(async (nextGlobalIdx, gapSec) => {
    if (!autoPlayEnabledRef.current) return;
    if (nextGlobalIdx >= total) {
      setAutoPlayOn(false);
      autoPlayEnabledRef.current = false;
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
      clearAutoTimers();
      clearMediumRiskPrompt();
      setCountdownIdx(-1);
      setCountdownTotalVal(0);
      showToast('自动播放完成', 'info');
      return;
    }

    // Ensure the target page is loaded before reading the entry (cross-page auto-play).
    if (!entriesRef.current[nextGlobalIdx]) {
      await ensurePageLoaded(Math.floor(nextGlobalIdx / PAGE_SIZE));
      if (!autoPlayEnabledRef.current) return;
    }
    const nextEntry = entriesRef.current[nextGlobalIdx];
    if (!nextEntry) {
      setAutoPlayOn(false);
      autoPlayEnabledRef.current = false;
      showToast('自动播放完成', 'info');
      return;
    }

    const cachedQuality = findQuality(qualityResults, nextEntry.wavPath);
    if (isHighRisk(cachedQuality)) {
      stopAutoPlayForRisk(nextGlobalIdx, cachedQuality);
      return;
    }

    if (isMediumRisk(cachedQuality)) {
      showMediumRiskPrompt(nextGlobalIdx, cachedQuality, () => {
        if (!autoPlayEnabledRef.current) return;
        beginAutoPlayItem(nextGlobalIdx, gapSec, cachedQuality, { mediumAcknowledged: true });
      }, () => {
        if (!autoPlayEnabledRef.current) return;
        setRiskAlert(null);
        scheduleNext(nextGlobalIdx + 1, getGapAfterIndex(nextGlobalIdx));
      });
      return;
    }

    // Skip low-risk items when the setting is enabled and quality is already cached low
    if (settingsRef.current.skipLowRisk && isLowRisk(cachedQuality)) {
      // Visual feedback before skipping: scroll to item and briefly highlight
      autoPlayIdxRef.current = nextGlobalIdx;
      scrollToItem(nextGlobalIdx);
      highlightItems([nextGlobalIdx], 250);
      // Micro-delay so React can flush the scroll/highlight before next item
      countdownTimerRef.current = setTimeout(() => {
        countdownTimerRef.current = null;
        scheduleNextRef.current(nextGlobalIdx + 1, 0);
      }, 80);
      return;
    }

    // When skipLowRisk is on but quality is NOT yet cached, wait for quality
    // check before deciding whether to play or skip (don't start audio yet)
    if (settingsRef.current.skipLowRisk && !cachedQuality) {
      autoPlayIdxRef.current = nextGlobalIdx;
      autoPlayGateRef.current[nextGlobalIdx] = { audioDone: false, qualityDone: false, isPrePlayWait: true };
      handleQualityCheckRef.current(nextGlobalIdx, false, true);
      return;
    }

    beginAutoPlayItem(nextGlobalIdx, gapSec, cachedQuality);
  }, [beginAutoPlayItem, clearAutoTimers, clearMediumRiskPrompt, ensurePageLoaded, getGapAfterIndex, qualityResults, showMediumRiskPrompt, showToast, stopAutoPlayForRisk, total]);
  scheduleNextRef.current = scheduleNext;

  const continueAutoPlayIfReady = useCallback((globalIndex) => {
    if (!autoPlayEnabledRef.current) return;
    if (autoPlayIdxRef.current !== globalIndex) return;

    const gate = autoPlayGateRef.current[globalIndex];
    if (!gate?.qualityDone) return;

    // Pre-play path: quality came back but audio hasn't started yet
    // (triggered by scheduleNext's skipLowRisk wait-for-quality logic)
    if (!gate.audioDone && gate.isPrePlayWait) {
      const gap = getGapAfterIndex(globalIndex);
      if (settingsRef.current.skipLowRisk && isLowRisk(gate.qualityResult)) {
        // Visual feedback before skipping: ensure scrolled and highlighted
        scrollToItem(globalIndex);
        highlightItems([globalIndex], 250);
        delete autoPlayGateRef.current[globalIndex];
        setTimeout(() => scheduleNextRef.current(globalIndex + 1, 0), 80);
        return;
      }
      // Not low risk or skipLowRisk off → start playing now
      beginAutoPlayItem(globalIndex, gap, gate.qualityResult);
      return;
    }

    // Audio still playing, quality came back during playback — wait for audio
    if (!gate.audioDone) return;

    // Normal path: audio finished, quality done → decide next step
    if (isHighRisk(gate.qualityResult)) {
      stopAutoPlayForRisk(globalIndex, gate.qualityResult);
      return;
    }

    const nextIdx = globalIndex + 1;
    const gap = getGapAfterIndex(globalIndex);

    if (isMediumRisk(gate.qualityResult) && !gate.mediumAcknowledged) {
      showMediumRiskPrompt(globalIndex, gate.qualityResult, () => {
        if (!autoPlayEnabledRef.current) return;
        delete autoPlayGateRef.current[globalIndex];
        scheduleNextRef.current(nextIdx, gap);
      }, () => {
        if (!autoPlayEnabledRef.current) return;
        delete autoPlayGateRef.current[globalIndex];
        setRiskAlert(null);
        scheduleNextRef.current(nextIdx, gap);
      });
      return;
    }

    // Skip low-risk items when quality came back during playback
    if (settingsRef.current.skipLowRisk && isLowRisk(gate.qualityResult)) {
      highlightItems([globalIndex], 200);
      delete autoPlayGateRef.current[globalIndex];
      setTimeout(() => scheduleNextRef.current(nextIdx, 0), 80);
      return;
    }

    delete autoPlayGateRef.current[globalIndex];
    scheduleNextRef.current(nextIdx, gap);
  }, [beginAutoPlayItem, getGapAfterIndex, showMediumRiskPrompt, stopAutoPlayForRisk]);

  // Called when an item's audio ends
  const handleAudioEnded = useCallback((globalIndex) => {
    if (!autoPlayEnabledRef.current) return;
    const gate = autoPlayGateRef.current[globalIndex] || {};
    autoPlayGateRef.current[globalIndex] = { ...gate, audioDone: true };
    continueAutoPlayIfReady(globalIndex);
  }, [continueAutoPlayIfReady]);

  const handleQualityCheck = useCallback(async (globalIndex, force = false, silent = false) => {
    const entriesSnapshot = entriesRef.current;
    const entry = entriesSnapshot[globalIndex];
    if (!entry?.wavPath) return;

    const key = entry.wavPath;
    const nextEntry = entriesSnapshot[globalIndex + 1] || null;
    const requestSignature = qualitySignature(entry, nextEntry);

    if (!force && findQuality(qualityResults, key)) {
      if (autoPlayEnabledRef.current && isHighRisk(findQuality(qualityResults, key))) {
        stopAutoPlayForRisk(globalIndex, findQuality(qualityResults, key));
      } else if (autoPlayEnabledRef.current) {
        const gate = autoPlayGateRef.current[globalIndex] || {};
        autoPlayGateRef.current[globalIndex] = {
          ...gate,
          qualityDone: true,
          qualityResult: findQuality(qualityResults, key),
        };
        continueAutoPlayIfReady(globalIndex);
      }
      return;
    }
    if (qualityInflightRef.current[key]) return;

    qualityInflightRef.current[key] = true;
    setQualityLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const { result } = await checkQuality(entry.id, { force });
      const latestEntries = entriesRef.current;
      const latestSignature = qualitySignature(latestEntries[globalIndex], latestEntries[globalIndex + 1] || null);
      if (latestSignature !== requestSignature) return;

      setQualityResults((prev) => [...prev.filter((r) => r.wavPath !== key), { ...result, wavPath: key }]);
      if (autoPlayEnabledRef.current && isHighRisk(result)) {
        stopAutoPlayForRisk(globalIndex, result);
      } else {
        if (autoPlayEnabledRef.current) {
          const gate = autoPlayGateRef.current[globalIndex] || {};
          autoPlayGateRef.current[globalIndex] = {
            ...gate,
            qualityDone: true,
            qualityResult: result,
          };
          continueAutoPlayIfReady(globalIndex);
        }
        if (!silent) {
          showToast(`质量检测完成: ${RISK_LABEL[result.risk] || '风险'}`, result.risk === 'high' ? 'error' : 'success');
        }
      }
    } catch (err) {
      const result = {
        wavPath: key,
        status: 'error',
        risk: 'unknown',
        error: err.message,
        checked_at: new Date().toISOString(),
      };
      setQualityResults((prev) => [...prev.filter((r) => r.wavPath !== key), { ...result, wavPath: key }]);
      if (autoPlayEnabledRef.current) {
        const gate = autoPlayGateRef.current[globalIndex] || {};
        autoPlayGateRef.current[globalIndex] = {
          ...gate,
          qualityDone: true,
          qualityResult: result,
        };
        continueAutoPlayIfReady(globalIndex);
      }
      if (!silent) {
        showToast('质量检测失败: ' + err.message, 'error');
      }
    } finally {
      delete qualityInflightRef.current[key];
      setQualityLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [continueAutoPlayIfReady, qualityResults, showToast, stopAutoPlayForRisk]);
  handleQualityCheckRef.current = handleQualityCheck;

  const handlePlaybackStart = useCallback((globalIndex) => {
    handleQualityCheck(globalIndex, false, true);
  }, [handleQualityCheck]);

  // Toggle auto-play
  const startAutoPlayFrom = useCallback((globalIndex, gapSec = 0.5) => {
    if (globalIndex < 0 || globalIndex >= total) return;

    clearAutoTimers();
    clearMediumRiskPrompt();
    autoPlayGateRef.current = {};
    setStopSignal({ nonce: Date.now(), targetIdx: null });
    setAutoPlayOn(true);
    autoPlayEnabledRef.current = true;
    setRiskAlert(null);
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    scheduleNext(globalIndex, gapSec);
  }, [clearAutoTimers, clearMediumRiskPrompt, scheduleNext]);

  const handleAutoPlayFrom = useCallback((globalIndex) => {
    startAutoPlayFrom(globalIndex, 0.5);
    showToast(`自动播放将从 #${globalIndex + 1} 开始`, 'info');
  }, [showToast, startAutoPlayFrom]);

  const toggleAutoPlay = useCallback(() => {
    if (autoPlayOn) {
      stopAutoPlayByUser();
    } else {
      // Turn on - start from first item on current page
      const startIdx = currentPage * PAGE_SIZE;
      startAutoPlayFrom(startIdx, 0.5);
      showToast('自动播放已开启', 'info');
    }
  }, [autoPlayOn, currentPage, showToast, startAutoPlayFrom, stopAutoPlayByUser]);

  const handleVolumeChange = useCallback((value) => {
    setVolume(clampNumber(value, 1, 0, 1));
  }, []);

  // Cleanup auto-play on unmount
  useEffect(() => {
    return () => {
      clearAutoTimers();
      clearMediumRiskPrompt();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      autoPlayEnabledRef.current = false;
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
    };
  }, [clearAutoTimers, clearMediumRiskPrompt]);

  // Split
  const handleSplitClick = useCallback((globalIndex) => {
    if (!entriesRef.current[globalIndex]) return;
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在切分条目');
    }
    setSplitTarget({ entry: entriesRef.current[globalIndex], globalIndex });
  }, [stopAutoPlayByUser]);

  const handleSplitComplete = useCallback(async (globalIndex, first, second, newTotal) => {
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在切分条目');
    }
    setCheckedIndices({});
    setRiskAlert(null);
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    if (typeof newTotal === 'number') setTotal(newTotal);
    setQualityResults((prev) => {
      const removeKeys = new Set([first.wavPath, second.wavPath]);
      [globalIndex - 1, globalIndex, globalIndex + 1].forEach((idx) => {
        if (entriesRef.current[idx]?.wavPath) removeKeys.add(entriesRef.current[idx].wavPath);
      });
      return prev.filter((r) => !removeKeys.has(r.wavPath));
    });
    await resetEntriesCache(currentPage);
    focusItemsAfterListChange([globalIndex, globalIndex + 1], globalIndex);
  }, [currentPage, focusItemsAfterListChange, resetEntriesCache, stopAutoPlayByUser]);

  // Merge
  const handleMergeClick = useCallback(() => {
    if (checkedGlobalIndices.length < 2) {
      showToast('请至少选中 2 个条目进行合并', 'error');
      return;
    }
    for (let i = 1; i < checkedGlobalIndices.length; i++) {
      if (checkedGlobalIndices[i] !== checkedGlobalIndices[i - 1] + 1) {
        showToast('只能合并相邻的条目', 'error');
        return;
      }
    }
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在合并条目');
    }
    const entries = checkedGlobalIndices.map((i) => entriesRef.current[i]);
    setMergeTargets({ entries, globalIndices: checkedGlobalIndices });
  }, [checkedGlobalIndices, showToast, stopAutoPlayByUser]);

  const handleMergeComplete = useCallback(async (globalIndices, merged, newTotal) => {
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在合并条目');
    }
    const sorted = [...globalIndices].sort((a, b) => a - b);
    const firstIdx = sorted[0];
    setCheckedIndices({});
    setRiskAlert(null);
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    if (typeof newTotal === 'number') setTotal(newTotal);
    setQualityResults((prev) => {
      const removeKeys = new Set([merged.wavPath]);
      sorted.forEach((idx) => {
        if (entriesRef.current[idx]?.wavPath) removeKeys.add(entriesRef.current[idx].wavPath);
      });
      [firstIdx - 1, firstIdx].forEach((idx) => {
        if (entriesRef.current[idx]?.wavPath) removeKeys.add(entriesRef.current[idx].wavPath);
      });
      return prev.filter((r) => !removeKeys.has(r.wavPath));
    });
    await resetEntriesCache(currentPage);
    focusItemsAfterListChange([firstIdx], firstIdx);
  }, [currentPage, focusItemsAfterListChange, resetEntriesCache, stopAutoPlayByUser]);

  // Delete
  const handleDeleteClick = useCallback((globalIndex) => {
    const entry = entriesRef.current[globalIndex];
    if (!entry) return;
    setDeleteTarget({ entry, globalIndex });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget?.entry || deleteLoading) return;

    const deleteEntry = deleteTarget.entry;
    const deleteIndex = entriesRef.current.findIndex((e) => e && e.wavPath === deleteEntry.wavPath);
    if (deleteIndex < 0) {
      showToast('删除失败: 条目已不存在', 'error');
      setDeleteTarget(null);
      return;
    }

    setDeleteLoading(true);
    try {
      if (autoPlayEnabledRef.current) {
        stopAutoPlayByUser('自动播放已暂停，正在删除条目');
      } else {
        setStopSignal({ nonce: Date.now(), targetIdx: deleteIndex });
      }

      await deleteEntryApi(deleteEntry.id);

      dirtyPathsRef.current.delete(deleteEntry.wavPath);
      setCheckedIndices({});
      setRiskAlert(null);
      setHighlightIndices([]);
      setCountdownIdx(-1);
      setCountdownVal(0);
      setCountdownTotalVal(0);
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
      setTotal((t) => Math.max(0, t - 1));
      setQualityResults((prev) => {
        const removeKeys = new Set([deleteEntry.wavPath]);
        if (entriesRef.current[deleteIndex - 1]?.wavPath) removeKeys.add(entriesRef.current[deleteIndex - 1].wavPath);
        return prev.filter((r) => !removeKeys.has(r.wavPath));
      });

      setDeleteTarget(null);
      showToast(`已删除条目 #${deleteIndex + 1}`, 'success');
      await resetEntriesCache(currentPage);
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  }, [currentPage, deleteLoading, deleteTarget, resetEntriesCache, showToast, stopAutoPlayByUser]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-6 min-h-screen">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-[color:var(--text-secondary)]">
          <div className="w-10 h-10 border-[3px] border-[color:var(--card-border)] border-t-[color:var(--accent)] rounded-full animate-spin" />
          <span>加载数据中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-6 min-h-screen">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-[color:var(--text-secondary)]">
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <span style={{ color: 'var(--danger)' }}>{error}</span>
          <button className={BTN_ACCENT} onClick={loadData}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Back button */}
      <button
        onClick={() => navigate(`/models/${datasetId ? '..' : '/'}`)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 dark:text-gray-400 dark:hover:text-teal-400 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        返回数据集
      </button>

      <div className="flex gap-0 min-h-[calc(100vh-56px)]" ref={appContainerRef}>
      {/* Left sidebar */}
      <div className="p-4">
        <LabelSidebar
          autoPlayOn={autoPlayOn}
          onToggleAutoPlay={toggleAutoPlay}
          onOpenSettings={() => setSettingsOpen(true)}
          checkedCount={checkedGlobalIndices.length}
          onMergeClick={handleMergeClick}
          volume={volume}
          onVolumeChange={handleVolumeChange}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 p-4">
        {mediumRiskPrompt && (
        <div className="flex items-center justify-between gap-4 sticky top-[70px] z-[95] mb-4 px-3.5 py-2.5 rounded-lg border border-[rgba(217,119,6,0.34)] bg-[rgba(254,240,138,0.92)] text-[#78350f] shadow-[0_8px_22px_rgba(217,119,6,0.12)] backdrop-blur dark:bg-[rgba(113,63,18,0.92)] dark:text-[#fde68a] max-[860px]:flex-col max-[860px]:items-stretch animate-[fadeIn_0.3s_ease]">
          <div className="flex flex-col gap-0.5 min-w-0 text-[13px]">
            <strong>中风险条目 #{mediumRiskPrompt.index + 1}</strong>
            <span className="text-[#92400e] dark:text-[#fcd34d] overflow-hidden text-ellipsis whitespace-nowrap max-[860px]:whitespace-normal">{mediumRiskPrompt.result?.summary || '该条目存在一定不匹配风险，请决定是否继续自动播放。'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="min-w-[82px] text-xs text-[#92400e] dark:text-[#fcd34d] tabular-nums">{mediumRiskPrompt.secondsLeft}s 后继续</span>
            <button className={BTN_SM} onClick={() => stopAutoPlayByUser('自动播放已在中风险条目停止')}>
              停止
            </button>
            <button className={BTN_SM} onClick={skipMediumRiskPrompt}>
              跳过此条
            </button>
            <button className={BTN_ACCENT_SM} onClick={continueMediumRiskPrompt}>
              继续
            </button>
          </div>
        </div>
      )}

      {/* Pagination top */}
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
          <button
            className={BTN_SM}
            onClick={() => goToPage(0)}
            disabled={currentPage === 0}
          >
            {'<<'}
          </button>
          <button
            className={BTN_SM}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            {'<'}
          </button>
          <span className="min-w-[100px] text-center">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            className={BTN_SM}
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
          >
            {'>'}
          </button>
          <button
            className={BTN_SM}
            onClick={() => setCurrentPage(totalPages - 1)}
            disabled={currentPage === totalPages - 1}
          >
            {'>>'}
          </button>
          <input
            type="number"
            className="page-jump-input"
            placeholder="页"
            min="1"
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJumpPage()}
            style={{
              width: 50,
              background: 'var(--input-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              padding: '4px 8px',
              fontSize: 13,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <button className={BTN_SM} onClick={handleJumpPage}>跳转</button>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 16 }}>
          共 {total} 条
        </span>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-[10px] mb-6">
        {pageEntries.map((entry, i) => {
          const globalIdx = currentPage * PAGE_SIZE + i;
          return (
            <ItemRow
              key={entry.wavPath || globalIdx}
              entry={entry}
              index={globalIdx}
              checked={!!checkedIndices[globalIdx]}
              onCheck={handleCheck}
              onTextChange={handleTextChange}
              onSplitClick={handleSplitClick}
              onAudioEnded={handleAudioEnded}
              onPlaybackStart={handlePlaybackStart}
              onQualityCheck={handleQualityCheck}
              onAutoPlayFrom={handleAutoPlayFrom}
              onDeleteClick={handleDeleteClick}
              playSignal={playSignal}
              stopSignal={stopSignal}
              highlight={highlightIndices.includes(globalIdx)}
              riskAlert={riskAlert?.index === globalIdx}
              showCountdown={countdownIdx === globalIdx}
              preferPopoverBelow={i < 2}
              countdownSeconds={countdownIdx === globalIdx ? countdownVal : null}
              countdownTotalSeconds={countdownIdx === globalIdx ? countdownTotalVal : null}
              qualityResult={findQuality(qualityResults, entry.wavPath)}
              qualityLoading={!!qualityLoading[entry.wavPath]}
              volume={volume}
            />
          );
        })}
      </div>

      {/* Pagination bottom */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
          <button
            className={BTN_SM}
            onClick={() => goToPage(0)}
            disabled={currentPage === 0}
          >
            {'<<'}
          </button>
          <button
            className={BTN_SM}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            {'<'}
          </button>
          <span className="min-w-[100px] text-center">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            className={BTN_SM}
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
          >
            {'>'}
          </button>
          <button
            className={BTN_SM}
            onClick={() => setCurrentPage(totalPages - 1)}
            disabled={currentPage === totalPages - 1}
          >
            {'>>'}
          </button>
          <input
            type="number"
            className="page-jump-input"
            placeholder="页"
            min="1"
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJumpPage()}
            style={{
              width: 50,
              background: 'var(--input-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              padding: '4px 8px',
              fontSize: 13,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <button className={BTN_SM} onClick={handleJumpPage}>跳转</button>
        </div>
      </div>

      {/* Modals */}
      {splitTarget && (
        <SplitModal
          entry={splitTarget.entry}
          globalIndex={splitTarget.globalIndex}
          onClose={() => setSplitTarget(null)}
          onSplitComplete={handleSplitComplete}
          showToast={showToast}
        />
      )}

      {mergeTargets && (
        <MergeModal
          entries={mergeTargets.entries}
          globalIndices={mergeTargets.globalIndices}
          onClose={() => setMergeTargets(null)}
          onMergeComplete={handleMergeComplete}
          showToast={showToast}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          loading={deleteLoading}
          onClose={() => !deleteLoading && setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Volume slider — integrated into sidebar */}

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-[999] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div key={t.id} className={`px-5 py-3 rounded-lg text-sm font-medium text-white animate-[toastIn_0.3s_ease] ${TOAST_BG[t.type] || TOAST_BG.info}`}>
            {t.message}
          </div>
        ))}
      </div>
      </div>
    </div>
    </>
  );
}
