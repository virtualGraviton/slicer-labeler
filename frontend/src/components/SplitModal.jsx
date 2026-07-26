import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAudioUrl, splitAudio } from '../utils/api';
import { parseSamples, samplesToTime, formatTime } from '../utils/fileNaming';

export default function SplitModal({ entry, globalIndex, onClose, onSplitComplete, showToast }) {
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [duration, setDuration] = useState(0);
  const [splitTime, setSplitTime] = useState(0);
  const [splitTextIndex, setSplitTextIndex] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(null); // 'first' | 'second' | null
  const [loading, setLoading] = useState(false);

  const audioUrl = getAudioUrl(entry.wavPath);
  const { startSample, endSample } = parseSamples(entry.wavPath);

  const audioRef = useRef(null);
  const firstAudioRef = useRef(null);
  const secondAudioRef = useRef(null);

  useEffect(() => {
    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((arrayBuf) => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(arrayBuf);
      })
      .then((buf) => {
        setAudioBuffer(buf);
        setDuration(buf.duration);
        setSplitTime(buf.duration / 2);
        setSplitTextIndex(Math.floor(entry.text.length / 2));
      })
      .catch(() => {});
  }, [audioUrl]);

  const splitPercent = duration > 0 ? (splitTime / duration) * 100 : 50;

  const textBefore = entry.text.slice(0, splitTextIndex);
  const textAfter = entry.text.slice(splitTextIndex);

  const handleSplit = async () => {
    if (splitTime < 0.1 || splitTime > duration - 0.1) {
      showToast('切分点太靠近边界', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = await splitAudio({
        audioPath: entry.wavPath,
        splitTime,
        text: entry.text,
        splitTextIndex,
        speaker: entry.speaker,
        language: entry.language,
      });
      onSplitComplete(globalIndex, result.first, result.second);
      showToast('切分完成', 'success');
      onClose();
    } catch (err) {
      showToast('切分失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const playPreview = (part) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewPlaying === part) {
      audio.pause();
      setPreviewPlaying(null);
      return;
    }
    if (part === 'first') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      const stopAt = splitTime;
      const check = setInterval(() => {
        if (audio.currentTime >= stopAt) {
          audio.pause();
          setPreviewPlaying(null);
          clearInterval(check);
        }
      }, 50);
    } else {
      audio.currentTime = splitTime;
      audio.play().catch(() => {});
    }
    setPreviewPlaying(part);
    audio.onended = () => setPreviewPlaying(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>切分音频 - #{globalIndex + 1}</h2>

        {/* Full audio preview */}
        <div className="modal-section">
          <label>原始音频预览</label>
          <div className="audio-player">
            <button
              className={`play-btn ${previewPlaying === 'full' ? 'playing' : ''}`}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (previewPlaying === 'full') {
                  audio.pause();
                  setPreviewPlaying(null);
                } else {
                  audio.currentTime = 0;
                  audio.play().catch(() => {});
                  setPreviewPlaying('full');
                }
              }}
            >
              {previewPlaying === 'full' ? '❚❚' : '▶'}
            </button>
            <input
              className="audio-preview-range"
              type="range"
              min="0"
              max={duration || 0}
              step="0.01"
              value={splitTime}
              onChange={(e) => setSplitTime(parseFloat(e.target.value))}
            />
            <span className="audio-time">
              {formatTime(splitTime)} / {formatTime(duration)}
            </span>
          </div>
          <audio ref={audioRef} src={audioUrl} preload="auto" />
        </div>

        {/* Split point slider */}
        <div className="modal-section">
          <label>
            切分点: {formatTime(splitTime)} (采样点: {startSample + Math.round(splitTime * 32000)})
          </label>
          <div className="split-slider-container">
            <input
              type="range"
              className="split-slider"
              min="0.05"
              max={(duration - 0.05).toFixed(2)}
              step="0.01"
              value={splitTime}
              onChange={(e) => setSplitTime(parseFloat(e.target.value))}
              style={{ '--split-percent': `${splitPercent}%` }}
            />
          </div>
        </div>

        {/* Text split */}
        <div className="modal-section">
          <label>文本切分点 (点击文本设置分界)</label>
          <textarea
            value={entry.text}
            readOnly
            rows={3}
            onClick={(e) => {
              const pos = e.target.selectionStart;
              setSplitTextIndex(pos);
            }}
            onKeyUp={(e) => {
              const pos = e.target.selectionStart;
              setSplitTextIndex(pos);
            }}
          />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            <span style={{ color: 'var(--success)' }}>{textBefore || '(前段)'}</span>
            <span className="text-split-indicator">|</span>
            <span style={{ color: 'var(--warning)' }}>{textAfter || '(后段)'}</span>
          </div>
        </div>

        {/* Preview sections */}
        <div className="split-preview">
          <div className="split-preview-item">
            <h4>前段音频</h4>
            <div className="preview-waveform" style={{ background: 'rgba(16,185,129,0.15)' }} />
            <button
              className="btn btn-sm"
              style={{ marginBottom: 8 }}
              onClick={() => playPreview('first')}
            >
              {previewPlaying === 'first' ? '⏸ 停止' : '▶ 预览'}
            </button>
            <div className="preview-text">
              {textBefore || '(空)'}
            </div>
          </div>
          <div className="split-preview-item">
            <h4>后段音频</h4>
            <div className="preview-waveform" style={{ background: 'rgba(245,158,11,0.15)' }} />
            <button
              className="btn btn-sm"
              style={{ marginBottom: 8 }}
              onClick={() => playPreview('second')}
            >
              {previewPlaying === 'second' ? '⏸ 停止' : '▶ 预览'}
            </button>
            <div className="preview-text">
              {textAfter || '(空)'}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-accent" onClick={handleSplit} disabled={loading}>
            {loading ? '切分中...' : '确认切分'}
          </button>
        </div>
      </div>
    </div>
  );
}
