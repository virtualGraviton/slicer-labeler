import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Inbox, Loader2 } from 'lucide-react';
import { deleteEntry as deleteEntryApi, fetchEntries, updateEntry, getDataset } from '../utils/api';
import ItemRow from '../components/ItemRow';
import SplitModal from '../components/SplitModal';
import MergeModal from '../components/MergeModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import SettingsPanel from '../components/SettingsPanel';
import LabelSidebar from '../components/label/LabelSidebar';
import { useTasks } from '../context/TaskContext';

const PAGE_SIZE = 10;

const DEFAULT_SETTINGS = {
  gapSeconds: 2,
  pageGapSeconds: 4,
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
  };
}

function readStoredVolume() {
  const vol = Number(readStoredPreferences().volume);
  if (Number.isFinite(vol) && vol >= 0 && vol <= 1) return vol;
  return 1;
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
  const { isDatasetBusy } = useTasks();
  const datasetBusy = isDatasetBusy(datasetId);

  const [dataset, setDataset] = useState(null);
  const readOnly = dataset?.canWrite === false;

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
  const countdownTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const appContainerRef = useRef(null);
  const autoPlayEnabledRef = useRef(false);
  const autoPlayIdxRef = useRef(-1);
  const settingsRef = useRef(readStoredSettings());
  settingsRef.current = settings;
  const scheduleNextRef = useRef(() => {});
  const entriesRef = useRef([]);
  const loadedPagesRef = useRef(new Set());
  const dirtyPathsRef = useRef(new Set());
  const saveTimerRef = useRef(null);

  // Load data
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the dataset to learn the user's write permission (read-only mode).
  useEffect(() => {
    let alive = true;
    getDataset(datasetId)
      .then((d) => { if (alive) setDataset(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [datasetId]);

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
    const data = await fetchEntries(datasetId, page + 1, PAGE_SIZE);
    setEntries((prev) => {
      const next = prev.slice();
      (data.data || []).forEach((entry, i) => {
        next[page * PAGE_SIZE + i] = entry;
      });
      // Sync the ref immediately so auto-play can read the freshly loaded page
      // right after awaiting loadPage, without waiting for a re-render.
      entriesRef.current = next;
      return next;
    });
    if (typeof data.total === 'number') setTotal(data.total);
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

  const stopAutoPlayByUser = useCallback((message = '自动播放已停止') => {
    const stopTarget = autoPlayIdxRef.current;
    setAutoPlayOn(false);
    autoPlayEnabledRef.current = false;
    autoPlayIdxRef.current = -1;
    clearAutoTimers();
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    setHighlightIndices([]);
    setStopSignal({ nonce: Date.now(), targetIdx: stopTarget >= 0 ? stopTarget : null });
    showToast(message, 'info');
  }, [clearAutoTimers, showToast]);

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
    dirtyPathsRef.current.add(entry.wavPath);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushDirtySaves();
    }, 800);
  }, [stopAutoPlayByUser, flushDirtySaves]);

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

  const beginAutoPlayItem = useCallback((nextGlobalIdx, gapSec) => {
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
      clearAutoTimers();
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

    beginAutoPlayItem(nextGlobalIdx, gapSec);
  }, [beginAutoPlayItem, clearAutoTimers, ensurePageLoaded, showToast, total]);
  scheduleNextRef.current = scheduleNext;

  // Called when an item's audio ends → advance to the next item
  const handleAudioEnded = useCallback((globalIndex) => {
    if (!autoPlayEnabledRef.current) return;
    const nextIdx = globalIndex + 1;
    scheduleNext(nextIdx, getGapAfterIndex(globalIndex));
  }, [getGapAfterIndex, scheduleNext]);

  // Toggle auto-play
  const startAutoPlayFrom = useCallback((globalIndex, gapSec = 0.5) => {
    if (globalIndex < 0 || globalIndex >= total) return;

    clearAutoTimers();
    setStopSignal({ nonce: Date.now(), targetIdx: null });
    setAutoPlayOn(true);
    autoPlayEnabledRef.current = true;
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    scheduleNext(globalIndex, gapSec);
  }, [clearAutoTimers, scheduleNext]);

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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      autoPlayEnabledRef.current = false;
      autoPlayIdxRef.current = -1;
    };
  }, [clearAutoTimers]);

  // Split
  const handleSplitClick = useCallback((globalIndex) => {
    if (readOnly) return;
    if (!entriesRef.current[globalIndex]) return;
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在切分条目');
    }
    setSplitTarget({ entry: entriesRef.current[globalIndex], globalIndex });
  }, [readOnly, stopAutoPlayByUser]);

  const handleSplitComplete = useCallback(async (globalIndex, first, second, newTotal) => {
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在切分条目');
    }
    setCheckedIndices({});
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    autoPlayIdxRef.current = -1;
    if (typeof newTotal === 'number') setTotal(newTotal);
    await resetEntriesCache(currentPage);
    focusItemsAfterListChange([globalIndex, globalIndex + 1], globalIndex);
  }, [currentPage, focusItemsAfterListChange, resetEntriesCache, stopAutoPlayByUser]);

  // Merge
  const handleMergeClick = useCallback(() => {
    if (readOnly) return;
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
  }, [checkedGlobalIndices, readOnly, showToast, stopAutoPlayByUser]);

  const handleMergeComplete = useCallback(async (globalIndices, merged, newTotal) => {
    if (autoPlayEnabledRef.current) {
      stopAutoPlayByUser('自动播放已暂停，正在合并条目');
    }
    const sorted = [...globalIndices].sort((a, b) => a - b);
    const firstIdx = sorted[0];
    setCheckedIndices({});
    setHighlightIndices([]);
    setCountdownIdx(-1);
    setCountdownVal(0);
    setCountdownTotalVal(0);
    autoPlayIdxRef.current = -1;
    if (typeof newTotal === 'number') setTotal(newTotal);
    await resetEntriesCache(currentPage);
    focusItemsAfterListChange([firstIdx], firstIdx);
  }, [currentPage, focusItemsAfterListChange, resetEntriesCache, stopAutoPlayByUser]);

  // Delete
  const handleDeleteClick = useCallback((globalIndex) => {
    if (readOnly) return;
    const entry = entriesRef.current[globalIndex];
    if (!entry) return;
    setDeleteTarget({ entry, globalIndex });
  }, [readOnly]);

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
      setHighlightIndices([]);
      setCountdownIdx(-1);
      setCountdownVal(0);
      setCountdownTotalVal(0);
      autoPlayIdxRef.current = -1;
      setTotal((t) => Math.max(0, t - 1));

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

  // 空数据集：只保留顶级 header，隐藏侧栏/分页/列表等其余组件
  if (total === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-6 min-h-screen">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
            <Inbox size={28} className="text-[color:var(--accent)]" />
          </div>
          <p className="text-lg font-medium text-[color:var(--text-primary)]">该数据集暂无条目</p>
          <p className="text-sm text-[color:var(--text-secondary)] max-w-sm">
            可通过数据集列表页的「导入」功能，将推理机的音频压缩包（zip / tar.gz）导入到此数据集
          </p>
          <button className={BTN_ACCENT} onClick={() => navigate(-1)}>返回数据集列表</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-0 min-h-[calc(100vh-56px)]" ref={appContainerRef}>
      {/* Left sidebar */}
      <div className="p-4">
        <LabelSidebar
          autoPlayOn={autoPlayOn}
          onToggleAutoPlay={toggleAutoPlay}
          onOpenSettings={() => setSettingsOpen(true)}
          onBack={() => navigate(`/models/${datasetId ? '..' : '/'}`)}
          checkedCount={checkedGlobalIndices.length}
          onMergeClick={handleMergeClick}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          busy={datasetBusy}
          readOnly={readOnly}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 p-4">
      {/* Busy banner */}
      {datasetBusy && (
        <div className="mb-3 px-4 py-2.5 rounded-lg bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800
          flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300">
          <Loader2 size={13} className="animate-spin" />
          数据集正在执行任务，写操作（编辑/切分/合并/删除）已锁定，任务完成后自动解锁
        </div>
      )}
      {/* Read-only banner */}
      {readOnly && (
        <div className="mb-3 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800
          flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
          当前为只读模式（无该数据集的写权限），只能查看与播放
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
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages - 1}
          >
            {'>'}
          </button>
          <button
            className={BTN_SM}
            onClick={() => goToPage(totalPages - 1)}
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
              onAutoPlayFrom={handleAutoPlayFrom}
              onDeleteClick={handleDeleteClick}
              playSignal={playSignal}
              stopSignal={stopSignal}
              highlight={highlightIndices.includes(globalIdx)}
              showCountdown={countdownIdx === globalIdx}
              countdownSeconds={countdownIdx === globalIdx ? countdownVal : null}
              countdownTotalSeconds={countdownIdx === globalIdx ? countdownTotalVal : null}
              volume={volume}
              busy={datasetBusy}
              readOnly={readOnly}
            />
          );
        })}
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
