import { useRef, useState, useEffect, useCallback } from 'react';
import { formatTime } from '../utils/fileNaming';

/**
 * Combined waveform + seek + play component.
 * Waveform doubles as a clickable progress bar with a scanning line.
 *
 * 播放引擎：WebAudio（AudioBufferSourceNode）而非 <audio>。
 * 原因：音频统一走"一次 fetch → decodeAudioData"，波形与播放共用同一份 buffer；
 * 避免 <audio> 播放 blob 时因 MIME/容器解析在部分浏览器（如 Firefox）报
 * NS_ERROR_DOM_MEDIA_METADATA_ERR，也彻底消除 media 发起的重复请求。
 */
let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}

export default function WavePlayer({
  audioUrl,
  audioBuffer,
  loadState = 'lazy',
  onRequestLoad,
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
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const waveformDataRef = useRef(null);
  const lastNonceRef = useRef(0);
  const lastStopNonceRef = useRef(0);
  const pendingPlayRef = useRef(false); // 懒加载完成后自动播放（手动播放/自动播放触发的加载）
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const audioLoaded = !!audioUrl && !!audioBuffer;

  // ---- WebAudio 播放状态 ----
  const sourceRef = useRef(null);       // 当前 AudioBufferSourceNode
  const gainRef = useRef(null);         // 音量 GainNode
  const offsetRef = useRef(0);          // 暂停/seek 后的当前位置（秒）
  const startCtxTimeRef = useRef(0);    // 本次播放开始的 ctx.currentTime
  const startOffsetRef = useRef(0);     // 本次播放开始的偏移
  const naturalEndedRef = useRef(true); // 是否自然结束（区分主动 stop）
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // ---- 懒加载完成（audioBuffer 就绪）后自动播放 ----
  useEffect(() => {
    if (audioLoaded && pendingPlayRef.current) {
      pendingPlayRef.current = false;
      playFrom(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLoaded]);

  // ---- Apply global volume ----
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
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
      if (!audioLoaded) {
        // 音频尚未懒加载：请求加载，且不消费 nonce，加载完成后由 audioLoaded effect 播放
        pendingPlayRef.current = true;
        onRequestLoad?.();
        return;
      }
      lastNonceRef.current = nonce;
      playFrom(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal, index, audioLoaded, onRequestLoad]);

  // ---- 自动播放倒计时阶段预加载（减小跨页连播的等待） ----
  useEffect(() => {
    if (countdownActive && !audioLoaded) {
      onRequestLoad?.();
    }
  }, [countdownActive, audioLoaded, onRequestLoad]);

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

  // ---- WebAudio: 停止当前 source（主动 stop，不触发自然结束） ----
  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.onended = null; } catch (_) {}
      try { sourceRef.current.stop(); } catch (_) {}
      sourceRef.current = null;
    }
    gainRef.current = null;
  }, []);

  // ---- RAF loop (时间显示 + 扫描线) ----
  const startRAF = useCallback(() => {
    const tick = () => {
      const d = waveformDataRef.current;
      const canvas = canvasRef.current;
      if (d && canvas) {
        const ctx = getCtx();
        const pos = sourceRef.current
          ? startOffsetRef.current + (ctx.currentTime - startCtxTimeRef.current)
          : offsetRef.current;
        setDisplayTime(pos);
        const progress = audioBuffer && audioBuffer.duration > 0
          ? Math.max(0, Math.min(1, pos / audioBuffer.duration))
          : 0;
        const c2 = canvas.getContext('2d');
        redrawWaveform(c2, canvas.clientWidth, 52, d.ampArr, d.maxAmp, progress);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [audioBuffer, redrawWaveform]);

  const stopRAF = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ---- WebAudio: 从指定位置播放 ----
  const playFrom = useCallback(async (offset) => {
    if (!audioBuffer) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
    }
    if (ctx.state !== 'running') {
      // 自动播放策略阻止：静默失败（与 <audio> 被 autoplay 限制一致）
      setPlaying(false);
      return;
    }
    stopSource();

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;
    source.connect(gain);
    gain.connect(ctx.destination);

    const clampedOffset = Math.max(0, Math.min(offset, Math.max(0, audioBuffer.duration - 0.001)));
    naturalEndedRef.current = true;
    source.onended = () => {
      sourceRef.current = null;
      gainRef.current = null;
      if (naturalEndedRef.current) {
        setPlaying(false);
        setDisplayTime(0);
        stopRAF();
        const d = waveformDataRef.current;
        const canvas = canvasRef.current;
        if (d && canvas) {
          const ctx2 = canvas.getContext('2d');
          redrawWaveform(ctx2, canvas.clientWidth, 52, d.ampArr, d.maxAmp, 0);
        }
        onEnded?.();
      }
    };
    source.start(0, clampedOffset);

    sourceRef.current = source;
    gainRef.current = gain;
    offsetRef.current = clampedOffset;
    startCtxTimeRef.current = ctx.currentTime;
    startOffsetRef.current = clampedOffset;
    setPlaying(true);
    onPlayStateChange?.(true);
    onPlay?.();
    startRAF();
  }, [audioBuffer, onEnded, onPlay, onPlayStateChange, redrawWaveform, startRAF, stopRAF, stopSource]);

  // ---- WebAudio: 暂停（记录位置） ----
  const pausePlayback = useCallback(() => {
    const ctx = getCtx();
    if (sourceRef.current) {
      offsetRef.current = startOffsetRef.current + (ctx.currentTime - startCtxTimeRef.current);
      stopSource();
    }
    setPlaying(false);
    onPlayStateChange?.(false);
    stopRAF();
  }, [onPlayStateChange, stopRAF, stopSource]);

  // ---- Reset（stopSignal / 停止） ----
  const resetPlayback = useCallback(() => {
    stopSource();
    offsetRef.current = 0;
    setPlaying(false);
    setDisplayTime(0);
    stopRAF();
    const d = waveformDataRef.current;
    const canvas = canvasRef.current;
    if (d && canvas) {
      const ctx = canvas.getContext('2d');
      redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, 0);
    }
  }, [redrawWaveform, stopRAF, stopSource]);

  // ---- Stop trigger from parent (auto-play stopped by user) ----
  useEffect(() => {
    const nonce = stopSignal?.nonce ?? 0;
    const targetIdx = stopSignal?.targetIdx;
    if (nonce > 0 && nonce !== lastStopNonceRef.current && (targetIdx == null || targetIdx === index)) {
      lastStopNonceRef.current = nonce;
      resetPlayback();
    }
  }, [stopSignal, index, resetPlayback]);

  // ---- 组件卸载清理 ----
  useEffect(() => () => {
    stopSource();
    stopRAF();
  }, [stopRAF, stopSource]);

  // ---- Click to seek ----
  const handleWaveformClick = useCallback((e) => {
    if (!audioLoaded) {
      // 未加载：点击波形触发懒加载（不自动播放）
      onRequestLoad?.();
      return;
    }
    const canvas = canvasRef.current;
    const d = waveformDataRef.current;
    if (!canvas || !audioBuffer || !d) return;
    const rect = canvas.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = progress * audioBuffer.duration;
    offsetRef.current = seekTime;
    setDisplayTime(seekTime);
    const ctx = canvas.getContext('2d');
    redrawWaveform(ctx, canvas.clientWidth, 52, d.ampArr, d.maxAmp, progress);
    if (playing) playFrom(seekTime);
  }, [audioLoaded, audioBuffer, onRequestLoad, playFrom, playing, redrawWaveform]);

  // ---- Play/Pause ----
  const togglePlay = useCallback(() => {
    if (!audioLoaded) {
      // 未加载：请求加载并在完成后自动播放
      pendingPlayRef.current = true;
      onRequestLoad?.();
      return;
    }
    if (playing) {
      pausePlayback();
    } else {
      playFrom(offsetRef.current);
    }
  }, [audioLoaded, onRequestLoad, pausePlayback, playFrom, playing]);

  const countdownProgress = countdownActive && countdownTotalSeconds > 0
    ? Math.max(0, Math.min(1, 1 - (countdownSeconds || 0) / countdownTotalSeconds))
    : 0;
  const countdownAngle = `${Math.round(countdownProgress * 360)}deg`;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2 w-full">
        <button
          className={`play-btn ${playing ? 'playing' : ''} ${countdownActive ? 'countdown-active' : ''}`}
          onClick={togglePlay}
          title={countdownActive ? 'Waiting' : playing ? 'Pause' : 'Play'}
          style={{ '--countdown-angle': countdownAngle }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="flex-1 h-[52px] rounded-lg bg-[color:var(--waveform-bg)] overflow-hidden cursor-pointer relative transition-shadow hover:shadow-[0_0_0_2px_var(--accent-glow)] self-center" ref={containerRef} onClick={handleWaveformClick}>
          <canvas ref={canvasRef} className="block w-full h-full" />
          {!audioLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              {loadState === 'loading' ? (
                <span className="text-[12px] text-[color:var(--text-secondary)] animate-pulse">加载中…</span>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] rounded-md font-medium text-[color:var(--accent)] bg-[rgba(20,184,166,0.1)] border border-[rgba(15,118,110,0.4)] hover:bg-[rgba(20,184,166,0.18)] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    pendingPlayRef.current = false;
                    onRequestLoad?.();
                  }}
                  title="加载音频波形"
                >
                  {loadState === 'error' ? '加载失败，点击重试' : '▶ 点击加载'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-[color:var(--text-secondary)] text-center tabular-nums">
        {formatTime(displayTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}
