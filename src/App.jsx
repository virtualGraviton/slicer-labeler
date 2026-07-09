import React, { useState, useEffect, useCallback, useRef } from 'react';
import { checkQuality, deleteEntry as deleteEntryApi, fetchList, fetchQualityCache, saveList } from './utils/api';
import ItemRow from './components/ItemRow';
import SplitModal from './components/SplitModal';
import MergeModal from './components/MergeModal';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import SettingsPanel from './components/SettingsPanel';
import VolumeSlider from './components/VolumeSlider';

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

function readStoredTheme() {
  const theme = readStoredPreferences().theme;
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
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

function riskLabel(risk) {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '风险';
}

function qualitySignature(entry, nextEntry) {
  return `${entry?.wavPath || ''}\n${entry?.text || ''}\n---NEXT---\n${nextEntry?.wavPath || ''}\n${nextEntry?.text || ''}`;
}

export default function App() {
  const [allEntries, setAllEntries] = useState([]);
  const [currentPage, setCurrentPage] = useState(readStoredCurrentPage);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
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
  const [qualityResults, setQualityResults] = useState({});
  const [qualityLoading, setQualityLoading] = useState({});
  const [theme, setTheme] = useState(readStoredTheme);
  const [volume, setVolume] = useState(readStoredVolume);

  // Auto-play state
  const [autoPlayOn, setAutoPlayOn] = useState(false);
  const [settings, setSettings] = useState(readStoredSettings);
  const [autoPlayIdx, setAutoPlayIdx] = useState(-1);       // global index currently playing or waiting
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
  const headerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const autoPlayEnabledRef = useRef(false);
  const autoPlayIdxRef = useRef(-1);
  const autoPlayGateRef = useRef({});
  const settingsRef = useRef(readStoredSettings());
  settingsRef.current = settings;
  const allEntriesRef = useRef([]);
  const qualityInflightRef = useRef({});

  const originalTextsRef = useRef({});

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    allEntriesRef.current = allEntries;
  }, [allEntries]);

  useEffect(() => {
    writeStoredPreferences({
      currentPage: currentPage + 1,
      settings,
      theme,
      volume,
    });
  }, [currentPage, settings, theme, volume]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const container = appContainerRef.current;
    const header = headerRef.current;
    if (!container || !header) return;

    const updateHeaderHeight = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      container.style.setProperty('--sticky-header-height', `${height}px`);
    };

    updateHeaderHeight();
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateHeaderHeight);
      resizeObserver.observe(header);
    }
    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, [loading]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { entries } = await fetchList();
      allEntriesRef.current = entries;
      setAllEntries(entries);
      setCurrentPage((page) => Math.min(Math.max(page, 0), Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1)));
      try {
        const { results } = await fetchQualityCache();
        setQualityResults(results || {});
      } catch (_) {
        setQualityResults({});
      }
      const orig = {};
      entries.forEach((e, i) => { orig[i] = e.text; });
      originalTextsRef.current = orig;
      setHasUnsavedChanges(false);
      setCheckedIndices({});
      setError(null);
    } catch (err) {
      setError('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(allEntries.length / PAGE_SIZE));
  const pageEntries = allEntries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => {
    if (allEntries.length === 0) return;
    setCurrentPage((page) => Math.min(Math.max(page, 0), totalPages - 1));
  }, [allEntries.length, totalPages]);

  // Toast
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const invalidateQualityForIndices = useCallback((indices, entries = allEntriesRef.current) => {
    const paths = new Set();
    indices.forEach((idx) => {
      if (idx >= 0 && idx < entries.length && entries[idx]?.wavPath) {
        paths.add(entries[idx].wavPath);
      }
    });
    if (paths.size === 0) return;

    setQualityResults((prev) => {
      const next = { ...prev };
      paths.forEach((path) => delete next[path]);
      return next;
    });
  }, []);

  // Save
  const handleSave = useCallback(async () => {
    try {
      await saveList(allEntries);
      const orig = {};
      allEntries.forEach((e, i) => { orig[i] = e.text; });
      originalTextsRef.current = orig;
      setHasUnsavedChanges(false);
      showToast('保存成功', 'success');
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
    }
  }, [allEntries, showToast]);

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
      setCurrentPage(page - 1);
      setJumpInput('');
    }
  }, [jumpInput, totalPages]);

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
    setAutoPlayIdx(-1);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setHighlightIndices([]);
    setStopSignal({ nonce: Date.now(), targetIdx: stopTarget >= 0 ? stopTarget : null });
    showToast(message, 'info');
  }, [clearAutoTimers, clearMediumRiskPrompt, showToast]);

  // Text change
  const handleTextChange = useCallback((globalIndex, value) => {
    const current = allEntriesRef.current;
    if (!current[globalIndex]) return;
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，文本已修改');
    }

    const next = [...current];
    next[globalIndex] = { ...next[globalIndex], text: value };
    allEntriesRef.current = next;
    setAllEntries(next);
    invalidateQualityForIndices([globalIndex - 1, globalIndex]);
    setHasUnsavedChanges(true);
  }, [invalidateQualityForIndices, stopAutoPlayByUser]);

  const scrollToItem = useCallback((globalIdx) => {
    const page = Math.floor(globalIdx / PAGE_SIZE);
    if (page !== currentPage) {
      setCurrentPage(page);
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
  }, [currentPage]);

  const focusItemsAfterListChange = useCallback((indices, scrollIndex = indices[0], durationMs = 1800) => {
    const valid = [...new Set(indices.filter((idx) => idx >= 0))];
    if (valid.length === 0 || scrollIndex == null || scrollIndex < 0) return;

    const targetPage = Math.floor(scrollIndex / PAGE_SIZE);
    setCurrentPage(targetPage);
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
  }, [highlightItems]);

  const getGapAfterIndex = useCallback((globalIndex) => {
    const nextIdx = globalIndex + 1;
    const currentPageEnd = (Math.floor(globalIndex / PAGE_SIZE) + 1) * PAGE_SIZE - 1;
    const isLastOnPage = globalIndex >= currentPageEnd || nextIdx >= allEntries.length;
    return isLastOnPage ? settings.pageGapSeconds : settings.gapSeconds;
  }, [allEntries.length, settings]);

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
    setAutoPlayIdx(-1);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setRiskAlert({ index: globalIndex, risk, nonce: Date.now() });
    highlightItems([globalIndex], 1200);
    setStopSignal({ nonce: Date.now(), targetIdx: null });
    scrollToItem(globalIndex);
    showToast(`自动播放已在${riskLabel(risk)}条目停止`, risk === 'high' ? 'error' : 'info');
  }, [clearAutoTimers, clearMediumRiskPrompt, highlightItems, scrollToItem, showToast]);

  const beginAutoPlayItem = useCallback((nextGlobalIdx, gapSec, cachedQuality = null, options = {}) => {
    autoPlayGateRef.current[nextGlobalIdx] = {
      audioDone: false,
      qualityDone: !!cachedQuality,
      qualityResult: cachedQuality || null,
      mediumAcknowledged: !!options.mediumAcknowledged,
    };
    setAutoPlayIdx(nextGlobalIdx);
    autoPlayIdxRef.current = nextGlobalIdx;
    setCountdownIdx(nextGlobalIdx);
    setCountdownVal(gapSec);
    setCountdownTotalVal(gapSec);

    // Scroll to item
    scrollToItem(nextGlobalIdx);

    const startTime = Date.now();
    const totalMs = gapSec * 1000;

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
  const scheduleNext = useCallback((nextGlobalIdx, gapSec) => {
    if (!autoPlayEnabledRef.current) return;
    if (nextGlobalIdx >= allEntries.length) {
      setAutoPlayOn(false);
      autoPlayEnabledRef.current = false;
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
      clearAutoTimers();
      clearMediumRiskPrompt();
      setAutoPlayIdx(-1);
      setCountdownIdx(-1);
      setCountdownTotalVal(0);
      showToast('自动播放完成', 'info');
      return;
    }

    const nextEntry = allEntries[nextGlobalIdx];
    const cachedQuality = nextEntry ? qualityResults[nextEntry.wavPath] : null;
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
      scheduleNext(nextGlobalIdx + 1, 0);
      return;
    }

    beginAutoPlayItem(nextGlobalIdx, gapSec, cachedQuality);
  }, [allEntries, beginAutoPlayItem, clearAutoTimers, clearMediumRiskPrompt, getGapAfterIndex, qualityResults, showMediumRiskPrompt, showToast, stopAutoPlayForRisk]);

  const continueAutoPlayIfReady = useCallback((globalIndex) => {
    if (!autoPlayEnabledRef.current) return;
    if (autoPlayIdxRef.current !== globalIndex) return;

    const gate = autoPlayGateRef.current[globalIndex];
    if (!gate?.audioDone || !gate?.qualityDone) return;

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
        scheduleNext(nextIdx, gap);
      }, () => {
        if (!autoPlayEnabledRef.current) return;
        delete autoPlayGateRef.current[globalIndex];
        setRiskAlert(null);
        scheduleNext(nextIdx, gap);
      });
      return;
    }

    // Skip low-risk items when quality came back during playback
    if (settingsRef.current.skipLowRisk && isLowRisk(gate.qualityResult)) {
      delete autoPlayGateRef.current[globalIndex];
      scheduleNext(nextIdx, 0);
      return;
    }

    delete autoPlayGateRef.current[globalIndex];
    scheduleNext(nextIdx, gap);
  }, [getGapAfterIndex, scheduleNext, showMediumRiskPrompt, stopAutoPlayForRisk]);

  // Called when an item's audio ends
  const handleAudioEnded = useCallback((globalIndex) => {
    if (!autoPlayEnabledRef.current) return;
    const gate = autoPlayGateRef.current[globalIndex] || {};
    autoPlayGateRef.current[globalIndex] = { ...gate, audioDone: true };
    continueAutoPlayIfReady(globalIndex);
  }, [continueAutoPlayIfReady]);

  const handleQualityCheck = useCallback(async (globalIndex, force = false, silent = false) => {
    const entriesSnapshot = allEntriesRef.current;
    const entry = entriesSnapshot[globalIndex];
    if (!entry?.wavPath) return;

    const key = entry.wavPath;
    const nextEntry = entriesSnapshot[globalIndex + 1] || null;
    const requestSignature = qualitySignature(entry, nextEntry);

    if (!force && qualityResults[key]) {
      if (autoPlayEnabledRef.current && isHighRisk(qualityResults[key])) {
        stopAutoPlayForRisk(globalIndex, qualityResults[key]);
      } else if (autoPlayEnabledRef.current) {
        const gate = autoPlayGateRef.current[globalIndex] || {};
        autoPlayGateRef.current[globalIndex] = {
          ...gate,
          qualityDone: true,
          qualityResult: qualityResults[key],
        };
        continueAutoPlayIfReady(globalIndex);
      }
      return;
    }
    if (qualityInflightRef.current[key]) return;

    qualityInflightRef.current[key] = true;
    setQualityLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const { result } = await checkQuality({ entry, nextEntry, force });
      const latestEntries = allEntriesRef.current;
      const latestSignature = qualitySignature(latestEntries[globalIndex], latestEntries[globalIndex + 1] || null);
      if (latestSignature !== requestSignature) return;

      setQualityResults((prev) => ({ ...prev, [key]: result }));
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
          showToast(`质量检测完成: ${result.risk === 'high' ? '高风险' : result.risk === 'medium' ? '中风险' : '低风险'}`, result.risk === 'high' ? 'error' : 'success');
        }
      }
    } catch (err) {
      const result = {
        wavPath: key,
        status: 'error',
        risk: 'unknown',
        error: err.message,
        checkedAt: new Date().toISOString(),
      };
      setQualityResults((prev) => ({ ...prev, [key]: result }));
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

  const handlePlaybackStart = useCallback((globalIndex) => {
    handleQualityCheck(globalIndex, false, true);
  }, [handleQualityCheck]);

  // Toggle auto-play
  const startAutoPlayFrom = useCallback((globalIndex, gapSec = 0.5) => {
    const entries = allEntriesRef.current;
    if (globalIndex < 0 || globalIndex >= entries.length) return;

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
      autoPlayEnabledRef.current = false;
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
    };
  }, [clearAutoTimers, clearMediumRiskPrompt]);

  // Split
  const handleSplitClick = useCallback((globalIndex) => {
    if (!allEntries[globalIndex]) return;
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在切分条目');
    }
    setSplitTarget({ entry: allEntries[globalIndex], globalIndex });
  }, [allEntries, stopAutoPlayByUser]);

  const handleSplitComplete = useCallback((globalIndex, first, second) => {
    const current = allEntriesRef.current;
    const originalEntry = current[globalIndex];
    const next = [...current];
    next[globalIndex] = { ...first };
    next.splice(globalIndex + 1, 0, { ...second });

    allEntriesRef.current = next;
    setAllEntries(next);
    setCheckedIndices({});
    setRiskAlert(null);
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setAutoPlayIdx(-1);
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    focusItemsAfterListChange([globalIndex, globalIndex + 1], globalIndex);
    setQualityResults((prev) => {
      const updated = { ...prev };
      [globalIndex - 1, globalIndex, globalIndex + 1].forEach((idx) => {
        if (current[idx]?.wavPath) delete updated[current[idx].wavPath];
        if (next[idx]?.wavPath) delete updated[next[idx].wavPath];
      });
      if (originalEntry?.wavPath) delete updated[originalEntry.wavPath];
      delete updated[first.wavPath];
      delete updated[second.wavPath];
      return updated;
    });

    saveList(next).then(() => {
        const orig = {};
        next.forEach((e, i) => { orig[i] = e.text; });
        originalTextsRef.current = orig;
        setHasUnsavedChanges(false);
      }).catch((err) => showToast('自动保存失败: ' + err.message, 'error'));
  }, [focusItemsAfterListChange, showToast]);

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
    const entries = checkedGlobalIndices.map((i) => allEntries[i]);
    setMergeTargets({ entries, globalIndices: checkedGlobalIndices });
  }, [checkedGlobalIndices, allEntries, showToast, stopAutoPlayByUser]);

  const handleMergeComplete = useCallback((globalIndices, merged) => {
    const current = allEntriesRef.current;
    const next = [...current];
    const sorted = [...globalIndices].sort((a, b) => a - b);
    const firstIdx = sorted[0];
    next[firstIdx] = { ...merged };
    for (let i = sorted.length - 1; i > 0; i--) {
      next.splice(sorted[i], 1);
    }

    allEntriesRef.current = next;
    setAllEntries(next);
    setCheckedIndices({});
    setCurrentPage((page) => Math.min(Math.max(page, 0), Math.max(0, Math.ceil(next.length / PAGE_SIZE) - 1)));
    setRiskAlert(null);
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setAutoPlayIdx(-1);
    autoPlayIdxRef.current = -1;
    autoPlayGateRef.current = {};
    focusItemsAfterListChange([firstIdx], firstIdx);
    setQualityResults((prev) => {
      const updated = { ...prev };
      sorted.forEach((idx) => {
        if (current[idx]?.wavPath) delete updated[current[idx].wavPath];
      });
      [firstIdx - 1, firstIdx].forEach((idx) => {
        if (current[idx]?.wavPath) delete updated[current[idx].wavPath];
        if (next[idx]?.wavPath) delete updated[next[idx].wavPath];
      });
      delete updated[merged.wavPath];
      return updated;
    });

    saveList(next).then(() => {
        const orig = {};
        next.forEach((e, i) => { orig[i] = e.text; });
        originalTextsRef.current = orig;
        setHasUnsavedChanges(false);
      }).catch((err) => showToast('自动保存失败: ' + err.message, 'error'));
  }, [focusItemsAfterListChange, showToast]);

  // Delete
  const handleDeleteClick = useCallback((globalIndex) => {
    const entry = allEntriesRef.current[globalIndex];
    if (!entry) return;
    setDeleteTarget({ entry, globalIndex });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget?.entry || deleteLoading) return;

    const current = allEntriesRef.current;
    const deleteIndex = current.findIndex((entry) => entry.wavPath === deleteTarget.entry.wavPath);
    if (deleteIndex < 0) {
      showToast('删除失败: 条目已不存在', 'error');
      setDeleteTarget(null);
      return;
    }

    const deleteEntry = current[deleteIndex];
    const next = current.filter((_, index) => index !== deleteIndex);

    setDeleteLoading(true);
    try {
      if (autoPlayEnabledRef.current) {
        stopAutoPlayByUser('自动播放已暂停，正在删除条目');
      } else {
        setStopSignal({ nonce: Date.now(), targetIdx: deleteIndex });
      }

      await deleteEntryApi({ deleteEntry, entries: next });

      allEntriesRef.current = next;
      setAllEntries(next);
      setCheckedIndices({});
      setRiskAlert(null);
      setHighlightIndices([]);
      setCountdownIdx(-1);
      setCountdownVal(0);
      setCountdownTotalVal(0);
      setAutoPlayIdx(-1);
      autoPlayIdxRef.current = -1;
      autoPlayGateRef.current = {};
      setCurrentPage((page) => Math.min(Math.max(page, 0), Math.max(0, Math.ceil(next.length / PAGE_SIZE) - 1)));
      setQualityResults((prev) => {
        const updated = { ...prev };
        if (current[deleteIndex - 1]?.wavPath) delete updated[current[deleteIndex - 1].wavPath];
        delete updated[deleteEntry.wavPath];
        return updated;
      });

      const orig = {};
      next.forEach((entry, index) => { orig[index] = entry.text; });
      originalTextsRef.current = orig;
      setHasUnsavedChanges(false);
      setDeleteTarget(null);
      showToast(`已删除条目 #${deleteIndex + 1}`, 'success');
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteLoading, deleteTarget, showToast, stopAutoPlayByUser]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, handleSave]);

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading-container">
          <div className="spinner" />
          <span>加载数据中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container">
        <div className="loading-container">
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <span style={{ color: 'var(--danger)' }}>{error}</span>
          <button className="btn btn-accent" onClick={loadData}>重试</button>
        </div>
      </div>
    );
  }

  const page = (i) => Math.floor(i / PAGE_SIZE) + 1;

  return (
    <div className="app-container" ref={appContainerRef}>
      {/* Header */}
      <header className="app-header" ref={headerRef}>
        <h1 className="app-title">Slicer Labeler</h1>
        <span className="version-tag" title="构建版本">{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__.slice(0, 7) : 'dev'}</span>
        <div className="header-right">
          {hasUnsavedChanges && (
            <span style={{ color: 'var(--warning)', fontSize: 13 }}>
              <span className="unsaved-dot" />
              未保存
            </span>
          )}
          <button
            className={`btn ${autoPlayOn ? 'btn-danger' : 'btn-accent'}`}
            onClick={toggleAutoPlay}
          >
            {autoPlayOn ? '⏹ 停止自动' : '▶ 自动播放'}
          </button>
          <button
            className="btn"
            onClick={() => setSettingsOpen(true)}
            title="自动播放设置"
          >
            ⚙
          </button>
          <button
            className="btn theme-toggle-btn"
            onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色风格' : '切换到暗色风格'}
          >
            {theme === 'dark' ? '☀ 亮色' : '☾ 暗色'}
          </button>
          <button
            className="btn btn-accent"
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
          >
            保存 (Ctrl+S)
          </button>
          <button
            className="btn btn-success"
            onClick={handleMergeClick}
            disabled={checkedGlobalIndices.length < 2}
          >
            合并选中 ({checkedGlobalIndices.length})
          </button>
        </div>
      </header>

      {mediumRiskPrompt && (
        <div className="medium-risk-prompt">
          <div className="medium-risk-copy">
            <strong>中风险条目 #{mediumRiskPrompt.index + 1}</strong>
            <span>{mediumRiskPrompt.result?.summary || '该条目存在一定不匹配风险，请决定是否继续自动播放。'}</span>
          </div>
          <div className="medium-risk-actions">
            <span className="medium-risk-countdown">{mediumRiskPrompt.secondsLeft}s 后继续</span>
            <button className="btn btn-sm" onClick={() => stopAutoPlayByUser('自动播放已在中风险条目停止')}>
              停止
            </button>
            <button className="btn btn-sm" onClick={skipMediumRiskPrompt}>
              跳过此条
            </button>
            <button className="btn btn-accent btn-sm" onClick={continueMediumRiskPrompt}>
              继续
            </button>
          </div>
        </div>
      )}

      {/* Pagination top */}
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="pagination">
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage(0)}
            disabled={currentPage === 0}
          >
            {'<<'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            {'<'}
          </button>
          <span className="page-info">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
          >
            {'>'}
          </button>
          <button
            className="btn btn-sm"
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
          <button className="btn btn-sm" onClick={handleJumpPage}>跳转</button>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          共 {allEntries.length} 条
        </span>
      </div>

      {/* Items */}
      <div className="items-container">
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
              qualityResult={qualityResults[entry.wavPath]}
              qualityLoading={!!qualityLoading[entry.wavPath]}
              volume={volume}
            />
          );
        })}
      </div>

      {/* Pagination bottom */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="pagination">
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage(0)}
            disabled={currentPage === 0}
          >
            {'<<'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            {'<'}
          </button>
          <span className="page-info">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
          >
            {'>'}
          </button>
          <button
            className="btn btn-sm"
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
          <button className="btn btn-sm" onClick={handleJumpPage}>跳转</button>
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

      {/* Volume slider */}
      <VolumeSlider volume={volume} onChange={handleVolumeChange} />

      {/* Toast notifications */}
      <div className="status-bar">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
