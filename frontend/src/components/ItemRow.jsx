import React, { useState, useEffect } from 'react';
import { getAudioUrl } from '../utils/api';
import { parseFilename, formatTime, samplesToTime, getAbsoluteTime, getBilibiliLink } from '../utils/fileNaming';
import WavePlayer from './WavePlayer';

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
    const url = getAudioUrl(entry.wavPath);
    setAudioUrl(url);
  }, [entry.wavPath]);

  useEffect(() => {
    let cancelled = false;
    setAudioBuffer(null);
    const url = getAudioUrl(entry.wavPath);
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
  const textQuality = qualityResult?.text || {};

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

      <div className="item-left">
        <div className="item-index">
          #{index + 1} &middot; {entry.speaker} &middot; {entry.language}
        </div>
        <textarea
          className="item-textarea"
          value={entry.text}
          onChange={(e) => onTextChange(index, e.target.value)}
          placeholder="Enter text..."
          rows={3}
        />
        <div className="audio-info">
          {info && (
            <>
              <span>
                <a href={bilibiliUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-hover)', textDecoration: 'none' }}>
                  {info.bv}-p{info.p}
                </a>
              </span>
              <span>ch{String(info.ch).padStart(3, '0')} ({formatTime(info.chStart)}-{formatTime(info.chEnd)})</span>
            </>
          )}
          <span>S: {info ? samplesToTime(info.startSample) : '-'}</span>
          <span>E: {info ? samplesToTime(info.endSample) : '-'}</span>
          <span>Dur: {audioDuration.toFixed(1)}s</span>
          <span>Abs: {formatTime(absoluteTime)}</span>
        </div>
      </div>

      <div className="item-right">
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

        <div className="item-actions">
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
            className="btn btn-sm auto-from-btn"
            onClick={() => onAutoPlayFrom?.(index)}
            title="从此条目开始自动播放"
          >
            ▶ 连播
          </button>
          <button
            className="btn btn-sm quality-btn"
            onClick={() => onQualityCheck?.(index, true)}
            disabled={qualityLoading}
            title={qualityResult ? '重新检测质量' : '检测质量'}
          >
            {qualityLoading ? '检测中' : qualityResult ? '重检' : '检测'}
          </button>
          <button
            className="btn btn-accent btn-sm"
            onClick={() => onSplitClick(index)}
            title="Split Audio"
          >
            切分
          </button>
          <button
            className="btn btn-danger btn-sm delete-entry-btn"
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
