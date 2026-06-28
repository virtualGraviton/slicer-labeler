import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAudioUrl, mergeAudio } from '../utils/api';

export default function MergeModal({ entries, globalIndices, onClose, onMergeComplete, showToast }) {
  const [mergedText, setMergedText] = useState('');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const audioCtxRef = useRef(null);
  const buffersRef = useRef([]);
  const startTimeRef = useRef(0);
  const totalDurationRef = useRef(0);
  const rafRef = useRef(null);
  const sourcesRef = useRef([]);
  const [previewTime, setPreviewTime] = useState(0);

  useEffect(() => {
    setMergedText(entries.map((e) => e.text).join(' '));
  }, [entries]);

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
    setLoading(true);
    try {
      const result = await mergeAudio({
        entries: entries.map((e) => ({ wavPath: e.wavPath })),
        mergedText: mergedText.trim(),
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
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
                总时长: {formatTime(totalDurationRef.current)}
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
                ? `⏸ 停止 ${formatTime(previewTime)}`
                : '▶ 连续预览'}
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
          <label>合并后文本</label>
          <textarea
            value={mergedText}
            onChange={(e) => setMergedText(e.target.value)}
            rows={5}
            placeholder="合并后的文本..."
          />
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-accent" onClick={handleMerge} disabled={loading || !mergedText.trim()}>
            {loading ? '合并中...' : '确认合并'}
          </button>
        </div>
      </div>
    </div>
  );
}
