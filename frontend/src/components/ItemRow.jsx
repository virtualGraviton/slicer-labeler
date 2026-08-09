import { useState, useCallback, useRef } from 'react';
import { getAudioUrl } from '../utils/api';
import { parseFilename, formatTime, samplesToTime, getAbsoluteTime, getBilibiliLink } from '../utils/fileNaming';
import WavePlayer from './WavePlayer';

// 模块级音频缓存：同一条目只请求一次，波形解码与播放共用同一份数据（消除重复下载）。
const audioDataCache = new Map(); // entryId -> { blobUrl, buffer }
let sharedAudioCtx = null;
function getAudioContext() {
  if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedAudioCtx;
}

async function loadAudioOnce(entryId) {
  const cached = audioDataCache.get(entryId);
  if (cached) return cached;
  const res = await fetch(getAudioUrl(entryId));
  if (!res.ok) throw new Error(`加载失败 (HTTP ${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  const buffer = await getAudioContext().decodeAudioData(arrayBuf);
  const blobUrl = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/wav' }));
  const data = { blobUrl, buffer };
  audioDataCache.set(entryId, data);
  return data;
}

const BTN_SM_ACCENT = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--accent)] border border-[color:var(--accent)] shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[color:var(--accent-hover)] hover:shadow-[0_6px_20px_var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_AUTO = 'inline-flex items-center justify-center gap-1.5 min-w-[64px] px-2.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--accent)] bg-[rgba(20,184,166,0.08)] border border-[rgba(15,118,110,0.34)] hover:bg-[rgba(20,184,166,0.14)] hover:border-[color:var(--accent)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const BTN_SM_DELETE = 'inline-flex items-center justify-center gap-1.5 min-w-[64px] px-2.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-white bg-[color:var(--danger)] border border-[color:var(--danger)] shadow-[0_4px_14px_var(--danger-glow)] hover:bg-[color:var(--danger-hover)] hover:shadow-[0_6px_20px_var(--danger-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

const TEXTAREA = 'flex-1 bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-lg text-[color:var(--text-primary)] p-2.5 text-sm leading-[1.5] resize-none min-h-[56px] outline-none focus:border-[color:var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)] transition-colors';

const CHIP = 'bg-[color:var(--soft-chip-bg)] px-2 py-0.5 rounded';

export default function ItemRow({
  entry,
  index,
  checked,
  onCheck,
  onTextChange,
  onSplitClick,
  onAudioEnded,
  onAutoPlayFrom,
  onDeleteClick,
  playSignal,
  stopSignal,
  highlight,
  countdownSeconds,
  countdownTotalSeconds,
  showCountdown,
  volume,
  busy = false,
  readOnly = false,
  verified = false,
  onSetVerified,
}) {
  const [loadState, setLoadState] = useState('lazy'); // lazy | loading | loaded | error
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const loadStateRef = useRef('lazy');
  loadStateRef.current = loadState;
  const info = parseFilename(entry.wavPath);

  // 懒加载：手动加载 / 手动播放 / 自动播放等操作触发，加载结果按 entryId 缓存复用
  const requestLoad = useCallback(async () => {
    if (loadStateRef.current === 'loading' || loadStateRef.current === 'loaded') return;
    loadStateRef.current = 'loading';
    setLoadState('loading');
    try {
      const data = await loadAudioOnce(entry.id);
      setAudioBuffer(data.buffer);
      setAudioUrl(data.blobUrl);
      loadStateRef.current = 'loaded';
      setLoadState('loaded');
    } catch (err) {
      loadStateRef.current = 'error';
      setLoadState('error');
      console.error('加载音频失败:', err);
    }
  }, [entry.id]);

  const bilibiliUrl = getBilibiliLink(entry.wavPath);
  const absoluteTime = getAbsoluteTime(entry.wavPath);
  const audioDuration = info ? (info.endSample - info.startSample) / 32000 : 0;

  return (
    <div
      className={`item-row ${checked ? 'selected' : ''} ${highlight ? 'auto-highlight' : ''}`}
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
        <div className="text-[11px] text-[color:var(--text-secondary)] font-medium uppercase tracking-[1px] flex items-center gap-2">
          <span>#{index + 1} &middot; {entry.speaker} &middot; {entry.language}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${verified
            ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
            {verified ? '已完成' : '未完成'}
          </span>
        </div>
        <textarea
          className={TEXTAREA}
          value={entry.text}
          onChange={(e) => onTextChange(index, e.target.value)}
          placeholder={readOnly ? '只读模式（无写权限）' : 'Enter text...'}
          rows={3}
          disabled={busy || readOnly}
          title={busy ? '数据集正在执行任务，文本编辑已锁定' : (readOnly ? '无写权限，只读模式' : undefined)}
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
          loadState={loadState}
          onRequestLoad={requestLoad}
          onEnded={() => onAudioEnded?.(index)}
          playSignal={playSignal}
          stopSignal={stopSignal}
          countdownActive={showCountdown}
          countdownSeconds={countdownSeconds}
          countdownTotalSeconds={countdownTotalSeconds}
          index={index}
          volume={volume}
        />

        <div className="flex flex-wrap gap-2 justify-end items-center pl-10 relative w-full min-w-0 max-[860px]:justify-start">
          <button
            className={BTN_SM_AUTO}
            onClick={() => onSetVerified?.(index, !verified)}
            disabled={busy || readOnly}
            title={busy ? '任务进行中，暂不可标记' : (readOnly ? '无写权限，暂不可标记' : (verified ? '标记为未完成' : '标记为已完成'))}
          >
            {verified ? '取消完成' : '标记完成'}
          </button>
          <button
            className={BTN_SM_AUTO}
            onClick={() => onAutoPlayFrom?.(index)}
            title="从此条目开始自动播放"
          >
            ▶ 连播
          </button>
          <button
            className={BTN_SM_ACCENT}
            onClick={() => onSplitClick(index)}
            disabled={busy || readOnly}
            title={busy ? '任务进行中，暂不可切分' : (readOnly ? '无写权限，暂不可切分' : 'Split Audio')}
          >
            切分
          </button>
          <button
            className={BTN_SM_DELETE}
            onClick={() => onDeleteClick?.(index)}
            disabled={busy || readOnly}
            title={busy ? '任务进行中，暂不可删除' : (readOnly ? '无写权限，暂不可删除' : '删除该条目的音频文件和 ASR 文本记录')}
          >
            删除
          </button>
        </div>
      </div>

    </div>
  );
}
