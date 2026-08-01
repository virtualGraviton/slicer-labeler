import { useState, useEffect } from 'react';
import { getAudioUrl } from '../utils/api';
import { parseFilename, formatTime, samplesToTime, getAbsoluteTime, getBilibiliLink } from '../utils/fileNaming';
import WavePlayer from './WavePlayer';

const BTN_SM = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_ACCENT = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--accent)] border border-[color:var(--accent)] shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[color:var(--accent-hover)] hover:shadow-[0_6px_20px_var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_AUTO = 'inline-flex items-center justify-center gap-1.5 min-w-[64px] px-2.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--accent)] bg-[rgba(20,184,166,0.08)] border border-[rgba(15,118,110,0.34)] hover:bg-[rgba(20,184,166,0.14)] hover:border-[color:var(--accent)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_QUALITY = 'inline-flex items-center justify-center gap-1.5 min-w-[64px] px-2.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_DELETE = 'inline-flex items-center justify-center gap-1.5 min-w-[64px] px-2.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--danger)] border border-[color:var(--danger)] shadow-[0_4px_14px_var(--danger-glow)] hover:bg-[color:var(--danger-hover)] hover:shadow-[0_6px_20px_var(--danger-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const TEXTAREA = 'flex-1 bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-lg text-[color:var(--text-primary)] p-2.5 text-sm leading-[1.5] resize-none min-h-[56px] outline-none focus:border-[color:var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)] transition-colors';

const CHIP = 'bg-[color:var(--soft-chip-bg)] px-2 py-0.5 rounded';

function formatMs(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${Math.round(num)}ms` : '-';
}

function formatDb(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}dB` : '-';
}

function formatPercent(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${Math.round(num * 100)}%` : '-';
}

export default function ItemRow({
  entry,
  index,
  checked,
  onCheck,
  onTextChange,
  onSplitClick,
  onAudioEnded,
  onPlaybackStart,
  onQualityCheck,
  onAutoPlayFrom,
  onDeleteClick,
  playSignal,
  stopSignal,
  highlight,
  riskAlert,
  countdownSeconds,
  countdownTotalSeconds,
  showCountdown,
  preferPopoverBelow,
  volume,
  qualityResult,
  qualityLoading,
}) {
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const info = parseFilename(entry.wavPath);

  useEffect(() => {
    const url = getAudioUrl(entry.id);
    setAudioUrl(url);
  }, [entry.id]);

  useEffect(() => {
    let cancelled = false;
    setAudioBuffer(null);
    const url = getAudioUrl(entry.id);
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((arrayBuf) => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(arrayBuf);
      })
      .then((buf) => {
        if (!cancelled) setAudioBuffer(buf);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.wavPath]);

  const bilibiliUrl = getBilibiliLink(entry.wavPath);
  const absoluteTime = getAbsoluteTime(entry.wavPath);
  const audioDuration = info ? (info.endSample - info.startSample) / 32000 : 0;
  const riskLabel = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
    unknown: '待确认',
  };
  const risk = qualityResult?.risk || 'unknown';
  const qualityTitle = qualityResult
    ? qualityResult.summary || qualityResult.error || '质量检测完成'
    : '尚未检测';
  const qualityReasons = Array.isArray(qualityResult?.reasons)
    ? qualityResult.reasons.filter(Boolean).slice(0, 4)
    : [];
  const audioQuality = qualityResult?.audio || {};
  const textQuality = qualityResult?.text_risk || {};

  return (
    <div
      className={`item-row ${checked ? 'selected' : ''} ${highlight ? 'auto-highlight' : ''} ${riskAlert ? `risk-alert risk-alert-${risk}` : ''}`}
      data-global-idx={index}
    >
      <div className="item-checkbox">
        <label>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(index, e.target.checked)}
          />
          <span className="custom-check">{checked ? '\u2713' : ''}</span>
        </label>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="text-[11px] text-[color:var(--text-secondary)] font-medium uppercase tracking-[1px]">
          #{index + 1} &middot; {entry.speaker} &middot; {entry.language}
        </div>
        <textarea
          className={TEXTAREA}
          value={entry.text}
          onChange={(e) => onTextChange(index, e.target.value)}
          placeholder="Enter text..."
          rows={3}
        />
        <div className="text-[11px] text-[color:var(--text-secondary)] flex gap-3 flex-wrap">
          {info && (
            <>
              <span className={CHIP}>
                <a href={bilibiliUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-hover)', textDecoration: 'none' }}>
                  {info.bv}-p{info.p}
                </a>
              </span>
              <span className={CHIP}>ch{String(info.ch).padStart(3, '0')} ({formatTime(info.chStart)}-{formatTime(info.chEnd)})</span>
            </>
          )}
          <span className={CHIP}>S: {info ? samplesToTime(info.startSample) : '-'}</span>
          <span className={CHIP}>E: {info ? samplesToTime(info.endSample) : '-'}</span>
          <span className={CHIP}>Dur: {audioDuration.toFixed(1)}s</span>
          <span className={CHIP}>Abs: {formatTime(absoluteTime)}</span>
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <WavePlayer
          audioUrl={audioUrl}
          audioBuffer={audioBuffer}
          onEnded={() => onAudioEnded?.(index)}
          onPlay={() => onPlaybackStart?.(index)}
          playSignal={playSignal}
          stopSignal={stopSignal}
          countdownActive={showCountdown}
          countdownSeconds={countdownSeconds}
          countdownTotalSeconds={countdownTotalSeconds}
          index={index}
          volume={volume}
        />

        <div className="flex flex-wrap gap-2 justify-end items-center pl-10 relative w-full min-w-0 max-[860px]:justify-start">
          {qualityResult && (
            <div className={`quality-badge-wrap ${preferPopoverBelow ? 'quality-badge-wrap-below' : ''}`}>
              <div
                className={`quality-badge quality-${risk}`}
                tabIndex={0}
                aria-label={qualityTitle}
              >
                {riskLabel[risk] || '待确认'}
              </div>
              <div className={`quality-popover quality-popover-${risk}`} role="tooltip">
                <div className="quality-popover-head">
                  <span className={`quality-badge quality-${risk}`}>{riskLabel[risk] || '待确认'}</span>
                  <span>{qualityResult.status === 'error' ? '检测失败' : '质量检测'}</span>
                </div>
                <div className="quality-popover-summary">{qualityTitle}</div>
                {qualityReasons.length > 0 && (
                  <ul className="quality-popover-reasons">
                    {qualityReasons.map((reason, reasonIndex) => (
                      <li key={reasonIndex}>{reason}</li>
                    ))}
                  </ul>
                )}
                {qualityResult.status === 'ok' && (
                  <>
                    <div className="quality-popover-grid">
                      <span>句首静音</span>
                      <strong>{formatMs(audioQuality.leadingSilenceMs)}</strong>
                      <span>尾部静音</span>
                      <strong>{formatMs(audioQuality.trailingSilenceMs)}</strong>
                      <span>尾部均值</span>
                      <strong>{formatDb(audioQuality.tailMeanDb)}</strong>
                      <span>尾部峰值</span>
                      <strong>{formatDb(audioQuality.tailMaxDb)}</strong>
                    </div>
                    <div className="quality-popover-text">
                      <span>文本完整：{textQuality.textComplete ? '是' : '否'}</span>
                      <span>建议合并：{textQuality.shouldMergeNext ? '是' : '否'}</span>
                      <span>置信度：{formatPercent(textQuality.confidence)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <button
            className={BTN_SM_AUTO}
            onClick={() => onAutoPlayFrom?.(index)}
            title="从此条目开始自动播放"
          >
            ▶ 连播
          </button>
          <button
            className={BTN_SM_QUALITY}
            onClick={() => onQualityCheck?.(index, true)}
            disabled={qualityLoading}
            title={qualityResult ? '重新检测质量' : '检测质量'}
          >
            {qualityLoading ? '检测中' : qualityResult ? '重检' : '检测'}
          </button>
          <button
            className={BTN_SM_ACCENT}
            onClick={() => onSplitClick(index)}
            title="Split Audio"
          >
            切分
          </button>
          <button
            className={BTN_SM_DELETE}
            onClick={() => onDeleteClick?.(index)}
            title="删除该条目的音频文件和 ASR 文本记录"
          >
            删除
          </button>
        </div>
      </div>

    </div>
  );
}
