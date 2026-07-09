import React from 'react';

export default function SettingsPanel({ settings, onChange, onClose }) {
  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-panel">
        <h3>自动播放设置</h3>

        <div className="setting-row">
          <label>条目间隔 (秒)</label>
          <input
            type="number"
            min="0.5"
            max="30"
            step="0.5"
            value={settings.gapSeconds}
            onChange={(e) => onChange({ ...settings, gapSeconds: parseFloat(e.target.value) || 2 })}
          />
          <span className="hint">播放下一条前的等待时间</span>
        </div>

        <div className="setting-row">
          <label>翻页间隔 (秒)</label>
          <input
            type="number"
            min="1"
            max="30"
            step="0.5"
            value={settings.pageGapSeconds}
            onChange={(e) => onChange({ ...settings, pageGapSeconds: parseFloat(e.target.value) || 4 })}
          />
          <span className="hint">翻到下一页前的额外等待时间</span>
        </div>

        <div className="setting-row">
          <label>中风险停顿 (秒)</label>
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={settings.mediumRiskPauseSeconds}
            onChange={(e) => onChange({ ...settings, mediumRiskPauseSeconds: parseFloat(e.target.value) || 0 })}
          />
          <span className="hint">遇到中风险时等待用户决定的时间，0 表示立即继续</span>
        </div>

        <div className="setting-row">
          <label>跳过低风险条目</label>
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
          <span className="hint">开启后自动播放时直接跳过已检测为低风险的条目</span>
        </div>

        <button className="btn btn-sm" onClick={onClose} style={{ marginTop: 'auto' }}>
          关闭设置
        </button>
      </div>
    </>
  );
}
