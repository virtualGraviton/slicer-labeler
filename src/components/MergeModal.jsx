import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getAudioUrl, mergeAudio, polishMergeText } from '../utils/api';

function tokenizeForDiff(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  if (!/\s/.test(value)) {
    return Array.from(value);
  }
  return value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[\u4e00-\u9fff]|[^\sA-Za-z0-9\u4e00-\u9fff]/g) || [];
}

function buildTokenDiff(original, revised) {
  const a = tokenizeForDiff(original);
  const b = tokenizeForDiff(revised);
  if (!a.length && !b.length) return [];

  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      diff.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'delete', value: a[i] });
      i++;
    } else {
      diff.push({ type: 'add', value: b[j] });
      j++;
    }
  }
  while (i < a.length) diff.push({ type: 'delete', value: a[i++] });
  while (j < b.length) diff.push({ type: 'add', value: b[j++] });
  return diff;
}

export default function MergeModal({ entries, globalIndices, onClose, onMergeComplete, showToast }) {
  const [mergedText, setMergedText] = useState('');
  const [polishedText, setPolishedText] = useState('');
  const [polishExplanation, setPolishExplanation] = useState('');
  const [polishLoading, setPolishLoading] = useState(false);
  const [polishError, setPolishError] = useState('');
  const [textSource, setTextSource] = useState('hard');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const audioCtxRef = useRef(null);
  const buffersRef = useRef([]);
  const startTimeRef = useRef(0);
  const totalDurationRef = useRef(0);
  const rafRef = useRef(null);
  const sourcesRef = useRef([]);
  const polishRequestRef = useRef(0);
  const [previewTime, setPreviewTime] = useState(0);

  const hardMergedText = useMemo(() => entries.map((e) => e.text).join(' '), [entries]);
  const finalText = textSource === 'polished' ? polishedText : mergedText;
  const diffTokens = useMemo(() => buildTokenDiff(mergedText, polishedText), [mergedText, polishedText]);

  useEffect(() => {
    setMergedText(hardMergedText);
    setPolishedText('');
    setPolishExplanation('');
    setPolishError('');
    setTextSource('hard');
  }, [hardMergedText]);

  const requestPolish = useCallback(async () => {
    const requestId = polishRequestRef.current + 1;
    polishRequestRef.current = requestId;
    setPolishLoading(true);
    setPolishError('');

    try {
      const result = await polishMergeText({
        entries: entries.map((entry) => ({
          wavPath: entry.wavPath,
          speaker: entry.speaker,
          language: entry.language,
          text: entry.text,
        })),
        hardMergedText,
        speaker: entries[0]?.speaker || '',
        language: entries[0]?.language || '',
      });
      if (polishRequestRef.current !== requestId) return;
      setPolishedText(result.polishedText || '');
      setPolishExplanation(result.explanationZh || '模型未说明具体修改。');
    } catch (err) {
      if (polishRequestRef.current !== requestId) return;
      setPolishError(err.message || '润色失败');
    } finally {
      if (polishRequestRef.current === requestId) {
        setPolishLoading(false);
      }
    }
  }, [entries, hardMergedText]);

  useEffect(() => {
    requestPolish();
    return () => {
      polishRequestRef.current += 1;
    };
  }, [requestPolish]);

  // Preload all audio buffers for gapless preview
  useEffect(() => {
    const load = async () => {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const buffers = [];
      let totalDur = 0;
      for (const entry of entries) {
        const url = getAudioUrl(entry.wavPath);
        try {
          const res = await fetch(url);
          const arrayBuf = await res.arrayBuffer();
          const buf = await audioCtxRef.current.decodeAudioData(arrayBuf);
          buffers.push(buf);
          totalDur += buf.duration;
        } catch (err) {
          console.error('Failed to load audio:', err);
        }
      }
      buffersRef.current = buffers;
      totalDurationRef.current = totalDur;
      setPreviewLoaded(true);
    };
    load();

    return () => {
      audioCtxRef.current?.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [entries]);

  // Gapless preview: schedule all buffers consecutively
  const playFullPreview = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffers = buffersRef.current;
    if (!ctx || buffers.length === 0) return;

    if (previewPlaying) {
      // Stop all active source nodes (don't suspend ctx)
      sourcesRef.current.forEach((s) => {
        try { s.stop(); } catch (_) {}
      });
      sourcesRef.current = [];
      setPreviewPlaying(false);
      setPreviewTime(0);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    // Clear any leftover sources
    sourcesRef.current.forEach((s) => {
      try { s.stop(); } catch (_) {}
    });
    sourcesRef.current = [];

    // Ensure context is running
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => startPlayback(ctx, buffers));
    } else {
      startPlayback(ctx, buffers);
    }
  }, [previewPlaying]);

  const startPlayback = useCallback((ctx, buffers) => {
    // Create and connect buffer sources
    let offset = ctx.currentTime;
    startTimeRef.current = offset;

    for (const buf of buffers) {
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      source.start(offset);
      source.onended = () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s !== source);
      };
      sourcesRef.current.push(source);
      offset += buf.duration;
    }

    setPreviewPlaying(true);

    // RAF for time display (doesn't care about ctx.state)
    const tick = () => {
      if (!sourcesRef.current.some((s) => {
        try { return s.context?.state === 'running' && !s.playbackState ? true : (s.playbackState !== 'finished'); } catch (_) { return false; }
      })) {
        // Check if all sources finished
        const elapsed = ctx.currentTime - startTimeRef.current;
        if (elapsed >= totalDurationRef.current || sourcesRef.current.length === 0) {
          setPreviewPlaying(false);
          setPreviewTime(totalDurationRef.current);
          sourcesRef.current = [];
          return;
        }
      }
      const elapsed = ctx.currentTime - startTimeRef.current;
      setPreviewTime(Math.min(elapsed, totalDurationRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopPreview = useCallback(() => {
    sourcesRef.current.forEach((s) => {
      try { s.stop(); } catch (_) {}
    });
    sourcesRef.current = [];
    setPreviewPlaying(false);
    setPreviewTime(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleMerge = async () => {
    const selectedText = finalText.trim();
    if (!selectedText) return;

    setLoading(true);
    try {
      stopPreview();
      const result = await mergeAudio({
        entries: entries.map((e) => ({ wavPath: e.wavPath })),
        mergedText: selectedText,
        speaker: entries[0].speaker,
        language: entries[0].language,
      });
      onMergeComplete(globalIndices, result.merged);
      showToast('合并完成', 'success');
      onClose();
    } catch (err) {
      showToast('合并失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal merge-modal" onClick={(e) => e.stopPropagation()}>
        <h2>合并音频 - {entries.length} 个条目</h2>

        {/* Merged items list */}
        <div className="modal-section">
          <label>选中的条目 ({entries.length})</label>
          <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 13, lineHeight: 1.6 }}>
            {entries.map((e, i) => (
              <div key={i} style={{
                padding: '6px 10px',
                marginBottom: 4,
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
              }}>
                <strong>#{globalIndices[i] + 1}</strong>: {e.text.slice(0, 80)}{e.text.length > 80 ? '...' : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Full preview */}
        <div className="modal-section">
          <label>
            合并预览
            {previewLoaded && (
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                总时长 {formatTime(totalDurationRef.current)}
              </span>
            )}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className={`btn btn-sm ${previewPlaying ? 'btn-accent' : ''}`}
              onClick={playFullPreview}
              disabled={!previewLoaded}
            >
              {previewPlaying
                ? `暂停 ${formatTime(previewTime)}`
                : '连续预览'}
            </button>
            {previewPlaying && (
              <div style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: 'rgba(15,23,42,0.12)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: totalDurationRef.current > 0 ? `${(previewTime / totalDurationRef.current) * 100}%` : '0%',
                  background: 'var(--accent)',
                  borderRadius: 2,
                  transition: 'width 0.1s linear',
                }} />
              </div>
            )}
          </div>
        </div>

        {/* Merged text */}
        <div className="modal-section">
          <label>合并后文本（硬拼接）</label>
          <textarea
            value={mergedText}
            onChange={(e) => setMergedText(e.target.value)}
            rows={5}
            placeholder="合并后的文本..."
          />
        </div>

        <div className="modal-section merge-polish-section">
          <div className="merge-polish-head">
            <label>润色后文本</label>
            <div className={`merge-polish-status ${polishLoading ? 'loading' : polishError ? 'error' : polishedText ? 'done' : ''}`}>
              {polishLoading && 'DeepSeek 润色中...'}
              {!polishLoading && polishError && `润色失败：${polishError}`}
              {!polishLoading && !polishError && polishedText && 'DeepSeek 润色完成'}
              {!polishLoading && !polishError && !polishedText && '等待润色结果'}
            </div>
          </div>
          {polishError && (
            <button type="button" className="btn btn-sm" onClick={requestPolish} disabled={polishLoading}>
              重试润色
            </button>
          )}
          <textarea
            value={polishedText}
            onChange={(e) => setPolishedText(e.target.value)}
            rows={5}
            placeholder={polishLoading ? '正在生成润色文本...' : '润色后的文本会显示在这里，也可以手动编辑'}
          />

          <div className="merge-source-row">
            <span>最终使用</span>
            <div className="merge-source-toggle" role="group" aria-label="最终使用文本">
              <button
                type="button"
                className={`merge-source-option ${textSource === 'hard' ? 'active' : ''}`}
                onClick={() => setTextSource('hard')}
              >
                原文本
              </button>
              <button
                type="button"
                className={`merge-source-option ${textSource === 'polished' ? 'active' : ''}`}
                onClick={() => setTextSource('polished')}
                disabled={!polishedText.trim()}
              >
                润色文本
              </button>
            </div>
          </div>

          {polishExplanation && (
            <div className="merge-polish-explanation">
              <strong>中文合并说明</strong>
              <p>{polishExplanation}</p>
            </div>
          )}

          {polishedText.trim() && (
            <div className="merge-diff-wrap">
              <div className="merge-diff-title">Diff：原硬拼接文本 → 润色文本</div>
              <div className="merge-diff-box" aria-label="合并文本 diff">
                {diffTokens.map((token, index) => (
                  <span key={`${token.type}-${index}-${token.value}`} className={`diff-token diff-${token.type}`}>
                    {token.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-accent" onClick={handleMerge} disabled={loading || !finalText.trim()}>
            {loading ? '合并中...' : '确认合并'}
          </button>
        </div>
      </div>
    </div>
  );
}