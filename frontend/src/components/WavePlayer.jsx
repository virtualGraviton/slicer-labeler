import React, { useRef, useState, useEffect, useCallback } from 'react';
import { formatTime } from '../utils/fileNaming';

/**
 * Combined waveform + seek + play component.
 * Waveform doubles as a clickable progress bar with a scanning line.
 */
export default function WavePlayer({
  audioUrl,
  audioBuffer,
  onEnded,
  onPlayStateChange,
  onPlay,
  playSignal,
  stopSignal,
  countdownActive,
  countdownSeconds,
  countdownTotalSeconds,
  index,
  volume,
}) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const waveformDataRef = useRef(null);
  const lastNonceRef = useRef(0);
  const lastStopNonceRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);

  // ---- Apply global volume ----
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // ---- Draw waveform (cached) ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = 52 * dpr;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.clientWidth);
    const ampArr = [];
    for (let i = 0; i < canvas.clientWidth; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ampArr.push(Math.max(Math.abs(min), Math.abs(max)));
    }
    waveformDataRef.current = { ampArr, maxAmp: Math.max(...ampArr, 0.001) };
    setDuration(audioBuffer.duration);
    redrawWaveform(ctx, canvas.clientWidth, 52, ampArr, waveformDataRef.current.maxAmp, 0);
  }, [audioBuffer]);

  // ---- Auto-play trigger from parent (nonce-based, prevents double-fire) ----
  useEffect(() => {
    const nonce = playSignal?.nonce ?? 0;
    if (playSignal?.targetIdx !== index) return;
    if (nonce > 0 && nonce !== lastNonceRef.current) {
      lastNonceRef.current = nonce;
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    }
  }, [playSignal, index]);

  // ---- Resize observer ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const d = waveformDataRef.current;
        const canvas = canvasRef.current;
        if (d && canvas) {
          const dpr = window.devicePixelRatio || 1;
          const w = entry.contentRect.width * dpr;
          const h = 52 * dpr;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          redrawWaveform(ctx, entry.contentRect.width, 52, d.ampArr, d.maxAmp, 0);
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ---- Redraw helper (draws waveform + scan line) ----
  const redrawWaveform = useCallback((ctx, w, h, ampArr, maxAmp, progress) => {
    ctx.clearRect(0, 0, w, h);
    const playedX = Math.floor(progress * w);

    const midY = h / 2;
    for (let i = 0; i < ampArr.length; i++) {
      const frac = ampArr[i] / maxAmp;
      const bh = Math.max(1, frac * midY * 0.85);
      const y = midY - bh / 2;
      ctx.fillStyle = i <= playedX ? 'var(--accent, #0f766e)' : 'var(--text-secondary, #64748b)';
      ctx.globalAlpha = i <= playedX ? 0.9 : 0.35;
      ctx.fillRect(i, y, 1, bh);
    }
    ctx.globalAlpha = 1;

    if (progress > 0) {
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(20,184,166,0.45)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(playedX + 0.5, 0);
      ctx.lineTo(playedX + 0.5, h);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, []);

  // ---- RAF loop ----
  const startRAF = useCallback(() => {
    const tick = () => {
      const audio = audioRef.current;
      const d = waveformDataRef.current;
      const canvas = canvasRef.current;
      if (audio && d && canvas) {
        const progress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const ctx = canvas.getContext('2d');
        redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, progress);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [redrawWaveform]);

  const stopRAF = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const resetPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    stopRAF();
    setPlaying(false);
    setDisplayTime(0);

    const d = waveformDataRef.current;
    const canvas = canvasRef.current;
    if (d && canvas) {
      const ctx = canvas.getContext('2d');
      redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, 0);
    }
  }, [stopRAF, redrawWaveform]);

  // ---- Stop trigger from parent, used when auto-play hits a risky item ----
  useEffect(() => {
    const nonce = stopSignal?.nonce ?? 0;
    const targetIdx = stopSignal?.targetIdx;
    if (nonce > 0 && nonce !== lastStopNonceRef.current && (targetIdx == null || targetIdx === index)) {
      lastStopNonceRef.current = nonce;
      resetPlayback();
    }
  }, [stopSignal, index, resetPlayback]);

  // ---- Time display throttled ----
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (audioRef.current) {
        setDisplayTime(audioRef.current.currentTime);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [playing]);

  // ---- Click to seek ----
  const handleWaveformClick = useCallback((e) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const d = waveformDataRef.current;
    if (!canvas || !audio || !audio.duration || !d) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    const seekTime = progress * audio.duration;
    audio.currentTime = seekTime;
    setDisplayTime(seekTime);
    const ctx = canvas.getContext('2d');
    redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, progress);
  }, [redrawWaveform]);

  // ---- Play/Pause ----
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [playing]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    stopRAF();
    setDisplayTime(0);
    const d = waveformDataRef.current;
    const canvas = canvasRef.current;
    if (d && canvas) {
      const ctx = canvas.getContext('2d');
      redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, 0);
    }
    onEnded?.();
  }, [stopRAF, redrawWaveform, onEnded]);

  const countdownProgress = countdownActive && countdownTotalSeconds > 0
    ? Math.max(0, Math.min(1, 1 - (countdownSeconds || 0) / countdownTotalSeconds))
    : 0;
  const countdownAngle = `${Math.round(countdownProgress * 360)}deg`;

  return (
    <div className="wave-player">
      <div className="wave-row">
        <button
          className={`play-btn ${playing ? 'playing' : ''} ${countdownActive ? 'countdown-active' : ''}`}
          onClick={togglePlay}
          title={countdownActive ? 'Waiting' : playing ? 'Pause' : 'Play'}
          style={{ '--countdown-angle': countdownAngle }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="wave-canvas-wrap" ref={containerRef} onClick={handleWaveformClick}>
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div className="wave-time">
        {formatTime(displayTime)} / {formatTime(duration)}
      </div>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        onPlay={() => { setPlaying(true); onPlayStateChange?.(true); onPlay?.(); startRAF(); }}
        onPause={() => { setPlaying(false); onPlayStateChange?.(false); stopRAF(); }}
        onEnded={handleEnded}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
      />
    </div>
  );
}
