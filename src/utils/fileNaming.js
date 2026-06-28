/**
 * New filename format (v2):
 * vocal_{BV}-p{N}_ch{CCC}_{hhmmss_start}_{hhmmss_end}.m4a_10.wav_{start_sample}_{end_sample}.wav
 * Example:
 *   vocal_BV164LD6DEjb-p2_ch002_002004_003959.m4a_10.wav_0000028480_0000119040.wav
 *
 * BV/p are embedded in filename, ch has absolute time range in original audio.
 * No pre-trim or part offset accumulation needed.
 */

const FILENAME_RE = /^vocal_(BV\w+)-p(\d+)_ch(\d+)_(\d{6})_(\d{6})\.m4a_10\.wav_(\d{10})_(\d{10})$/;

/**
 * Parse full metadata from a wav filename.
 */
export function parseFilename(wavPath) {
  const basename = wavPath.split('/').pop().split('\\').pop();
  const name = basename.replace(/\.wav$/i, '');
  const match = name.match(FILENAME_RE);
  if (!match) return null;
  return {
    bv: match[1],
    p: parseInt(match[2], 10),
    ch: parseInt(match[3], 10),
    chStart: hhmmssToSeconds(match[4]),
    chEnd: hhmmssToSeconds(match[5]),
    startSample: parseInt(match[6], 10),
    endSample: parseInt(match[7], 10),
    prefix: `vocal_${match[1]}-p${match[2]}_ch${match[3]}_${match[4]}_${match[5]}.m4a_10.wav`,
  };
}

/**
 * Parse start/end samples from a wav filename (legacy-style lookup).
 */
export function parseSamples(wavPath) {
  const info = parseFilename(wavPath);
  if (!info) return { startSample: 0, endSample: 0 };
  return { startSample: info.startSample, endSample: info.endSample };
}

/**
 * Calculate new filenames after splitting.
 */
export function computeSplitFilenames(wavPath, splitTimeSeconds) {
  const SAMPLE_RATE = 32000;
  const info = parseFilename(wavPath);
  if (!info) return null;

  const basename = wavPath.split('/').pop().split('\\').pop();
  const dir = wavPath.substring(0, Math.max(wavPath.lastIndexOf('/'), wavPath.lastIndexOf('\\')));

  const splitSamples = Math.round(splitTimeSeconds * SAMPLE_RATE);
  const firstStart = info.startSample;
  const firstEnd = info.startSample + splitSamples;
  const secondStart = info.startSample + splitSamples;
  const secondEnd = info.endSample;

  const firstBasename = `${info.prefix}_${String(firstStart).padStart(10, '0')}_${String(firstEnd).padStart(10, '0')}.wav`;
  const secondBasename = `${info.prefix}_${String(secondStart).padStart(10, '0')}_${String(secondEnd).padStart(10, '0')}.wav`;

  return {
    first: dir ? `${dir}/${firstBasename}` : firstBasename,
    second: dir ? `${dir}/${secondBasename}` : secondBasename,
  };
}

/**
 * Calculate new filename after merging multiple entries.
 */
export function computeMergeFilename(wavPaths) {
  const firstInfo = parseFilename(wavPaths[0]);
  const lastInfo = parseFilename(wavPaths[wavPaths.length - 1]);
  if (!firstInfo || !lastInfo) return null;

  const dir = wavPaths[0].substring(0, Math.max(wavPaths[0].lastIndexOf('/'), wavPaths[0].lastIndexOf('\\')));
  const mergedBasename = `${firstInfo.prefix}_${String(firstInfo.startSample).padStart(10, '0')}_${String(lastInfo.endSample).padStart(10, '0')}.wav`;
  return dir ? `${dir}/${mergedBasename}` : mergedBasename;
}

/**
 * Compute absolute time in original video (seconds).
 */
export function getAbsoluteTime(wavPath) {
  const info = parseFilename(wavPath);
  if (!info) return 0;
  return info.chStart + info.startSample / 32000;
}

/**
 * Compute Bilibili link for this slice.
 */
export function getBilibiliLink(wavPath) {
  const info = parseFilename(wavPath);
  if (!info) return '';
  const t = Math.floor(info.chStart + info.startSample / 32000);
  return `https://www.bilibili.com/video/${info.bv}?t=${t}&p=${info.p}`;
}

/**
 * Format sample count to time string.
 */
export function samplesToTime(samples) {
  const totalSec = samples / 32000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const ms = Math.floor((totalSec % 1) * 1000);
  return `${min}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Format seconds to time string.
 */
export function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${min}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function hhmmssToSeconds(s) {
  const hh = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10);
  const ss = parseInt(s.slice(4, 6), 10);
  return hh * 3600 + mm * 60 + ss;
}
