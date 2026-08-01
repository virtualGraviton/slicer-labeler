import { useState, useEffect, useRef } from 'react';
import { getAudioUrl, splitAudio } from '../utils/api';
import { parseSamples, formatTime } from '../utils/fileNaming';

const BTN = 'inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_ACCENT = 'inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--accent)] border border-[color:var(--accent)] shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[color:var(--accent-hover)] hover:shadow-[0_6px_20px_var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const MODAL = 'bg-[color:var(--panel-bg)] border border-[color:var(--card-border)] rounded-2xl p-8 max-w-[720px] w-[90vw] max-h-[85vh] overflow-y-auto shadow-[0_25px_60px_rgba(15,23,42,0.22)] animate-[modalIn_0.3s_cubic-bezier(0.34,1.56,0.64,1)]';

const TEXTAREA = 'w-full bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-lg text-[color:var(--text-primary)] p-2.5 text-sm leading-[1.5] resize-y min-h-[60px] outline-none focus:border-[color:var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]';

export default function SplitModal({ entry, globalIndex, onClose, onSplitComplete, showToast }) {
  const [duration, setDuration] = useState(0);
  const [splitTime, setSplitTime] = useState(0);
  const [splitTextIndex, setSplitTextIndex] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(null); // 'first' | 'second' | null
  const [loading, setLoading] = useState(false);

  const audioUrl = getAudioUrl(entry.id);
  const { startSample } = parseSamples(entry.wavPath);

  const audioRef = useRef(null);

  useEffect(() => {
    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((arrayBuf) => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(arrayBuf);
      })
      .then((buf) => {
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
      const result = await splitAudio(entry.id, {
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
    <div className="fixed inset-0 z-[1000] bg-[rgba(15,23,42,0.45)] backdrop-blur-[6px] flex items-center justify-center animate-[fadeIn_0.2s_ease]" onClick={onClose}>
      <div className={MODAL} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[22px] font-semibold mb-6 text-[color:var(--text-primary)]">切分音频 - #{globalIndex + 1}</h2>

        {/* Full audio preview */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-[color:var(--text-secondary)] mb-2 uppercase tracking-[0.5px]">原始音频预览</label>
          <div className="grid grid-cols-[36px_minmax(180px,1fr)_116px] items-center gap-3 w-full max-[560px]:grid-cols-[36px_1fr]">
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
              className="w-full min-w-0 m-0 accent-[color:var(--accent)]"
              type="range"
              min="0"
              max={duration || 0}
              step="0.01"
              value={splitTime}
              onChange={(e) => setSplitTime(parseFloat(e.target.value))}
            />
            <span className="inline-flex justify-end text-[13px] text-[color:var(--text-primary)] tabular-nums whitespace-nowrap max-[560px]:justify-start max-[560px]:col-start-2">
              {formatTime(splitTime)} / {formatTime(duration)}
            </span>
          </div>
          <audio ref={audioRef} src={audioUrl} preload="auto" />
        </div>

        {/* Split point slider */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-[color:var(--text-secondary)] mb-2 uppercase tracking-[0.5px]">
            切分点: {formatTime(splitTime)} (采样点: {startSample + Math.round(splitTime * 32000)})
          </label>
          <div className="w-full relative">
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
        <div className="mb-5">
          <label className="block text-xs font-medium text-[color:var(--text-secondary)] mb-2 uppercase tracking-[0.5px]">文本切分点 (点击文本设置分界)</label>
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
            className={TEXTAREA}
          />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            <span style={{ color: 'var(--success)' }}>{textBefore || '(前段)'}</span>
            <span className="inline-block bg-[color:var(--danger)] text-white px-1.5 py-px rounded-[3px] text-[11px] mx-0.5 animate-[blink_0.8s_infinite]">|</span>
            <span style={{ color: 'var(--warning)' }}>{textAfter || '(后段)'}</span>
          </div>
        </div>

        {/* Preview sections */}
        <div className="flex gap-3 mt-3.5">
          <div className="flex-1 bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-lg p-3.5">
            <h4 className="text-xs text-[color:var(--text-secondary)] mb-2 uppercase tracking-[1px]">前段音频</h4>
            <div className="h-10 bg-[color:var(--waveform-bg)] rounded mb-2" style={{ background: 'rgba(16,185,129,0.15)' }} />
            <button
              className={BTN_SM}
              style={{ marginBottom: 8 }}
              onClick={() => playPreview('first')}
            >
              {previewPlaying === 'first' ? '⏸ 停止' : '▶ 预览'}
            </button>
            <div className="text-[13px] text-[color:var(--text-primary)] leading-[1.4] max-h-[60px] overflow-y-auto">
              {textBefore || '(空)'}
            </div>
          </div>
          <div className="flex-1 bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-lg p-3.5">
            <h4 className="text-xs text-[color:var(--text-secondary)] mb-2 uppercase tracking-[1px]">后段音频</h4>
            <div className="h-10 bg-[color:var(--waveform-bg)] rounded mb-2" style={{ background: 'rgba(245,158,11,0.15)' }} />
            <button
              className={BTN_SM}
              style={{ marginBottom: 8 }}
              onClick={() => playPreview('second')}
            >
              {previewPlaying === 'second' ? '⏸ 停止' : '▶ 预览'}
            </button>
            <div className="text-[13px] text-[color:var(--text-primary)] leading-[1.4] max-h-[60px] overflow-y-auto">
              {textAfter || '(空)'}
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 justify-end mt-6 pt-4 border-t border-[color:var(--card-border)]">
          <button className={BTN} onClick={onClose}>取消</button>
          <button className={BTN_ACCENT} onClick={handleSplit} disabled={loading}>
            {loading ? '切分中...' : '确认切分'}
          </button>
        </div>
      </div>
    </div>
  );
}
