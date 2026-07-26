import React, { useCallback, useRef } from 'react';

export default function VolumeSlider({ volume, onChange }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const computeVolume = useCallback((e) => {
    const track = trackRef.current;
    if (!track) return volume;
    const rect = track.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, rect.bottom - e.clientY));
    return Math.round((y / rect.height) * 100) / 100;
  }, [volume]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    onChange(computeVolume(e));
  }, [onChange, computeVolume]);

  const handleMouseMove = useCallback((e) => {
    if (!draggingRef.current) return;
    onChange(computeVolume(e));
  }, [onChange, computeVolume]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  React.useEffect(() => {
    const onMove = (e) => handleMouseMove(e);
    const onUp = () => handleMouseUp();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const pct = Math.round(volume * 100);

  return (
    <div className="volume-slider" title={`音量 ${pct}%`}>
      <div className="volume-label">{pct}</div>
      <div
        className="volume-track"
        ref={trackRef}
        onMouseDown={handleMouseDown}
      >
        <div
          className="volume-fill"
          style={{ height: `${pct}%` }}
        />
      </div>
      <div className="volume-icon">🔊</div>
    </div>
  );
}
