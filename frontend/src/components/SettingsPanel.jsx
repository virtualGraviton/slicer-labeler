const BTN_SM = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg font-medium cursor-pointer relative overflow-hidden transition-all duration-200 text-[color:var(--text-primary)] bg-[color:var(--card-bg)] border border-[color:var(--card-border)] hover:bg-[color:var(--card-hover)] hover:border-[rgba(15,23,42,0.22)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

export default function SettingsPanel({ settings, onChange, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-[899] bg-[rgba(15,23,42,0.22)]" onClick={onClose} />
      <div className="fixed top-0 right-0 w-[300px] h-full z-[900] p-6 flex flex-col gap-4 bg-[color:var(--panel-bg)] border-l border-[color:var(--card-border)] shadow-[-8px_0_30px_rgba(15,23,42,0.18)] animate-[slideInRight_0.3s_ease]">
        <h3 className="text-lg font-semibold mb-1 text-[color:var(--text-primary)]">自动播放设置</h3>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[color:var(--text-secondary)] uppercase tracking-[0.5px]">条目间隔 (秒)</label>
          <input
            type="number"
            min="0.5"
            max="30"
            step="0.5"
            value={settings.gapSeconds}
            onChange={(e) => onChange({ ...settings, gapSeconds: parseFloat(e.target.value) || 2 })}
            className="bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-md text-[color:var(--text-primary)] px-2.5 py-2 text-sm outline-none transition-colors focus:border-[color:var(--accent)]"
          />
          <span className="text-[11px] text-[color:var(--text-secondary)] opacity-70">播放下一条前的等待时间</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[color:var(--text-secondary)] uppercase tracking-[0.5px]">翻页间隔 (秒)</label>
          <input
            type="number"
            min="1"
            max="30"
            step="0.5"
            value={settings.pageGapSeconds}
            onChange={(e) => onChange({ ...settings, pageGapSeconds: parseFloat(e.target.value) || 4 })}
            className="bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-md text-[color:var(--text-primary)] px-2.5 py-2 text-sm outline-none transition-colors focus:border-[color:var(--accent)]"
          />
          <span className="text-[11px] text-[color:var(--text-secondary)] opacity-70">翻到下一页前的额外等待时间</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[color:var(--text-secondary)] uppercase tracking-[0.5px]">中风险停顿 (秒)</label>
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={settings.mediumRiskPauseSeconds}
            onChange={(e) => onChange({ ...settings, mediumRiskPauseSeconds: parseFloat(e.target.value) || 0 })}
            className="bg-[color:var(--input-bg)] border border-[color:var(--card-border)] rounded-md text-[color:var(--text-primary)] px-2.5 py-2 text-sm outline-none transition-colors focus:border-[color:var(--accent)]"
          />
          <span className="text-[11px] text-[color:var(--text-secondary)] opacity-70">遇到中风险时等待用户决定的时间，0 表示立即继续</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[color:var(--text-secondary)] uppercase tracking-[0.5px]">跳过低风险条目</label>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.skipLowRisk || false}
              onChange={(e) => onChange({ ...settings, skipLowRisk: e.target.checked })}
            />
            <span className="toggle-label">
              {settings.skipLowRisk ? '开启' : '关闭'}
            </span>
          </label>
          <span className="text-[11px] text-[color:var(--text-secondary)] opacity-70">开启后自动播放时直接跳过已检测为低风险的条目</span>
        </div>

        <button className={BTN_SM} onClick={onClose} style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>
          关闭设置
        </button>
      </div>
    </>
  );
}
