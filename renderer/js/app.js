import { bridge, isMock, isAndroid } from './bridge.js';
import { AudioEngine } from './audio-engine.js';
import { Ambient } from './ambient.js';
import { Visualizer, WaveSeek } from './visualizer.js';
import { analyzeTrack } from './analysis.js';
import { Tools } from './tools.js';
import { Layout } from './layout.js';
import { attachTrackDrag } from './dragdrop.js';
import { BackgroundFX } from './bg.js';
import { Shapes } from './shapes.js';
import { DeepView } from './deepview.js';
import { VisualMode } from './visual.js';
import { findSimilar, buildSession, healthReport, fixMojibake, titleFromPath, analyzed, quality, MOODS } from './smart.js';
import { runSplash } from './splash.js';
import { search as fuzzySearch } from './fuzzy.js';
import { createLibraryRepair } from './library-repair.js';
import { createAppearance } from './appearance.js';
import { createTrim } from './trim.js';
import { createTour, WELCOME } from './tour.js';
import { captureState, describe, renderProcessed, encodeWav, encodeMp3 } from './exporter.js';
import { ICON } from './icons.js';
import { hash } from './ui.js';
import { t as tr, tn, setLang, getLang, detectLang, applyStatic, LANGS } from './i18n.js';
import { JAMENDO_CLIENT_ID } from './keys.js';
import { $, $$, h, esc, fmt, fmtLong, plural, debounce, genArt, toast, ctxMenu, openModal, closeModal, clamp, uid, dragValue, popover, closePopover, closeCtx } from './ui.js';

/* ================================ state ================================ */
const DEFAULTS = {
  theme: 'soft', volume: .8, chime: true, jamendoClientId: '', sort: 'added',
  pitch: { semi: 0, cents: 0, vinyl: false, on: true },
  ambient: { depth: .7, sens: .5, master: .8, levels: { rain: .55, ocean: .55, vinyl: .45, fire: .5, train: .5 } },
  eq: { on: true, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pre: 0, preset: 'flat' },
  layout: null, bgAnalyze: true, exportFormat: 'mp3', exportAdd: true, tourDone: false, crossfade: 0, normalize: true, outputId: '', globalKeys: true, miniTop: true, discord: false, discordId: '',
  fx: { tempo: 1, reverb: { on: false, room: 'hall', mix: .3 } }, showcaseDone: false, lyricsOnline: true,
  look: { accent: 'theme', fx: 'live', blur: 'normal', bgList: [], bgActive: null, bgDim: 'soft' }
};
const THEMES = [
  { key: 'soft', tone: 'light', name: 'th.soft', desc: 'th.soft.d', bg: 'linear-gradient(170deg,#9fc6f2,#eef5fd)', p: '#ffffffaa', a: '#1f45e8', t: '#0a1450' },
  { key: 'deep', tone: 'dark', name: 'th.deep', desc: 'th.deep.d', bg: 'radial-gradient(circle at 60% 55%,#2a2140,#040406 70%)', p: '#ffffff10', a: '#8f7bff', t: '#f3f3f7' },
  { key: 'pearl', tone: 'light', name: 'th.pearl', desc: 'th.pearl.d', bg: 'linear-gradient(160deg,#e3d8f6,#fbf9fd 60%,#dff0f6)', p: '#ffffffaa', a: '#6c45e0', t: '#1c1336' },
  { key: 'obsidian', tone: 'dark', name: 'th.obsidian', desc: 'th.obsidian.d', bg: 'radial-gradient(circle at 55% 50%,#3a3b40,#050505 68%)', p: '#ffffff10', a: '#d9dce4', t: '#f2f2f3' }
];
/** themes from older versions map onto the closest new one */
const LEGACY_THEME = { runner: 'pearl', night: 'obsidian', aurora: 'deep', hifi: 'obsidian' };
const toneOf = (k) => (THEMES.find((t) => t.key === k) || THEMES[0]).tone;
const S = {
  tracks: [], byId: new Map(), playlists: [], queue: [], qi: -1, origQueue: null,
  shuffle: false, repeat: 'off', settings: structuredClone(DEFAULTS), view: { type: 'library' },
  current: null, selected: new Set(), lastPos: 0, history: []
};
const engine = new AudioEngine();
const ambient = new Ambient(engine);
let viz, wave, tools, layout, bg, deep, visual, shapes, tour, repair, look, trim;
const ECO = document.documentElement.classList.contains('eco');   // economy mode, fixed for this start (early.js)
const reducedMotion = () => ECO || matchMedia('(prefers-reduced-motion: reduce)').matches;
const preview = new Audio();

const index = () => { S.byId = new Map(S.tracks.map((t) => [t.id, t])); };
/** tracks played straight from the web search: not in the library, gone after a restart */
const streams = new Map();
const T = (id) => S.byId.get(id) || streams.get(id);
const art = (t) => (t && t.cover ? `url("${bridge.mediaUrl(t.cover)}") center/cover` : genArt(t ? t.id + t.album : 'x'));
const artistOf = (t) => t.artist || tr('unknownArtist');

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? merge(base[k], v) : v;
  return out;
}
async function loadState() {
  const d = await bridge.store.load();
  if (d) {
    S.tracks = d.tracks || []; S.playlists = d.playlists || [];
    S.settings = merge(DEFAULTS, d.settings); S.queue = d.queue || []; S.qi = d.qi ?? -1;
    S.shuffle = !!d.shuffle; S.repeat = d.repeat || 'off'; S.lastPos = d.lastPos || 0; S.history = d.history || [];
  }
  index();
  const curId = S.queue[S.qi], kept = S.queue.slice(0, Math.max(0, S.qi)).filter((id) => S.byId.has(id)).length;
  S.queue = S.queue.filter((id) => S.byId.has(id));
  S.qi = curId && S.byId.has(curId) ? kept : Math.min(S.qi, S.queue.length - 1);
}
const save = debounce(() => bridge.store.save({
  v: 1, tracks: S.tracks, playlists: S.playlists, settings: S.settings, queue: S.queue, qi: S.qi,
  shuffle: S.shuffle, repeat: S.repeat, lastPos: engine.time, history: S.history.slice(-1000)
}), 500);
setInterval(() => { if (engine.playing) save(); }, 15000);
// last-moment save (quit from the tray, window reload): skip the debounce
addEventListener('pagehide', () => save.flush && save.flush());

/* ============================== library ops ============================== */
async function importPaths(paths) {
  if (!paths || !paths.length) return;
  const t = toast(tr('toast.reading', { files: tn('files', paths.length) }), { timeout: 0 });
  let probed = [];
  try { probed = await bridge.library.probe(paths); }
  catch (e) { console.error(e); toast(tr('toast.importFail', { msg: e.message || e })); return; }
  finally { t.close(); }
  const added = [];
  // Windows paths ignore letter case: «C:\Music\a.mp3» and «c:\music\A.MP3» are one file
  const key = (p) => (/^[a-z]:[\\/]/i.test(p) ? p.toLowerCase() : p);
  const byPath = new Map(S.tracks.map((x) => [key(x.path), x]));
  for (const tr of probed) {
    const ex = T(tr.id) || byPath.get(key(tr.path));
    if (ex) {
      tr.id = ex.id; tr.path = ex.path; // the same file under another spelling stays the track it was
      // re-import refreshes the file data but keeps everything the user set by hand
      const keep = {};
      for (const k of ex.edited || []) keep[k] = ex[k];
      Object.assign(ex, { ...tr, addedAt: ex.addedAt, bpm: ex.bpmManual ? ex.bpm : ex.bpm || tr.bpm, peaks: ex.peaks, cover: ex.customCover ? ex.cover : tr.cover, plays: ex.plays, lastPlayed: ex.lastPlayed }, keep);
      continue;
    }
    S.tracks.push(tr); added.push(tr.id); byPath.set(key(tr.path), tr);
  }
  index(); save(); renderSidebar();
  if (['library', 'recent'].includes(S.view.type)) render(false);
  if (added.length) importToast(added);
  if (added.length && repair) setTimeout(() => repair.suggestAfterImport(added), 1400);
  else if (probed.length) toast(tr('toast.exists'));
  else toast(tr('toast.noAudio'));
  return probed.map((x) => x.id);
}
/** files opened from Explorer ("Open with", double-click): add them and start playing */
async function openFiles(files) {
  const ids = await importPaths(files);
  if (ids && ids.length) playFrom(ids, 0);
}

function importToast(ids, verb = tr('toast.added')) {
  const chips = h('div', { class: 'tchips' });
  const mk = (pl) => {
    const b = h('button', { class: 'tchip' }, pl.name);
    b.onclick = () => { addToPlaylist(pl.id, ids, true); b.classList.add('done'); b.textContent = '✓ ' + pl.name; };
    return b;
  };
  [...S.playlists].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4).forEach((pl) => chips.append(mk(pl)));
  const nb = h('button', { class: 'tchip' }, tr('toast.newPl'));
  nb.onclick = () => { const pl = createPlaylist(defaultPlName(), ids); nb.replaceWith(h('button', { class: 'tchip done' }, tr('toast.newPlDone'))); startRename(pl.id); };
  chips.append(nb);
  toast(h('span', {}, `${verb}: ${tn('tracks', ids.length)} `, h('small', {}, tr('toast.toPl'))), { timeout: 10000, actions: chips });
}

function removeFromLibrary(ids) {
  const set = new Set(ids);
  S.tracks = S.tracks.filter((t) => !set.has(t.id));
  S.playlists.forEach((p) => (p.trackIds = p.trackIds.filter((id) => !set.has(id))));
  const cur = S.queue[S.qi];
  const curGone = set.has(cur);
  // where the queue continues: the first surviving track at or after the removed current one
  const before = S.queue.slice(0, Math.max(0, S.qi)).filter((id) => !set.has(id)).length;
  S.queue = S.queue.filter((id) => !set.has(id));
  if (S.origQueue) S.origQueue = S.origQueue.filter((id) => !set.has(id));
  ids.forEach((id) => S.selected.delete(id));
  index();
  if (curGone) {
    const was = engine.playing;
    engine.unload();
    S.current = null;
    if (before < S.queue.length) { S.qi = before; loadCurrent(was); } // the music simply moves on
    else { S.qi = S.queue.length ? S.queue.length - 1 : -1; if (S.qi >= 0) loadCurrent(false); else clearNowPlaying(); }
  } else S.qi = cur ? before : -1;
  save(); renderSidebar(); render(false); renderUpNext(); renderCounts();
  toast(tn('toast.removedN', ids.length));
}
/** empty "Now playing" when nothing is left to play */
function clearNowPlaying() {
  $('#cover').style.background = ''; $('#deckCover').style.background = '';
  $('#npTitle').textContent = tr('np.none'); $('#npArtist').textContent = tr('np.hint');
  $('#deckTitle').textContent = '—'; $('#deckArtist').textContent = '';
  $('#npBadges').innerHTML = ''; wave.set(null); $('#seek').classList.remove('has-wave');
  document.title = 'Soft&Deep Sound';
  bindMedia.push && bindMedia.push();
}

/* ============================== playlists ============================== */
const defaultPlName = () => { let n = S.playlists.length + 1; while (S.playlists.some((p) => p.name === tr('pl.default', { n }))) n++; return tr('pl.default', { n }); };
function createPlaylist(name, ids = []) {
  const pl = { id: uid(), name, trackIds: [...new Set(ids)], createdAt: Date.now(), updatedAt: Date.now() };
  S.playlists.push(pl); save(); renderSidebar();
  return pl;
}
function addToPlaylist(pid, ids, quiet) {
  const pl = S.playlists.find((p) => p.id === pid);
  if (!pl) return;
  const before = pl.trackIds.length;
  for (const id of ids) if (!pl.trackIds.includes(id)) pl.trackIds.push(id);
  pl.updatedAt = Date.now(); save(); renderSidebar();
  if (S.view.type === 'playlist' && S.view.id === pid) render(false);
  const n = pl.trackIds.length - before;
  if (!quiet) toast(n ? tr('pl.added', { name: pl.name, n }) : tr('pl.already', { name: pl.name }));
  flashPlaylist(pid);
}
function flashPlaylist(pid) {
  const el = $(`.pl-item[data-id="${pid}"]`);
  if (!el) return;
  el.animate([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 900, easing: 'ease-out' });
}
function deletePlaylist(pid) {
  const pl = S.playlists.find((p) => p.id === pid);
  if (!pl) return;
  S.playlists = S.playlists.filter((p) => p.id !== pid); save(); renderSidebar();
  if (S.view.type === 'playlist' && S.view.id === pid) setView({ type: 'library' });
  toast(tr('pl.deleted', { name: pl.name }));
}
function plArt(pl, cls = 'pl-art') {
  if (pl.cover) return h('div', { class: cls + ' single', style: { background: `url("${bridge.mediaUrl(pl.cover)}") center/cover` } });
  const ts = pl.trackIds.map(T).filter(Boolean);
  const withCover = ts.filter((t) => t.cover);
  if (withCover.length >= 4) return h('div', { class: cls }, ...withCover.slice(0, 4).map((t) => h('div', { style: { background: art(t) } })));
  return h('div', { class: cls + ' single', style: { background: ts[0] ? art(ts[0]) : genArt(pl.id) } });
}

/* ============================== playback ============================== */
async function playFrom(list, idx) {
  if (!list.length) return;
  S.queue = [...list]; S.qi = idx; S.origQueue = null;
  if (S.shuffle) applyShuffle(true);
  await loadCurrent(true);
}
let loadFails = 0;
/**
 * Loudness normalisation: every track is brought to about −14 LUFS (streaming level), never pushed
 * past its own peak. Tracks not analysed yet play as they are; the gain glides in once measured.
 */
function normGain(t) {
  if (!S.settings.normalize || !t || t.lufs == null || !isFinite(t.lufs)) return 0;
  let db = clamp(-14 - t.lufs, -12, 8);
  if (t.peakDb != null && isFinite(t.peakDb)) db = Math.min(db, -t.peakDb - 1);
  return Math.round(db * 10) / 10;
}
async function loadCurrent(autoplay = true, at = 0, crossfade = 0) {
  const t = T(S.queue[S.qi]);
  if (!t) return;
  S.current = t; t.lastPlayed = Date.now();
  updateNowPlaying(t);
  markPlayingRows();
  renderUpNext();
  wave.set(t.peaks || null);
  $('#seek').classList.toggle('has-wave', !!t.peaks);
  try { await engine.load(bridge.mediaUrl(t.path), { autoplay, at, crossfade, gainDb: normGain(t) }); loadFails = 0; }
  catch (e) {
    if (e && e.name === 'AbortError') return; // superseded by another track
    toast(tr('toast.openFail', { title: t.title }));
    // a missing/broken file shouldn't stop the music: move on (but never loop forever)
    if (autoplay && ++loadFails < Math.min(5, S.queue.length) && S.qi < S.queue.length - 1) { S.qi++; return loadCurrent(true); }
    loadFails = 0;
    if (!engine.playing) engine.dispatchEvent(new Event('pause')); // nothing plays: the UI must say so too
    return;
  }
  if (!t.stream) analyze(t);
  deep && deep.update();
  save();
}
function next(auto = false, crossfade = 0) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') { engine.seek(0); engine.play(); return; }
  if (S.qi < S.queue.length - 1) S.qi++;
  else if (S.repeat === 'all' || !auto) S.qi = 0;
  else { engine.pause(); engine.seek(0); return; }
  loadCurrent(true, 0, crossfade);
}
function prev() {
  if (engine.time > 3 || !S.queue.length) return engine.seek(0);
  S.qi = S.qi > 0 ? S.qi - 1 : (S.repeat === 'all' ? S.queue.length - 1 : 0);
  loadCurrent(true);
}
function togglePlay() {
  if (!S.current) {
    const list = sortedLibrary().map((t) => t.id);
    if (list.length) playFrom(list, 0);
    return;
  }
  if (engine.broken && !engine.loading) { loadCurrent(true); return; }
  engine.toggle();
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function applyShuffle(on) {
  const cur = S.queue[S.qi];
  if (on) {
    S.origQueue = [...S.queue];
    const rest = S.queue.filter((_, i) => i !== S.qi);
    S.queue = cur ? [cur, ...shuffleArr(rest)] : shuffleArr(rest);
    S.qi = cur ? 0 : -1;
  } else if (S.origQueue) {
    // original order, minus what was removed, plus anything queued while shuffled
    const live = new Set(S.queue);
    const base = S.origQueue.filter((id) => live.has(id));
    const baseSet = new Set(base);
    S.queue = base.concat(S.queue.filter((id) => !baseSet.has(id)));
    S.origQueue = null; S.qi = cur ? S.queue.indexOf(cur) : -1;
  }
}
function playNext(ids) {
  if (S.qi < 0) { playFrom(ids, 0); return; }
  S.queue.splice(S.qi + 1, 0, ...ids); if (S.origQueue) S.origQueue.push(...ids); renderUpNext(); renderCounts(); save();
  toast(ids.length > 1 ? tn('toast.nextMany', ids.length) : tr('toast.nextOne'));
}
function enqueue(ids) {
  if (S.qi < 0) { playFrom(ids, 0); return; }
  S.queue.push(...ids); if (S.origQueue) S.origQueue.push(...ids); renderUpNext(); renderCounts(); save();
  toast(tr('toast.enq', { n: ids.length }));
}

const ANALYSIS_FIELDS = ['key', 'keyTonic', 'keyMinor', 'camelot', 'keyConf', 'lufs', 'peakDb', 'plr', 'energy', 'bass', 'vocal', 'bright'];
const analyzing = new Map();
/** decode + analyse once (shared between playback, Deep View and the background queue) */
function runAnalysis(t) {
  if (analyzing.has(t.id)) return analyzing.get(t.id);
  const job = analyzeTrack(bridge.mediaUrl(t.path)).then((res) => {
    t.peaks = res.peaks;
    if (!t.bpmManual && res.bpm) t.bpm = res.bpm;
    t.bpmConf = res.confidence; t.beatOffset = res.offset;
    for (const k of ANALYSIS_FIELDS) t[k] = res[k];
    t.av = res.av;
    save();
    if (S.current === t) { wave.set(t.peaks); $('#seek').classList.add('has-wave'); renderBadges(); setBeat(t); engine.setTrackGain(normGain(t)); }
    const row = $(`.row[data-id="${t.id}"] .r-bpm`);
    if (row && t.bpm) row.innerHTML = `<b>${Math.round(t.bpm)}</b>`;
    deep && deep.update();
    onAnalysisProgress();
  }).catch((e) => { console.warn('analysis failed', t.path, e); t.av = -1; t.bpmConf = t.bpmConf ?? 0; save(); })
    .finally(() => analyzing.delete(t.id));
  analyzing.set(t.id, job);
  return job;
}
async function analyze(t) {
  if (analyzed(t) || t.av === -1) return;
  await new Promise((r) => setTimeout(r, 450)); // let playback settle first
  if (S.current === t) return runAnalysis(t);
}
/** slow background pass over the library so Similar / Smart Session have data */
let bgBusy = false;
async function backgroundAnalyze(force = false) {
  if (bgBusy || (!S.settings.bgAnalyze && !force)) return;
  bgBusy = true;
  try {
    for (;;) {
      const t = S.tracks.find((x) => !analyzed(x) && x.av !== -1 && !analyzing.has(x.id));
      if (!t || (!S.settings.bgAnalyze && !force)) break;
      await runAnalysis(t);
      await new Promise((r) => setTimeout(r, engine.playing ? 1400 : 500));
    }
  } finally { bgBusy = false; onAnalysisProgress(); }
}
function onAnalysisProgress() {
  const el = $('#healthAnalyze');
  if (el) { const n = S.tracks.filter(analyzed).length; el.textContent = tr('h.analyzed', { n, total: S.tracks.length }); el.parentElement.querySelector('.hbar i').style.width = (n / Math.max(1, S.tracks.length) * 100) + '%'; }
}
/** backfill bitrate / sample rate for tracks imported before v1.4 */
async function ensureFormat(list) {
  const need = (Array.isArray(list) ? list : [list]).filter((t) => t && t.bitrate === undefined && t.path && !String(t.path).startsWith('demo:'));
  if (!need.length || !bridge.library.formatInfo) return;
  for (let i = 0; i < need.length; i += 400) { // in chunks, so huge libraries are covered completely
    const part = need.slice(i, i + 400);
    let info = {};
    try { info = await bridge.library.formatInfo(part.map((t) => t.path)); } catch { continue; }
    for (const t of part) {
      if (!(t.path in info)) continue; // not processed — try again later
      const f = info[t.path];
      if (f) { for (const [k, v] of Object.entries(f)) if (v !== undefined && t[k] === undefined) t[k] = v; } else t.bitrate = null;
    }
  }
  save();
}
/* listening history: a play counts after 30 s (or half of a short track) */
let countedFor = null;
setInterval(() => {
  const t = S.current;
  if (!t || !engine.playing || countedFor === t.id + ':' + t.lastPlayed) return;
  if (engine.time >= Math.min(30, (engine.duration || 60) * 0.5)) {
    countedFor = t.id + ':' + t.lastPlayed;
    t.plays = (t.plays || 0) + 1;
    S.history.push(t.id);
    if (S.history.length > 1000) S.history.splice(0, S.history.length - 1000);
    save();
  }
}, 1000);

/* ======================== cover-driven glow colour ======================== */
const colorCache = new Map();
function hslToRgb(hh, ss, ll) {
  const k = (n) => (n + hh / 30) % 12, a = ss * Math.min(ll, 1 - ll);
  const f = (n) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, sat, l];
}
/** Dominant *vivid* colour of the artwork: hue histogram weighted by saturation × brightness. */
function coverColor(t) {
  if (!t) return Promise.resolve(null);
  if (!t.cover) { const hue = 200 + (hash(t.id + t.album) % 46); return Promise.resolve(hslToRgb(hue + 8, .7, .58)); }
  if (colorCache.has(t.cover)) return Promise.resolve(colorCache.get(t.cover));
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => res(null);
    img.onload = () => {
      try {
        const N = 40, c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const bins = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        let total = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          if (ss < .18 || ll < .12 || ll > .92) continue;          // skip greys, near-black, near-white
          const w = ss * (1 - Math.abs(ll - .5) * 1.6);
          const bin = bins[Math.floor(hh / 20) % 18];
          bin.w += w; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w; total += w;
        }
        const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
        if (total < 8 || best.w < 2) { colorCache.set(t.cover, null); return res(null); } // monochrome cover → theme accent
        const [hh, ss, ll] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
        const rgb = hslToRgb(hh, Math.min(.95, Math.max(.6, ss)), Math.min(.64, Math.max(.5, ll))); // make it glow-worthy
        colorCache.set(t.cover, rgb); res(rgb);
      } catch { res(null); }
    };
    img.src = bridge.mediaUrl(t.cover);
  });
}
async function applyPulse(t) {
  const rgb = await coverColor(t);
  if (t !== S.current) return;
  const els = [$('.bass-glow'), $('.play-bezel'), $('#coverFrame')];
  for (const el of els) rgb ? el.style.setProperty('--pulse', `rgb(${rgb.join(',')})`) : el.style.removeProperty('--pulse');
  bg && bg.setPulse(rgb);
  look && look.onTrack(t);
}

/* ============================== now playing ============================== */
function updateNowPlaying(t) {
  const cover = $('#cover');
  const prevBg = cover.style.background;
  cover.style.background = art(t);
  if (prevBg && prevBg !== cover.style.background && !reducedMotion()) {
    // old artwork shrinks and dissolves, the new one resolves from a soft blur underneath
    $$('.cover-ghost').forEach((g) => g.remove());
    const ghost = h('div', { class: 'cover cover-ghost', style: { background: prevBg } });
    cover.after(ghost);
    ghost.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.9)', filter: 'blur(12px)' }],
      { duration: 460, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).finished.then(() => ghost.remove(), () => ghost.remove());
    cover.animate([{ opacity: .3, transform: 'scale(1.04)', filter: 'blur(14px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
      { duration: 700, delay: 60, easing: 'cubic-bezier(.22,.9,.26,1)', fill: 'backwards' });
  }
  $('#deckCover').style.background = art(t);
  const meta = $('.np-meta');
  meta.classList.remove('swap'); void meta.offsetWidth; meta.classList.add('swap');
  $('#npTitle').textContent = t.title; $('#npArtist').textContent = artistOf(t) + (t.album ? ' — ' + t.album : '');
  $('#deckTitle').textContent = t.title; $('#deckArtist').textContent = artistOf(t);
  document.title = `${t.title} · Soft&Deep Sound`;
  setBeat(t);
  visual && visual.update();
  bindMedia.push && bindMedia.push();
  renderBadges();
  applyPulse(t);
}
/** the "playing" LED breathes at the track's tempo */
function setBeat(t) { document.documentElement.style.setProperty('--beat', (60 / Math.min(180, Math.max(60, (t && t.bpm) || 96))).toFixed(3) + 's'); }
function renderBadges(state) {
  const t = S.current, el = $('#npBadges');
  el.innerHTML = '';
  if (!t) return;
  el.append(h('span', { class: 'badge' }, t.format || 'AUDIO'));
  if (t.bpm) el.append(h('span', { class: 'badge acc' }, `${Math.round(t.bpm * (engine.vinyl ? engine.rate : 1))} BPM`));
  if (engine.pitchOn && (engine.semitones || engine.cents)) el.append(h('span', { class: 'badge acc' }, `PITCH ${engine.semitones > 0 ? '+' : ''}${engine.semitones} st`));
  if (ambient.anyOn) el.append(h('span', { class: 'badge' }, 'AMBIENT'));
  if (engine.eqOn && engine.eqGains.some((g) => g)) el.append(h('span', { class: 'badge' }, 'EQ'));
}
function renderUpNext() {
  const box = $('#upNext');
  box.innerHTML = '';
  const ids = S.queue.slice(S.qi + 1, S.qi + 8);
  if (!ids.length) { box.append(h('div', { class: 'pl-empty' }, tr('np.queueEmpty'))); return; }
  ids.forEach((id, i) => {
    const t = T(id); if (!t) return;
    box.append(h('div', { class: 'un-item', style: { '--i': i }, onClick: () => { S.qi = S.qi + 1 + i; loadCurrent(true); } },
      h('div', { class: 'thumb', style: { background: art(t) } }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, artistOf(t))),
      h('div', { class: 'd' }, fmt(t.duration))));
  });
  renderCounts();
}
function markPlayingRows() {
  $$('.row.playing').forEach((r) => r.classList.remove('playing'));
  if (S.current) $$(`.row[data-id="${S.current.id}"]`).forEach((r) => r.classList.add('playing'));
  markWebRows();
}
/** the web result that is playing shows a pause button; the others a play button */
function markWebRows() {
  const cur = S.current && S.current.stream ? S.current.id : null;
  $$('.web-row').forEach((row) => {
    const on = cur === 'web:' + row.dataset.wid, b = row.querySelector('.web-play');
    row.classList.toggle('playing', on);
    if (b) { const pause = on && engine.playing; b.classList.toggle('on', on); b.innerHTML = pause ? ICON.pause : ICON.play; b.title = tr(pause ? 'w.pause' : 'w.listen'); }
  });
}
/** a web result as a track the player can queue and play (nothing is saved to disk) */
function streamTrack(r) {
  const id = 'web:' + r.id;
  if (!streams.has(id)) streams.set(id, { id, path: r.streamUrl, title: r.title, artist: r.artist || '', album: r.album || '', duration: r.duration || 0,
    cover: r.cover || null, format: r.format || 'MP3', stream: true, pageUrl: r.pageUrl || '', license: r.license || '', provider: r.providerLabel, addedAt: Date.now(), bpm: null });
  return streams.get(id);
}

/* ============================== sidebar ============================== */
function renderCounts() {
  $('#libCount').textContent = S.tracks.length;
  $('#queueCount').textContent = Math.max(0, S.queue.length - S.qi - 1);
}
function renderSidebar() {
  renderCounts();
  const box = $('#playlists');
  box.innerHTML = '';
  if (!S.playlists.length) box.append(h('div', { class: 'pl-empty' }, tr('pl.emptyList')));
  for (const pl of S.playlists) {
    const el = h('button', { class: 'pl-item' + (S.view.type === 'playlist' && S.view.id === pl.id ? ' active' : ''), dataset: { id: pl.id } },
      plArt(pl), h('span', {}, pl.name), h('em', {}, pl.trackIds.length));
    el.onclick = () => setView({ type: 'playlist', id: pl.id });
    el.ondblclick = () => startRename(pl.id);
    el.oncontextmenu = (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, [
      { text: tr('m.play'), onClick: () => playFrom(pl.trackIds, 0) },
      { text: tr('m.shufflePlay'), onClick: () => { S.shuffle = true; syncModeBtns(); playFrom(pl.trackIds, (Math.random() * pl.trackIds.length) | 0); } },
      { text: tr('m.rename'), onClick: () => startRename(pl.id) },
      { text: tr('m.cover'), onClick: () => setPlaylistCover(pl) },
      ...(pl.cover ? [{ text: tr('m.coverRemove'), onClick: () => { pl.cover = null; save(); renderSidebar(); if (S.view.type === 'playlist') render(false); } }] : []), '-',
      { text: tr('m.delPl'), danger: true, onClick: () => deletePlaylist(pl.id) }]); };
    // accept tracks dragged from the list
    box.append(el);
  }
}
function startRename(pid, isNew) {
  const pl = S.playlists.find((p) => p.id === pid);
  const el = $(`.pl-item[data-id="${pid}"]`);
  if (!pl || !el) return;
  const input = h('input', { class: 'pl-input', value: pl.name });
  el.replaceWith(input); input.focus(); input.select();
  let done = false;
  const commit = (ok) => {
    if (done) return; done = true;
    if (ok && input.value.trim()) pl.name = input.value.trim().slice(0, 60);
    save(); renderSidebar(); if (S.view.type === 'playlist' && S.view.id === pid) render(false);
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  input.onblur = () => commit(true);
}
function newPlaylistInline() {
  const box = $('#playlists');
  box.querySelector('.pl-empty')?.remove();
  const input = h('input', { class: 'pl-input', placeholder: tr('pl.namePh') });
  box.prepend(input); input.focus();
  let done = false;
  const commit = (ok) => {
    if (done) return; done = true;
    const name = input.value.trim();
    input.remove();
    if (ok && name) { const pl = createPlaylist(name.slice(0, 60), [...S.selected]); setView({ type: 'playlist', id: pl.id }); }
    else renderSidebar();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  input.onblur = () => commit(true);
}

/* ============================== views ============================== */
function setView(v) {
  stopPreview();
  if (tools && tools.isOpen) tools.close();   // the sound rack belongs to where it was opened, not to the next tab
  S.view = v; S.selected.clear();
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === v.type));
  renderSidebar();
  render(true);
}
function sortedLibrary() {
  const a = [...S.tracks], by = S.settings.sort;
  const cmp = (x, y) => String(x).localeCompare(String(y), getLang(), { sensitivity: 'base' });
  if (by === 'title') a.sort((x, y) => cmp(x.title, y.title));
  else if (by === 'artist') a.sort((x, y) => cmp(artistOf(x), artistOf(y)) || cmp(x.album, y.album));
  else if (by === 'bpm') a.sort((x, y) => (x.bpm || 999) - (y.bpm || 999));
  else a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
  return a;
}
function render(animate = true) {
  const view = $('#view');
  const keep = view.scrollTop;
  if (animate && view.childNodes.length && !reducedMotion()) {
    // the old page slides away quickly while the new one arrives (≈250 ms in total)
    $$('.view-ghost').forEach((g) => g.remove());
    const ghost = h('div', { class: 'view view-ghost', 'aria-hidden': 'true', inert: '' });
    ghost.append(...view.childNodes);
    view.after(ghost); ghost.scrollTop = keep;
    ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-22px)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      .finished.then(() => ghost.remove(), () => ghost.remove());
  } else view.innerHTML = '';
  if (animate) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); view.scrollTop = 0; }
  const v = S.view;
  if (v.type === 'library') viewLibrary(view);
  else if (v.type === 'recent') viewRecent(view);
  else if (v.type === 'queue') viewQueue(view);
  else if (v.type === 'playlist') viewPlaylist(view);
  else if (v.type === 'search') viewSearch(view);
  else if (v.type === 'link') viewLink(view);
  else if (v.type === 'similar') viewSimilar(view);
  else if (v.type === 'health') viewHealth(view);
  if (!animate) view.scrollTop = keep;
  markPlayingRows();
}

const VNUM = { library: '001', queue: '002', recent: '003', health: '004', playlist: '005', similar: '006', search: '007', link: '008' };
function header({ kicker, title, sub, artEl, actions }) {
  return h('div', { class: 'v-head' }, artEl || null,
    h('div', {}, h('div', { class: 'v-kicker' }, h('span', { class: 'v-num' }, VNUM[S.view.type] || '000'), kicker), h('div', { class: 'v-title', html: title }), sub ? h('div', { class: 'v-sub' }, sub) : null, h('div', { class: 'v-rule' })),
    h('div', { class: 'v-actions' }, ...(actions || [])));
}
const pill = (text, icon, onClick, ghost) => h('button', { class: 'chrome-pill sm' + (ghost ? ' ghost' : ''), onClick }, h('span', { class: 'cp-ico', html: icon }), h('span', {}, text));
const total = (ts) => ts.reduce((s, t) => s + (t.duration || 0), 0);

function emptyState(host, title, text, withImport = true) {
  host.append(h('div', { class: 'empty' }, h('div', { class: 'empty-card' },
    h('div', { class: 'empty-ring', html: ICON.note.replace('<svg', '<svg') }),
    h('h3', {}, title), h('p', {}, text),
    withImport ? h('div', { style: { display: 'grid', justifyItems: 'center', gap: '10px', marginTop: '8px' } },
      pill(tr('lr.findBtn'), ICON.note, () => repair.openFinder()),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' } },
        pill(tr('v.add'), ICON.kImport, () => pickImport('files'), true),
        pill(tr('v.folder'), ICON.kFolder, () => pickImport('folder'), true))) : null)));
}

function viewLibrary(host) {
  const list = sortedLibrary();
  const seg = h('div', { class: 'seg' }, ...[['added', tr('sort.added')], ['title', tr('sort.title')], ['artist', tr('sort.artist')], ['bpm', tr('sort.bpm')]].map(([k, l]) =>
    h('button', { class: S.settings.sort === k ? 'on' : '', onClick: () => { S.settings.sort = k; save(); render(false); } }, l)));
  host.append(header({
    kicker: tr('lib.kicker'), title: tr('lib.title'),
    sub: list.length ? `${tn('tracks', list.length)} · ${fmtLong(total(list))}` : tr('lib.empty'),
    actions: list.length ? [seg, pill(tr('v.shuffle'), ICON.kShuffle, () => { S.shuffle = true; syncModeBtns(); playFrom(list.map((t) => t.id), (Math.random() * list.length) | 0); }, true),
      pill(tr('v.play'), ICON.kPlay, () => playFrom(list.map((t) => t.id), 0)),
      // a phone has no folders to pick: look through Android's music (the iPhone app's own folder) again for new files
      isAndroid ? pill(tr('and.rescan'), ICON.kImport, () => pickImport('rescan'), true) : null].filter(Boolean) : []
  }));
  if (!list.length) return emptyState(host, tr('lib.emptyT'), tr('lib.emptyD'));
  const plaque = repairPlaque();
  if (plaque) host.append(plaque);
  host.append(trackList(list.map((t) => t.id), {}));
}
/**
 * On a phone «Состояние медиатеки» has no tab of its own: when tracks lack artwork or tags, the library says
 * so in one line and opens it with the search already running. Closed with ×, it stays away until next start.
 */
let plaqueClosed = false;
function repairPlaque() {
  if (!phone.matches || plaqueClosed || !repair) return null;
  const n = repair.missing();
  if (!n) return null;
  const el = h('div', { class: 'lr-plaque' },
    h('span', { class: 'lr-plaque-ico', html: ICON.note }),
    h('span', { class: 'lr-plaque-t' }, tr('lr.suggest', { n: tn('tracksGen', n) })),
    h('button', { class: 'chip-btn on', onClick: () => { setView({ type: 'health' }); setTimeout(() => { repair.start(); const c = $('#lrRepair'); if (c) c.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); }, 120); } }, tr('lr.plaqueBtn')),
    h('button', { class: 'icon-btn lr-plaque-x', title: tr('lr.plaqueHide'), 'aria-label': tr('lr.plaqueHide'), html: '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6"/></svg>',
      onClick: () => { plaqueClosed = true; el.remove(); } }));
  return el;
}
function viewRecent(host) {
  const list = [...S.tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 60);
  host.append(header({ kicker: tr('rec.kicker'), title: tr('rec.title'), sub: tr('rec.sub', { n: list.length }) }));
  if (!list.length) return emptyState(host, tr('rec.emptyT'), tr('rec.emptyD'));
  host.append(trackList(list.map((t) => t.id), {}));
}
function viewQueue(host) {
  const ids = S.queue;
  host.append(header({
    kicker: tr('q.kicker'), title: tr('q.title'),
    sub: ids.length ? tr('q.sub', { n: ids.length, i: S.qi + 1 }) : tr('q.empty'),
    actions: [pill(tr('ss.btn'), ICON.session, openSession, true)].concat(ids.length ? [pill(tr('v.clear'), ICON.kTrash, () => { const cur = S.queue[S.qi]; S.queue = cur ? [cur] : []; S.qi = cur ? 0 : -1; if (S.origQueue) S.origQueue = [...S.queue]; save(); renderUpNext(); render(false); }, true)] : [])
  }));
  if (!ids.length) return emptyState(host, tr('q.emptyT'), tr('q.emptyD'), false);
  host.append(trackList(ids, { queue: true }));
}
function viewPlaylist(host) {
  const pl = S.playlists.find((p) => p.id === S.view.id);
  if (!pl) return setView({ type: 'library' });
  const ts = pl.trackIds.map(T).filter(Boolean);
  host.append(header({
    kicker: tr('pl.kicker'), title: esc(pl.name), artEl: (() => { const a = plArt(pl, 'v-art'); a.title = tr('np.change'); a.dataset.label = tr('np.change'); a.onclick = () => setPlaylistCover(pl); return a; })(),
    sub: `${tn('tracks', ts.length)} · ${fmtLong(total(ts))}`,
    actions: ts.length ? [pill(tr('v.shuffle'), ICON.kShuffle, () => { S.shuffle = true; syncModeBtns(); playFrom(pl.trackIds, (Math.random() * ts.length) | 0); }, true),
      pill(tr('v.play'), ICON.kPlay, () => playFrom(pl.trackIds, 0))] : []
  }));
  if (!ts.length) return emptyState(host, tr('pl.emptyT'), tr('pl.emptyD'), false);
  host.append(trackList(ts.map((t) => t.id), { playlist: pl }));
}

/* ---------------------------- similar tracks ---------------------------- */
function simRow(t, score, reasons, i, onPlay) {
  const pct = Math.round(score * 100);
  const row = h('div', { class: 'sim-row', style: { '--i': i }, tabindex: 0 },
    h('div', { class: 'thumb', style: { background: art(t) } }),
    h('div', { class: 'web-meta' }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, artistOf(t))),
    h('div', { class: 'sim-why' }, ...(reasons.length ? reasons.slice(0, 4) : [tr('why.general')]).map((r) => h('span', { class: 'why-chip' }, r))),
    h('div', { class: 'dv-match', style: { '--p': pct } }, h('span', {}, pct + '%')),
    h('button', { class: 'icon-btn', title: tr('m.next'), 'aria-label': tr('m.next'), html: ICON.next, onClick: (e) => { e.stopPropagation(); playNext([t.id]); } }));
  row.addEventListener('dblclick', onPlay);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPlay(); });
  return row;
}
function viewSimilar(host) {
  const seed = T(S.view.id);
  if (!seed) return setView({ type: 'library' });
  host.append(header({ kicker: tr('sim.kicker'), title: esc(seed.title), sub: tr('sim.sub', { artist: artistOf(seed) }),
    artEl: h('div', { class: 'v-art single', style: { background: art(seed) } }) }));
  const box = h('div');
  host.append(box);
  const fill = () => {
    box.innerHTML = '';
    if (seed.av === -1) { box.append(h('div', { class: 'notice' }, tr('sim.fail'))); return; }
    if (!analyzed(seed)) {
      box.append(h('div', { class: 'notice' }, h('span', { class: 'spin' }), tr('sim.wait')));
      runAnalysis(seed).then(() => { if (box.isConnected) fill(); });
      return;
    }
    const list = findSimilar(seed, S.tracks, 30);
    const pending = S.tracks.filter((t) => !analyzed(t)).length;
    if (pending) box.append(h('div', { class: 'notice' }, tn('sim.partial', pending)));
    if (!list.length) return box.append(h('div', { class: 'sp-empty' }, tr('dv.simNone')));
    const ids = list.map((x) => x.t.id);
    box.prepend(h('div', { class: 'v-actions', style: { margin: '0 0 12px' } },
      pill(tr('sim.toPl'), ICON.plus, () => { const pl = createPlaylist(tr('sim.plName', { title: seed.title }).slice(0, 60), [seed.id, ...ids]); setView({ type: 'playlist', id: pl.id }); }, true),
      pill(tr('v.play'), ICON.kPlay, () => playFrom([seed.id, ...ids], 0))));
    list.forEach(({ t, score, reasons }, i) => box.append(simRow(t, score, reasons, i, () => playFrom([seed.id, ...ids], i + 1))));
  };
  fill();
  if (S.settings.bgAnalyze) backgroundAnalyze();
}
function playIds(ids) { playFrom(ids, 0); }

/* ---------------------------- library health ---------------------------- */
let missingIds = new Set();
async function checkLibrary() {
  const real = S.tracks.filter((t) => !String(t.path).startsWith('demo:'));
  if (bridge.library.existsMany && real.length) {
    const ex = await bridge.library.existsMany(real.map((t) => t.path));
    missingIds = new Set(real.filter((_, i) => !ex[i]).map((t) => t.id));
  }
  await ensureFormat(S.tracks);
  if (S.view.type === 'health') render(false);
}
function viewHealth(host) {
  const r = healthReport(S.tracks, missingIds);
  host.append(header({ kicker: tr('h.kicker'), title: tr('h.title'), sub: tr('h.sub'),
    actions: [pill(tr('h.check'), ICON.health, () => { toast(tr('h.checking')); checkLibrary(); }, true)] }));
  const tile = (v, l) => h('div', { class: 'h-tile' }, h('b', {}, v), h('span', {}, l));
  host.append(h('div', { class: 'h-tiles' },
    tile(r.count, tr('h.tracks')), tile(r.artists, tr('h.artists')), tile(r.albums, tr('h.albums')),
    tile(Math.round(r.secs / 3600 * 10) / 10, tr('h.hours')), tile(Math.round(r.analyzed / Math.max(1, r.count) * 100) + '%', tr('h.analyzedShort'))));

  // analysis progress
  const pct = r.analyzed / Math.max(1, r.count) * 100;
  host.append(h('div', { class: 'h-analyze' },
    h('div', {}, h('b', {}, tr('h.soundTitle')), h('small', { id: 'healthAnalyze' }, tr('h.analyzed', { n: r.analyzed, total: r.count })), h('div', { class: 'hbar' }, h('i', { style: { width: pct + '%' } }))),
    r.analyzed < r.count ? pill(tr('h.analyzeAll'), ICON.session, () => { backgroundAnalyze(true); toast(tr('h.analyzeStarted')); }, true) : h('span', { class: 'badge lic' }, tr('h.allDone'))));

  host.append(repair.repairCard());
  host.append(h('div', { class: 'sec-title' }, tr('h.problems')));
  const card = (cls, count, title, desc, body) => {
    const d = h('details', { class: 'h-card ' + cls + (count ? '' : ' ok') });
    d.append(h('summary', {}, h('span', { class: 'h-count' }, count ? String(count) : '✓'), h('div', {}, h('b', {}, title), h('small', {}, count ? desc : tr('h.none')))));
    if (count) d.append(body());
    return d;
  };
  const more = (n) => (n > 0 ? h('div', { class: 'sp-empty' }, tr('h.more', { n })) : '');
  const trackLine = (t, ...actions) => h('div', { class: 'h-line' }, h('div', { class: 'thumb', style: { background: art(t) } }),
    h('div', { class: 'web-meta' }, h('div', { class: 't' }, t.title), h('div', { class: 'a mono' }, String(t.path).split(/[\\/]/).slice(-2).join('/'))), ...actions);
  const btn = (text, fn, primary) => h('button', { class: 'chip-btn' + (primary ? ' on' : ''), onClick: fn }, text);

  host.append(card('warn', r.broken.length, tr('h.broken'), tr('h.brokenD'), () => {
    const box = h('div', { class: 'h-body' });
    const fixable = r.broken.filter((b) => b.fixTitle || b.fixArtist);
    if (fixable.length > 1) box.append(h('div', { class: 'h-bulk' }, btn(tr('h.fixAll', { n: fixable.length }), () => { fixable.forEach(applyFix); save(); render(false); toast(tr('h.fixed', { n: fixable.length })); }, true)));
    r.broken.slice(0, 50).forEach((b) => {
      const sugg = b.fixTitle || b.fixArtist ? `${b.fixArtist || b.t.artist || ''}${(b.fixArtist || b.t.artist) ? ' — ' : ''}${b.fixTitle || b.t.title}` : `${b.fromFile.artist ? b.fromFile.artist + ' — ' : ''}${b.fromFile.title}`;
      box.append(h('div', { class: 'h-fix' },
        h('div', { class: 'h-was' }, h('small', {}, tr('h.now')), h('span', { class: 'mono' }, `${b.t.artist ? b.t.artist + ' — ' : ''}${b.t.title}`)),
        h('div', { class: 'h-arrow', html: '→' }),
        h('div', { class: 'h-will' }, h('small', {}, b.junk ? tr('h.junk') : b.fixTitle || b.fixArtist ? tr('h.encoding') : tr('h.fromFile')), h('span', {}, sugg)),
        h('div', { class: 'h-acts' },
          btn(tr('h.apply'), () => { if (b.fixTitle || b.fixArtist) applyFix(b); else { b.t.title = b.fromFile.title; if (b.fromFile.artist) b.t.artist = b.fromFile.artist; } save(); render(false); }, true),
          btn(tr('h.editManual'), () => editTrack(b.t)))));
    });
    box.append(more(r.broken.length - 50));
    return box;
  }));

  host.append(card('warn', r.dupes.length, tr('h.dupes'), tr('h.dupesD'), () => {
    const box = h('div', { class: 'h-body' });
    r.dupes.slice(0, 40).forEach((g) => {
      const grp = h('div', { class: 'h-dupe' }, h('div', { class: 'h-dupe-head' }, h('b', {}, g.best.title), h('span', {}, artistOf(g.best))));
      g.items.forEach((t) => grp.append(h('div', { class: 'h-dupe-row' + (t === g.best ? ' best' : '') },
        h('span', { class: 'badge' + (quality(t) === 'lossless' ? ' lic' : '') }, qualityLabel(t)),
        h('span', { class: 'mono path' }, String(t.path).split(/[\\/]/).pop()),
        h('span', { class: 'mono' }, t.size ? (t.size / 1048576).toFixed(1) + ' ' + tr('mb') : ''),
        t === g.best ? h('span', { class: 'badge acc' }, tr('h.best')) : h('span'))));
      grp.append(h('div', { class: 'h-acts' }, btn(tr('h.keepBest'), () => { removeFromLibrary(g.items.filter((t) => t !== g.best).map((t) => t.id)); }, true), h('small', { class: 'h-note' }, tr('h.keepNote'))));
      box.append(grp);
    });
    box.append(more(r.dupes.length - 40));
    return box;
  }));

  host.append(card('', r.noCover.length, tr('h.noCover'), tr('h.noCoverD'), () => {
    const box = h('div', { class: 'h-body' });
    r.noCover.slice(0, 40).forEach((t) => box.append(trackLine(t, btn(tr('m.cover'), () => setTrackCover(t)))));
    box.append(more(r.noCover.length - 40));
    return box;
  }));
  host.append(card('', r.noArtist.length, tr('h.noTags'), tr('h.noTagsD'), () => {
    const box = h('div', { class: 'h-body' });
    r.noArtist.slice(0, 40).forEach((t) => box.append(trackLine(t, btn(tr('m.edit'), () => editTrack(t)))));
    box.append(more(r.noArtist.length - 40));
    return box;
  }));
  host.append(card('warn', r.gone.length, tr('h.gone'), tr('h.goneD'), () => {
    const box = h('div', { class: 'h-body' });
    if (r.gone.length) box.append(h('div', { class: 'h-bulk' }, btn(tr('h.removeGone'), () => { removeFromLibrary(r.gone.map((t) => t.id)); missingIds.clear(); }, true)));
    r.gone.slice(0, 40).forEach((t) => box.append(trackLine(t)));
    return box;
  }));

  // quality breakdown
  host.append(h('div', { class: 'sec-title' }, tr('h.quality')));
  const order = ['lossless', 'q320', 'q256', 'q192', 'qlow', 'unknown'];
  const total = Math.max(1, r.count);
  const bar = h('div', { class: 'q-bar' }, ...order.filter((k) => r.qual[k]).map((k) => h('i', { class: 'q-' + k, style: { flex: r.qual[k] }, title: `${tr('q.' + k)}: ${r.qual[k]}` })));
  host.append(bar, h('div', { class: 'q-legend' }, ...order.map((k) => h('div', { class: 'q-row' }, h('i', { class: 'q-' + k }), h('span', {}, tr('q.' + k)), h('b', {}, r.qual[k]), h('small', {}, Math.round(r.qual[k] / total * 100) + '%')))));
  if (r.qual.unknown && bridge.library.formatInfo) host.append(h('div', { class: 'notice' }, tr('h.unknownQ')));
}
function qualityLabel(t) {
  const q = quality(t);
  const codec = String(t.codec || t.format || '').toUpperCase().replace('MPEG 1 LAYER 3', 'MP3');
  return q === 'lossless' ? `${codec || 'LOSSLESS'}${t.bitDepth ? ' ' + t.bitDepth + ' bit' : ''}` : `${codec || '?'}${t.bitrate ? ' ' + t.bitrate + ' kbps' : ''}`;
}
function applyFix(b) {
  if (b.fixTitle) b.t.title = b.fixTitle;
  if (b.fixArtist) b.t.artist = b.fixArtist;
  b.t.edited = [...new Set([...(b.t.edited || []), ...(b.fixTitle ? ['title'] : []), ...(b.fixArtist ? ['artist'] : [])])];
}

/* ---------------------------- edit track info ---------------------------- */
function editTrack(t) {
  const field = (k, label) => {
    const inp = h('input', { class: 'set-input wide', value: t[k] || '', 'aria-label': label });
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') saveIt(); if (e.key === 'Escape') closeModal(); };
    return [k, inp, h('label', { class: 'ed-row' }, h('span', {}, label), inp)];
  };
  const fields = [field('title', tr('ed.title')), field('artist', tr('ed.artist')), field('album', tr('ed.album')), field('genre', tr('ed.genre'))];
  const saveIt = () => {
    for (const [k, inp] of fields) {
      const v = inp.value.trim(); if (k === 'title' && !v) continue;
      if (v !== (t[k] || '')) t.edited = [...new Set([...(t.edited || []), k])];
      t[k] = v;
    }
    save(); closeModal(); render(false); renderUpNext(); if (S.current === t) updateNowPlaying(t);
    toast(tr('ed.saved'));
  };
  const fromFile = titleFromPath(t.path);
  openModal(h('div', { class: 'modal-card' },
    h('div', { class: 'v-kicker' }, tr('ed.kicker')), h('h3', {}, tr('ed.head')),
    ...fields.map((f) => f[2]),
    h('div', { class: 'notice' }, tr('ed.note')),
    h('div', { class: 'modal-acts' },
      h('button', { class: 'text-btn', onClick: () => { fields[0][1].value = fromFile.title; if (fromFile.artist) fields[1][1].value = fromFile.artist; } }, tr('ed.fromFile')),
      h('span', { class: 'grow' }),
      h('button', { class: 'chip-btn', onClick: closeModal }, tr('ed.cancel')),
      h('button', { class: 'chip-btn on', onClick: saveIt }, tr('ed.save')))));
  setTimeout(() => fields[0][1].focus(), 60);
}

/* ------------------------- export processed track ------------------------- */
let exporting = null;
/** a file written from a track (a fragment): into the library, linked to its source; toast with Play / Show */
async function addExported(fp, src, title, tag) {
  let added = null;
  if (S.settings.exportAdd) {
    const [nt] = await bridge.library.probe([fp]);
    if (nt) {
      const ex = T(nt.id);
      added = ex || nt;
      if (!ex) { nt.title = title; nt.addedAt = Date.now(); S.tracks.push(nt); }
      Object.assign(added, { derivedFrom: src.id, fxTag: tag });
      if (!added.cover && src.cover) { added.cover = src.cover; added.customCover = true; }
      if (!added.artist && src.artist) added.artist = src.artist;
      index(); save(); renderSidebar(); if (['library', 'recent'].includes(S.view.type)) render(false);
    }
  }
  const acts = h('div', { class: 'tchips' });
  if (added) acts.append(h('button', { class: 'tchip', onClick: () => playIds([added.id]) }, tr('ex.play')));
  if (bridge.isElectron) acts.append(h('button', { class: 'tchip', onClick: () => bridge.library.reveal(fp) }, tr('m.reveal')));
  toast(h('span', {}, tr('tm.saved'), ' ', h('small', {}, String(fp).split(/[\\/]/).pop())), { timeout: 9000, actions: acts });
}

function openExport(t = S.current) {
  if (!t) { toast(tr('ex.noTrack')); return; }
  if (exporting) { toast(tr('ex.busy')); return; }
  const st = captureState(engine, ambient);
  const tag = describe(st, tr);
  const o = S.settings;
  const chip = (on, label, value) => h('div', { class: 'ex-fx' + (on ? ' on' : '') }, h('i', { class: 'led' }), h('b', {}, label), h('span', { class: 'mono' }, on ? value : tr('ex.off')));
  // (value may be a node — the EQ chip shows a tiny 10-band curve)
  const semis = st.pitch.semis + st.pitch.cents / 100;
  const fx = h('div', { class: 'ex-fxs' },
    chip(st.pitch.active, 'Sound Pitcher', `${semis > 0 ? '+' : ''}${Math.round(semis * 100) / 100} ${tr('ex.st')}${st.pitch.vinyl ? ' · Vinyl' : ''}`),
    chip(st.eq.active, tr('rack.eq'), h('span', { class: 'ex-eq', html: st.eq.gains.map((g) => `<i style="height:${Math.round(50 + g / 12 * 46)}%"></i>`).join('') })),
    chip(st.ambient.active, 'Ambient', st.ambient.layers.map((l) => tr(l.name)).join(' + ') + (st.ambient.depth > 0 ? ' · Smart Duck' : '')));
  const name = h('input', { class: 'set-input wide', value: `${t.title}${tag ? ` (${tag})` : ''}`, 'aria-label': tr('ex.name') });
  name.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape' && !exporting) closeModal(); };
  const fmtSeg = h('div', { class: 'seg' }, ...['mp3', 'wav'].map((f) => h('button', { class: o.exportFormat === f ? 'on' : '', onClick: (e) => { o.exportFormat = f; fmtSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); hint.textContent = tr('ex.' + f + 'D', { mb: estimate(f) }); save(); } }, f === 'mp3' ? 'MP3 · 320 kbps' : 'WAV · 16-bit')));
  const estimate = (f) => { const sec = (t.duration || 0) / (st.pitch.vinyl && st.pitch.active ? st.pitch.ratio : 1); return Math.max(1, Math.round(sec * (f === 'wav' ? 176400 : 40000) / 1048576)); };
  const hint = h('small', { class: 'ex-hint' }, tr('ex.' + o.exportFormat + 'D', { mb: estimate(o.exportFormat) }));
  const addTg = h('button', { class: 'toggle' + (o.exportAdd ? ' on' : ''), role: 'switch', 'aria-checked': String(o.exportAdd), 'aria-label': tr('ex.add') });
  addTg.onclick = () => { o.exportAdd = !o.exportAdd; addTg.classList.toggle('on', o.exportAdd); addTg.setAttribute('aria-checked', String(o.exportAdd)); save(); };
  const bar = h('div', { class: 'ex-bar' }, h('i'));
  const stage = h('span', { class: 'ex-stage' });
  const prog = h('div', { class: 'ex-prog' }, h('div', { class: 'ex-prog-row' }, stage, h('span', { class: 'mono ex-pct' }, '0%')), bar);
  const goBtn = h('button', { class: 'chip-btn on' }, tr('ex.save'));
  const card = h('div', { class: 'modal-card ex-card' },
    h('div', { class: 'v-kicker' }, tr('ex.kicker')), h('h3', {}, tr('ex.title')),
    h('div', { class: 'ex-src' }, h('div', { class: 'thumb', style: { background: art(t) } }), h('div', { class: 'web-meta' }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, artistOf(t)))),
    fx,
    st.any ? null : h('div', { class: 'notice' }, tr('ex.nothing')),
    h('label', { class: 'ed-row' }, h('span', {}, tr('ex.name')), name),
    h('div', { class: 'ed-row' }, h('span', {}, tr('ex.format')), h('div', { class: 'ex-fmt' }, fmtSeg, hint)),
    h('label', { class: 'ss-opt' }, addTg, h('span', {}, tr('ex.add'))),
    prog,
    h('div', { class: 'modal-acts' },
      h('small', { class: 'h-note' }, tr('ex.note')),
      h('span', { class: 'grow' }),
      h('button', { class: 'chip-btn', onClick: closeModal }, tr('ed.cancel')), goBtn));
  goBtn.onclick = () => go();
  const setP = (label, p) => { stage.textContent = label; prog.querySelector('.ex-pct').textContent = Math.round(p * 100) + '%'; bar.firstChild.style.transform = `scaleX(${p})`; };
  async function go() {
    if (exporting) return;
    const title = name.value.trim() || t.title;
    const target = await bridge.exporter.pick(title, o.exportFormat);
    if (!target) return;
    exporting = true;
    card.classList.add('working'); goBtn.disabled = true;
    try {
      setP(tr('ex.reading'), 0);
      const res = await fetch(bridge.mediaUrl(t.path));
      if (!res.ok) throw new Error(tr('toast.fileGone', { title: t.title }));
      const ab = await res.arrayBuffer();
      setP(tr('ex.decoding'), .03);
      const buf = await engine.ctx.decodeAudioData(ab);
      const pcm = await renderProcessed(buf, st, (p) => setP(tr('ex.rendering'), .05 + p * (target.format === 'mp3' ? .45 : .85)));
      const tags = { title, artist: t.artist, album: t.album, genre: t.genre, comment: tag };
      let data;
      if (target.format === 'mp3') data = await encodeMp3(pcm, tags, (p) => setP(tr('ex.encoding'), .5 + p * .45));
      else { setP(tr('ex.encoding'), .92); await new Promise((r) => setTimeout(r, 30)); data = encodeWav(pcm, tags); }
      setP(tr('ex.writing'), .97);
      const fp = await bridge.exporter.write(target.path, data);
      setP(tr('ex.done'), 1);
      let added = null;
      if (o.exportAdd) {
        const [nt] = await bridge.library.probe([fp]);
        if (nt) {
          const ex = T(nt.id);
          added = ex || nt;
          if (!ex) { nt.title = title; nt.addedAt = Date.now(); S.tracks.push(nt); }
          Object.assign(added, { derivedFrom: t.id, fxTag: tag });
          if (!added.cover && t.cover) { added.cover = t.cover; added.customCover = true; }
          if (!added.artist && t.artist) added.artist = t.artist;
          index(); save(); renderSidebar(); if (['library', 'recent'].includes(S.view.type)) render(false);
        }
      }
      if (card.isConnected) closeModal();
      const acts = h('div', { class: 'tchips' });
      if (added) acts.append(h('button', { class: 'tchip', onClick: () => playIds([added.id]) }, tr('ex.play')));
      if (bridge.isElectron) acts.append(h('button', { class: 'tchip', onClick: () => bridge.library.reveal(fp) }, tr('m.reveal')));
      toast(h('span', {}, tr('ex.saved'), ' ', h('small', {}, String(fp).split(/[\\/]/).pop()), pcm.peakFix ? h('small', {}, ' · ' + tr('ex.peak', { db: pcm.peakFix.toFixed(1) })) : ''), { timeout: 9000, actions: acts });
    } catch (e) {
      console.error(e);
      card.classList.remove('working'); goBtn.disabled = false;
      toast(tr('ex.fail', { msg: e.message || e }));
    } finally { exporting = null; }
  }
  openModal(card);
  setTimeout(() => name.focus(), 60);
}

/* ---------------------------- smart session ---------------------------- */
const sessionOpts = { mood: 'deep', minutes: 45, bpm: null, noRepeat: true, artistCap: true, fromCurrent: false };
/* lyrics: one answer per track per session (the main process keeps the LRCLIB cache on disk) */
const lyricsCache = new Map();
async function getLyrics(t, force, skipLocal) {
  if (!bridge.lyrics) return { text: '', offline: true };
  // «search online» past the user's own text: a one-off preview, never cached in place of their lyrics
  if (skipLocal) return bridge.lyrics.get({ path: t.path, title: t.title, artist: t.artist, album: t.album, duration: t.duration }, { online: true, force: true, skipLocal: true });
  // the promise itself is cached, so reopening Deep View while a slow lookup runs waits for the same answer
  if (!force && lyricsCache.has(t.id)) return lyricsCache.get(t.id);
  const p = bridge.lyrics.get({ path: t.path, title: t.title, artist: t.artist, album: t.album, duration: t.duration }, { online: S.settings.lyricsOnline, force: !!force });
  lyricsCache.set(t.id, p);
  p.then((res) => { if (!res && lyricsCache.get(t.id) === p) lyricsCache.delete(t.id); }, () => { if (lyricsCache.get(t.id) === p) lyricsCache.delete(t.id); });
  return p;
}

/* first music → a short showcase of what makes the player worth keeping: Deep View and the tools, live */
const SHOWCASE = [
  { key: 'sc.hello', enter: () => { if (deep.isOpen) deep.close(); if (tools.isOpen) tools.close(); }, wait: 0 },
  { key: 'sc.deep', sel: '.deep .dv-sec', enter: () => { if (tools.isOpen) tools.close(); deep.show(); }, wait: 760 },
  { key: 'sc.tools', sel: '#rack', enter: () => { if (deep.isOpen) deep.close(); tools.open(); tools.show(null); }, wait: 620 },
  { key: 'sc.session', sel: '#sessionBtn', enter: () => { if (tools.isOpen) tools.close(); }, wait: 320 },
  { key: 'sc.done', sel: '#helpBtn' }
];
/** the phone layout (Android app or a narrow window): one column, tap plays */
const phone = matchMedia('(max-width: 760px)');
// the on-screen keyboard shrinks the window: while it is up, the player strip and the tab bar step aside
// (only while a text field has focus: a window that was simply made shorter is not a keyboard)
{
  let full = innerHeight, w = innerWidth;
  const typing = () => { const el = document.activeElement; return !!el && (el.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea') || el.isContentEditable); };
  const check = () => {
    if (innerWidth !== w) { w = innerWidth; full = innerHeight; } // rotated or resized sideways: a new baseline
    if (innerHeight > full || !typing()) full = Math.max(innerHeight, typing() ? full : 0);
    document.documentElement.classList.toggle('kb', phone.matches && typing() && innerHeight < full * .78);
  };
  addEventListener('resize', check);
  addEventListener('focusout', () => setTimeout(check, 50));
  addEventListener('orientationchange', () => { full = 0; });
}

let showcaseTimer = 0;
function maybeShowcase() {
  if (S.settings.showcaseDone || showcaseTimer || phone.matches) return;
  // give the first track a moment to be heard before anything covers the screen
  showcaseTimer = setTimeout(() => {
    showcaseTimer = 0;
    if (S.settings.showcaseDone || !S.current || engine.audio.paused || tour.isOpen || deep.isOpen || visual.isOpen || $('#modal').classList.contains('open')) return;
    S.settings.showcaseDone = true; save();
    tour.start(SHOWCASE, { onDone: () => {}, onClose: () => { if (deep.isOpen) deep.close(); if (tools.isOpen) tools.close(); } });
  }, 2600);
}

function openSession() {
  const o = sessionOpts;
  const preview = h('div', { class: 'ss-preview' });
  let result = null;
  const moodIcons = { calm: ICON.ocean, deep: ICON.similar, energetic: ICON.session, dark: ICON.vinyl };
  const moods = h('div', { class: 'ss-moods', role: 'radiogroup', 'aria-label': tr('ss.mood') }, ...Object.keys(MOODS).map((k) => {
    const b = h('button', { class: 'ss-mood' + (o.mood === k ? ' on' : ''), role: 'radio', 'aria-checked': String(o.mood === k), dataset: { k } },
      h('span', { class: 'ss-ico', html: moodIcons[k] }), h('b', {}, tr('mood.' + k)), h('small', {}, tr('mood.' + k + 'D')));
    b.onclick = () => { o.mood = k; moods.querySelectorAll('.ss-mood').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); build(); };
    return b;
  }));
  const seg = (vals, cur, onPick, fmtv) => {
    const el = h('div', { class: 'seg' }, ...vals.map((v) => h('button', { class: JSON.stringify(v) === JSON.stringify(cur()) ? 'on' : '', onClick: (e) => { onPick(v); el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); build(); } }, fmtv(v))));
    return el;
  };
  const tg = (get, set, label) => {
    const b = h('button', { class: 'toggle' + (get() ? ' on' : ''), role: 'switch', 'aria-checked': String(get()), 'aria-label': label });
    b.onclick = () => { set(!get()); b.classList.toggle('on', get()); b.setAttribute('aria-checked', String(get())); build(); };
    return h('label', { class: 'ss-opt' }, b, h('span', {}, label));
  };
  const total = S.tracks.length, done = S.tracks.filter(analyzed).length;
  function build() {
    const seed = o.fromCurrent && S.current ? S.current : null;
    result = buildSession(S.tracks, { mood: o.mood, minutes: o.minutes, bpm: o.bpm, noRepeat: o.noRepeat, recent: S.history, artistCap: o.artistCap ? 2 : 0, seed });
    preview.innerHTML = '';
    if (!result.ids.length) { preview.append(h('div', { class: 'sp-empty' }, tr('ss.empty'))); return; }
    preview.append(h('div', { class: 'ss-sum' },
      h('b', {}, tn('tracks', result.ids.length)), h('span', {}, fmtLong(result.total)), result.avgBpm ? h('span', {}, tr('ss.avgBpm', { n: result.avgBpm })) : null));
    const list = h('div', { class: 'ss-list' });
    result.ids.forEach((id, i) => {
      const t = T(id);
      list.append(h('div', { class: 'ss-item', style: { '--i': i } }, h('span', { class: 'n mono' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'thumb', style: { background: art(t) } }),
        h('div', { class: 'web-meta' }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, artistOf(t))),
        h('span', { class: 'mono ss-tag' }, [t.bpm ? Math.round(t.bpm) + ' BPM' : null, t.camelot].filter(Boolean).join(' · ')),
        h('span', { class: 'mono' }, fmt(t.duration))));
    });
    preview.append(list);
  }
  const card = h('div', { class: 'modal-card ss-card' },
    h('div', { class: 'v-kicker' }, tr('ss.kicker')), h('h3', {}, tr('ss.title')),
    h('div', { class: 'ss-field' }, h('span', { class: 'ss-lbl' }, tr('ss.mood')), moods),
    h('div', { class: 'ss-grid' },
      h('div', { class: 'ss-field' }, h('span', { class: 'ss-lbl' }, tr('ss.length')), seg([20, 45, 60, 90], () => o.minutes, (v) => (o.minutes = v), (v) => tr('ss.min', { n: v }))),
      h('div', { class: 'ss-field' }, h('span', { class: 'ss-lbl' }, tr('ss.tempo')), seg([null, [60, 95], [90, 120], [115, 180]], () => o.bpm, (v) => (o.bpm = v), (v) => (v ? `${v[0]}–${v[1]}` : tr('ss.any'))))),
    h('div', { class: 'ss-opts' },
      tg(() => o.noRepeat, (v) => (o.noRepeat = v), tr('ss.noRepeat')),
      tg(() => o.artistCap, (v) => (o.artistCap = v), tr('ss.artistCap')),
      S.current ? tg(() => o.fromCurrent, (v) => (o.fromCurrent = v), tr('ss.fromCurrent')) : null),
    done < total ? h('div', { class: 'notice' }, tr('ss.partial', { n: done, total }), h('button', { class: 'text-btn', onClick: () => { backgroundAnalyze(true); toast(tr('h.analyzeStarted')); } }, tr('h.analyzeAll'))) : null,
    preview,
    h('div', { class: 'modal-acts' },
      h('button', { class: 'chip-btn', onClick: build }, tr('ss.reroll')),
      h('span', { class: 'grow' }),
      h('button', { class: 'chip-btn', onClick: () => { if (!result || !result.ids.length) return; const pl = createPlaylist(tr('ss.plName', { mood: tr('mood.' + o.mood) }), result.ids); closeModal(); setView({ type: 'playlist', id: pl.id }); } }, tr('ss.save')),
      h('button', { class: 'chip-btn on', onClick: () => { if (!result || !result.ids.length) return; closeModal(); playFrom(result.ids, 0); toast(tr('ss.started', { mood: tr('mood.' + o.mood) })); } }, tr('ss.play'))));
  openModal(card);
  build();
}

/* ---------------------------- track list ---------------------------- */
// the column labels get a backing only while they stick to the top, so at rest they stay part of the panel
let stuckRaf = 0;
addEventListener('scroll', (e) => {
  const v = e.target;
  if (stuckRaf || !v.classList || !v.classList.contains('view')) return;
  stuckRaf = requestAnimationFrame(() => {
    stuckRaf = 0;
    const head = v.querySelector('.tl-head');
    if (head) head.classList.toggle('stuck', head.getBoundingClientRect().top - v.getBoundingClientRect().top < 1);
  });
}, true);

function trackList(ids, opts) {
  const wrap = h('div', { class: 'tlist' });
  wrap.append(h('div', { class: 'tl-head' }, h('span', { style: { textAlign: 'center' } }, '#'), h('span'), h('span', {}, tr('col.title')), h('span', {}, tr('col.album')), h('span', {}, 'BPM'), h('span', { style: { textAlign: 'right' } }, tr('col.time')), h('span')));
  const frag = document.createDocumentFragment();
  ids.forEach((id, i) => {
    const t = T(id); if (!t) return;
    const row = document.createElement('div');
    row.className = 'row' + (opts.queue && i === S.qi ? ' sel' : '');
    row.dataset.id = id; row.dataset.idx = i;
    row.style.setProperty('--i', i);
    row.innerHTML = `<div class="r-num"><span class="n">${i + 1}</span><span class="eq"><i></i><i></i><i></i></span><span class="play-mini">${ICON.playSolid}</span></div>` +
      `<div class="thumb" style='background:${art(t)}'></div>` +
      `<div class="r-main"><div class="r-title">${esc(t.title)}</div><div class="r-artist">${esc(artistOf(t))}</div></div>` +
      `<div class="r-album">${esc(t.album || '—')}</div><div class="r-bpm">${t.bpm ? `<b>${Math.round(t.bpm)}</b>` : '—'}</div>` +
      `<div class="r-dur">${fmt(t.duration)}</div>` +
      `<div class="r-act"><button data-a="next" title="${tr('m.next')}">${ICON.next}</button><button data-a="more" title="${tr('m.more')}">${ICON.more}</button></div>`;
    frag.append(row);
  });
  wrap.append(frag);
  const rowOf = (e) => e.target.closest('.row');
  const sel = () => (S.selected.size ? [...S.selected] : []);
  wrap.addEventListener('click', (e) => {
    const row = rowOf(e); if (!row) return;
    const id = row.dataset.id, i = +row.dataset.idx;
    const a = e.target.closest('[data-a]');
    if (a) {
      if (a.dataset.a === 'next') playNext([id]);
      else { const r = a.getBoundingClientRect(); trackMenu(r.left, r.bottom + 4, [id], opts, i); }
      return;
    }
    if (e.target.closest('.play-mini') || phone.matches) { if (opts.queue) { S.qi = i; loadCurrent(true); } else playFrom(ids, i); return; }
    if (!e.ctrlKey && !e.metaKey) { S.selected.clear(); $$('.row.sel', wrap).forEach((r) => r.classList.remove('sel')); }
    S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
    row.classList.toggle('sel', S.selected.has(id));
  });
  wrap.addEventListener('dblclick', (e) => {
    const row = rowOf(e); if (!row || e.target.closest('[data-a]')) return;
    const i = +row.dataset.idx;
    if (opts.queue) { S.qi = i; loadCurrent(true); } else playFrom(ids, i);
  });
  wrap.addEventListener('contextmenu', (e) => {
    const row = rowOf(e); if (!row) return;
    e.preventDefault();
    const id = row.dataset.id;
    const target = S.selected.has(id) && S.selected.size > 1 ? sel() : [id];
    trackMenu(e.clientX, e.clientY, target, opts, +row.dataset.idx);
  });
  attachTrackDrag(wrap, {
    idsFor: (row) => (S.selected.has(row.dataset.id) && S.selected.size > 1 ? sel() : [row.dataset.id]),
    describe: (ids) => { const t = T(ids[0]); return { art: art(t), title: ids.length > 1 ? tn('tracks', ids.length) : t.title, artist: ids.length > 1 ? tr('drag.andMore', { title: t.title, n: ids.length - 1 }) : artistOf(t) }; },
    hintFor: (el) => (el.classList.contains('pl-item') ? tr('drag.toPl', { name: S.playlists.find((p) => p.id === el.dataset.id)?.name }) : el.classList.contains('np-next') ? tr('m.next') : tr('m.enqueue')),
    onDrop: (el, ids) => {
      if (el.classList.contains('pl-item')) {
        addToPlaylist(el.dataset.id, ids, true);
        const fresh = $(`.pl-item[data-id="${el.dataset.id}"]`);
        if (fresh) { fresh.classList.add('drop-bump'); setTimeout(() => fresh.classList.remove('drop-bump'), 700); }
      } else if (el.classList.contains('np-next')) playNext(ids);
      else enqueue(ids);
    }
  });
  return wrap;
}

function trackMenu(x, y, ids, opts = {}, idx) {
  const one = ids.length === 1 ? T(ids[0]) : null;
  const items = [
    { text: one ? tr('m.play') : tr('m.playN', { n: ids.length }), onClick: () => playFrom(ids, 0) },
    { text: tr('m.next'), onClick: () => playNext(ids) },
    { text: tr('m.enqueue'), onClick: () => enqueue(ids) },
    ...(one ? [{ text: tr('m.similar'), onClick: () => setView({ type: 'similar', id: one.id }) }] : []), '-',
    { label: tr('m.toPl') },
    ...S.playlists.map((p) => ({ text: p.name, onClick: () => addToPlaylist(p.id, ids) })),
    { text: tr('m.newPl'), onClick: () => { const pl = createPlaylist(defaultPlName(), ids); startRename(pl.id); } }
  ];
  if (opts.playlist) items.push('-', { text: tr('m.fromPl'), onClick: () => { opts.playlist.trackIds = opts.playlist.trackIds.filter((id) => !ids.includes(id)); save(); renderSidebar(); render(false); } });
  if (opts.queue) items.push('-', { text: tr('m.fromQueue'), onClick: () => { const cur = S.queue[S.qi], drop = (id) => ids.includes(id) && id !== cur; S.qi = S.queue.slice(0, Math.max(0, S.qi)).filter((id) => !drop(id)).length; S.queue = S.queue.filter((id) => !drop(id)); if (!cur) S.qi = -1; save(); renderUpNext(); render(false); } });
  items.push('-');
  if (one) items.push({ text: tr('m.export'), onClick: () => openExport(one) });
  if (one && bridge.isElectron) items.push({ text: tr('m.trim'), onClick: () => trim.open(one) });
  if (one) items.push({ text: tr('m.edit'), onClick: () => editTrack(one) });
  if (one) items.push({ text: tr('m.cover'), onClick: () => setTrackCover(one) });
  if (one && one.customCover) items.push({ text: tr('m.coverRestore'), onClick: () => { one.cover = one.origCover || null; one.customCover = false; coverChanged(one); } });
  if (one && bridge.isElectron) items.push({ text: tr('m.reveal'), onClick: () => bridge.library.reveal(one.path) });
  items.push({ text: tr('m.delLib'), danger: true, onClick: () => removeFromLibrary(ids) });
  ctxMenu(x, y, items);
}

/* ===================== tray, taskbar & system media controls ===================== */
let sleepAtEnd = false;
/** sleep timer: a slow 20-second fade, then pause, then the volume comes back for next time */
async function sleepFade() {
  if (!engine.playing) return;
  const g = engine.master.gain, t = engine.ctx.currentTime;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + 20);
  await new Promise((r) => setTimeout(r, 20200));
  await engine.pause();
  engine.setVolume(engine.volume);
  toast(tr('sleep.done'));
}
function bindMedia() {
  const push = () => {
    const t = S.current;
    bridge.media && bridge.media.state({ title: t ? t.title : '', artist: t ? artistOf(t) : '', album: t ? t.album || '' : '', cover: t ? t.cover || null : null, playing: engine.playing, hasTrack: !!t, position: engine.time, duration: engine.duration, rate: engine.rate });
    const ms = navigator.mediaSession;
    if (ms && t) {
      // Windows shows this in its media flyout and on the lock screen; hardware media keys work too
      try {
        const artwork = t.cover ? [{ src: bridge.mediaUrl(t.cover), sizes: '512x512' }] : [];
        if (!ms.metadata || ms.metadata.title !== t.title || ms.metadata.artist !== artistOf(t)) ms.metadata = new MediaMetadata({ title: t.title, artist: artistOf(t), album: t.album || '', artwork });
        ms.playbackState = engine.playing ? 'playing' : 'paused';
      } catch {}
    }
  };
  for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'seeked']) engine.addEventListener(ev, push);
  const ms = navigator.mediaSession;
  if (ms) {
    const on = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
    on('play', () => (S.current ? engine.play() : togglePlay())); on('pause', () => engine.pause());
    on('nexttrack', () => next()); on('previoustrack', () => prev());
    on('seekto', (d) => d && d.seekTime != null && engine.seek(d.seekTime));
  }
  if (bridge.media) bridge.media.onCommand((cmd) => {
    if (cmd === 'toggle') togglePlay();
    // Android: the notification, the lock screen and headset buttons
    else if (cmd === 'play') (S.current ? engine.play() : togglePlay());
    else if (cmd === 'pause') engine.pause();
    else if (cmd.startsWith('seek:')) engine.seek(+cmd.slice(5));
    else if (cmd === 'next') next();
    else if (cmd === 'prev') prev();
    else if (cmd === 'mute') { engine.setMuted(!engine.muted); bindDeck.paintVol(); }
    else if (cmd.startsWith('vol:')) { engine.setMuted(false); bindDeck.setVol(+cmd.slice(4) / 100); }
    else if (cmd === 'volUp' || cmd === 'volDown') { engine.setMuted(false); bindDeck.setVol(clamp(engine.volume + (cmd === 'volUp' ? .05 : -.05), 0, 1)); }
    else if (cmd === 'sleep') sleepFade();
    else if (cmd.startsWith('sleepMode:')) { sleepAtEnd = cmd.endsWith('end'); toast(tr('sleep.' + cmd.slice(10))); }
  });
  push();
  bindMedia.push = push;
}

/** Esc / Android «Back»: closes the topmost layer; false when nothing was open */
function closeTop() {
  if (closePopover()) return true;
  if ($('.ctxmenu.open')) { closeCtx(); return true; }
  if ($('#modal').classList.contains('open')) { closeModal(); return true; }
  if (visual.isOpen) { visual.close(); return true; }
  if (deep.isOpen) { deep.close(); return true; }
  if (tools.isOpen) { tools.close(); return true; }
  return false;
}

/* ============================== hybrid search ============================== */
const searchEl = $('#search'), input = $('#searchInput'), pop = $('#searchPop'), scope = $('#searchScope');
let kb = -1;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
let lastVia = null; // the other-keyboard-layout reading that produced the results, if any
function localMatches(q, limit = 200) {
  const r = fuzzySearch(S.tracks, q, limit);
  lastVia = r.via;
  return r.list;
}
const mark = (text, q) => {
  // highlight on the raw text, escape each piece afterwards (so "amp" never splits "&amp;")
  const terms = norm(lastVia || q).split(/\s+/).filter((x) => x.length > 1);
  if (!terms.length) return esc(text);
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return String(text ?? '').split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
};
const isUrl = (q) => /^(https?:\/\/|www\.)\S+$/i.test(q) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(q);
function renderPop() {
  const q = input.value.trim();
  pop.innerHTML = '';
  if (!q) { pop.classList.remove('open'); scope.textContent = tr('scope.local'); scope.classList.remove('web'); return; }
  if (isUrl(q)) {
    scope.textContent = tr('scope.link'); scope.classList.add('web');
    const it = h('div', { class: 'sp-web' }, h('div', { class: 'globe', html: ICON.link }),
      h('div', {}, h('b', {}, tr('sp.link')), h('small', {}, tr('sp.linkD'))), h('kbd', {}, '↵'));
    it.onmousedown = (e) => { e.preventDefault(); openLinkView(q); };
    pop.append(it); kb = -1; pop.classList.add('open'); return;
  }
  const local = localMatches(q, 6);
  scope.textContent = local.length ? tr('scope.both') : tr('scope.web');
  scope.classList.toggle('web', !local.length);
  pop.append(h('div', { class: 'sp-head' }, h('span', {}, tr('sp.lib')), h('span', {}, local.length ? tr('sp.play') : '')));
  if (lastVia && local.length) pop.append(h('div', { class: 'sp-via' }, tr('sp.via', { q: lastVia })));
  if (!local.length) pop.append(h('div', { class: 'sp-empty' }, tr('sp.none')));
  local.forEach((t) => {
    const it = h('div', { class: 'sp-item', html: `<div class="thumb" style='background:${art(t)}'></div><div style="min-width:0"><div class="t">${mark(t.title, q)}</div><div class="a">${mark(artistOf(t), q)}${t.album ? ' · ' + mark(t.album, q) : ''}</div></div><div class="d">${fmt(t.duration)}</div>` });
    it.onmousedown = (e) => { e.preventDefault(); const list = localMatches(q).map((x) => x.id); playFrom(list, list.indexOf(t.id)); closeSearch(); };
    pop.append(it);
  });
  const web = h('div', { class: 'sp-web' },
    h('div', { class: 'globe', html: ICON.globe }),
    h('div', {}, h('b', {}, tr('sp.web', { q })), h('small', {}, tr('sp.webD'))),
    h('kbd', {}, local.length ? 'Shift ↵' : '↵'));
  web.onmousedown = (e) => { e.preventDefault(); openSearchView(q); };
  pop.append(web);
  kb = -1;
  pop.classList.add('open');
}
function closeSearch() { pop.classList.remove('open'); input.blur(); }
function openSearchView(q) { closeSearch(); setView({ type: 'search', q }); }
function openLinkView(url) { closeSearch(); setView({ type: 'link', url }); }
// on a phone the old query is selected, so typing starts a new one instead of editing it
input.addEventListener('focus', () => { searchEl.classList.add('focus'); renderPop(); if (phone.matches && input.value) setTimeout(() => input.select(), 0); });
input.addEventListener('blur', () => { searchEl.classList.remove('focus'); setTimeout(() => pop.classList.remove('open'), 120); });
input.addEventListener('input', debounce(renderPop, 60));
input.addEventListener('keydown', (e) => {
  e.stopPropagation();
  const items = $$('.sp-item, .sp-web', pop);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    kb = clamp(kb + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    items.forEach((x, i) => x.classList.toggle('kb', i === kb));
  } else if (e.key === 'Enter') {
    const q = input.value.trim(); if (!q) return;
    if (kb >= 0 && items[kb]) items[kb].dispatchEvent(new MouseEvent('mousedown'));
    else if (isUrl(q)) openLinkView(q);
    // the phone's «Go» key and Shift+↵ open the full results (library + the web); plain ↵ on the desktop plays the best match
    else if (e.shiftKey || phone.matches || !localMatches(q, 1).length) openSearchView(q);
    else { const list = localMatches(q).map((x) => x.id); playFrom(list, 0); closeSearch(); } // ↵ plays the best match
  } else if (e.key === 'Escape') { input.value = ''; renderPop(); input.blur(); }
});

let searchSeq = 0;
function viewSearch(host) {
  const q = S.view.q;
  const local = localMatches(q);
  host.append(header({ kicker: tr('s.kicker'), title: `<span class="serif">«</span>${esc(q)}<span class="serif">»</span>`, sub: tr('s.sub') }));
  host.append(h('div', { class: 'sec-title' }, tr('s.inLib', { n: local.length })));
  if (lastVia && local.length) host.append(h('div', { class: 'sp-via' }, tr('sp.via', { q: lastVia })));
  if (local.length) host.append(trackList(local.map((t) => t.id), {}));
  else host.append(h('div', { class: 'sp-empty' }, tr('s.noLib')));
  if (!bridge.web.search) return; // the phone has no web search yet
  const webBox = h('div');
  host.append(h('div', { class: 'sec-title' }, h('span', {}, tr('s.open')), h('span', { class: 'badge lic' }, tr('s.lic'))), webBox);
  for (let i = 0; i < 4; i++) webBox.append(h('div', { class: 'skel', style: { opacity: 1 - i * .2 } }));
  const my = ++searchSeq;
  bridge.web.search(q, { jamendoClientId: S.settings.jamendoClientId || JAMENDO_CLIENT_ID }).then(({ results, errors, query }) => {
    if (my !== searchSeq || !webBox.isConnected) return;
    webBox.innerHTML = '';
    if (query && results.length) webBox.append(h('div', { class: 'sp-via' }, tr('s.asked', { q: query })));
    if (!results.length) webBox.append(h('div', { class: 'sp-empty' }, tr('s.noWeb')));
    results.forEach((r, i) => webBox.append(webRow(r, i, results)));
    if (errors.length) webBox.append(h('div', { class: 'notice' }, tr('s.down', { list: errors.map((e) => e.provider).join(', ') })));
  }).catch((e) => { if (webBox.isConnected) webBox.innerHTML = `<div class="notice">${esc(tr('s.fail', { msg: e.message }))}</div>`; });
  host.append(soundcloudCard(q), linkCard());
}

/* ----------------------- SoundCloud: open search in the browser ----------------------- */
function soundcloudCard(q) {
  const open = () => bridge.web.open('https://soundcloud.com/search?q=' + encodeURIComponent(q));
  return h('div', { class: 'link-card sc-card' },
    h('div', { class: 'lc-ico sc', html: '<svg viewBox="0 0 24 24"><path class="fill" d="M2 14.5c0-1 .5-1.8 1.2-2.1v4.3C2.5 16.3 2 15.5 2 14.5zm2.2-2.6h.9v5.3h-.9zm1.9-.6h.9v5.9h-.9zm1.9-.7h.9v6.6H8zm1.9-1.3h.9v7.9h-.9zm1.9-.8c.9-.6 2-1 3.1-1 2.9 0 5.2 2.1 5.5 4.8.3-.1.6-.2 1-.2 1.7 0 3 1.4 3 3s-1.3 3-3 3h-9.6z"/></svg>' }),
    h('div', { class: 'lc-main' },
      h('b', {}, tr('sc.title', { q })),
      h('small', {}, tr('sc.desc')),
      h('div', { class: 'lc-row' }, pill(tr('sc.btn'), ICON.kLink, open))));
}

/* ----------------------- any site: paste a link ----------------------- */
function linkCard(value = '') {
  const inp = h('input', { class: 'link-input', placeholder: tr('lc.ph'), value, spellcheck: 'false' });
  const go = () => { const v = inp.value.trim(); if (v) openLinkView(v); };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); };
  return h('div', { class: 'link-card' },
    h('div', { class: 'lc-ico', html: ICON.link }),
    h('div', { class: 'lc-main' },
      h('b', {}, tr('lc.title')),
      h('small', {}, tr('lc.desc')),
      h('div', { class: 'lc-row' }, inp, pill(tr('lc.btn'), ICON.kDownload, go))));
}
function viewLink(host) {
  const url = S.view.url;
  let shown = url; try { shown = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch {}
  host.append(header({ kicker: tr('lk.kicker'), title: esc(shown), sub: url }));
  if (!bridge.web.extract) return host.append(h('div', { class: 'sp-empty' }, tr('s.noLib')));
  const box = h('div');
  host.append(h('div', { class: 'sec-title' }, tr('lk.sec')), box);
  for (let i = 0; i < 3; i++) box.append(h('div', { class: 'skel', style: { opacity: 1 - i * .25 } }));
  const my = ++searchSeq;
  bridge.web.extract(url).then(({ page, results }) => {
    if (my !== searchSeq || !box.isConnected) return;
    box.innerHTML = '';
    if (page.title) host.querySelector('.v-sub').textContent = page.title + ' · ' + page.url;
    if (!results.length) {
      box.append(h('div', { class: 'notice', html: '<span>ⓘ</span><span>' + tr('lk.none') + '</span>' }));
    } else {
      box.previousSibling.textContent = tr('lk.secN', { n: results.length });
      results.forEach((r, i) => box.append(webRow(r, i)));
      box.append(h('div', { class: 'notice', html: '<span>ⓘ</span><span>' + tr('lk.rights') + '</span>' }));
    }
    host.append(linkCard());
  }).catch((e) => {
    if (!box.isConnected) return;
    box.innerHTML = '';
    box.append(h('div', { class: 'notice' }, tr('lk.fail', { msg: cleanErr(e) })));
    host.append(linkCard(url));
  });
}
let previewing = null;
function stopPreview() {
  if (!previewing) return;
  preview.pause(); previewing = null;
  $$('.web-row .icon-btn.on').forEach((b) => { b.classList.remove('on'); b.innerHTML = ICON.play; });
}
preview.addEventListener('ended', stopPreview);
preview.addEventListener('error', () => { if (previewing) { stopPreview(); toast(tr('w.noPreview')); } });
function webRow(r, i, list = [r]) {
  const prevBtn = h('button', { class: 'icon-btn web-play', title: tr('w.listen'), html: ICON.play });
  const dl = h('button', { class: 'chrome-pill sm progress-pill dl' }, h('span', { class: 'pp-fill' }), h('span', { class: 'cp-ico', html: ICON.kDownload }), h('span', { class: 'lbl' }, tr('w.dl')));
  const link = h('button', { class: 'icon-btn', title: tr('w.page'), html: ICON.link });
  const row = h('div', { class: 'web-row', style: { '--i': i }, dataset: { wid: r.id } },
    r.cover ? h('div', { class: 'web-ico cover', style: { background: `url("${r.cover}") center/cover` } }) : h('div', { class: 'web-ico', html: ICON.note }),
    h('div', { class: 'web-meta' }, h('div', { class: 't' }, r.title),
      h('div', { class: 's' }, h('span', {}, r.artist || '—'), h('span', { class: 'badge' }, r.providerLabel), r.license ? h('span', { class: 'badge lic' }, r.license) : null,
        h('span', { class: 'badge' }, r.format || 'AUDIO'), r.duration ? h('span', { class: 'mono' }, fmt(r.duration)) : null)),
    prevBtn, link, r.fileUrl ? dl : h('span', { class: 'web-nodl', title: tr('w.noDl') }, tr('w.streamOnly')));
  prevBtn.onclick = () => {
    const t = streamTrack(r);
    if (S.current === t) { togglePlay(); return; }
    // the whole result list becomes the queue, so «next» goes on to the next result
    const ids = list.filter((x) => x.streamUrl).map((x) => streamTrack(x).id);
    playFrom(ids, Math.max(0, ids.indexOf(t.id)));
  };
  link.onclick = () => r.pageUrl && bridge.web.open(r.pageUrl);
  dl.onclick = async () => {
    if (dl.disabled) return;
    dl.disabled = true; dl.querySelector('.lbl').textContent = '0%';
    try {
      const t = await bridge.web.download(r);
      if (!T(t.id)) { S.tracks.push(t); index(); save(); renderSidebar(); }
      dl.querySelector('.pp-fill').style.width = '100%';
      dl.querySelector('.lbl').textContent = tr('w.inLib');
      dl.querySelector('.cp-ico').innerHTML = ICON.kCheck;
      importToast([t.id], tr('toast.downloaded'));
    } catch (e) {
      dl.disabled = false; dl.querySelector('.lbl').textContent = tr('w.retry');
      dl.querySelector('.pp-fill').style.width = '0';
      toast(tr('w.rejected', { msg: cleanErr(e) }));
    }
  };
  return row;
}
bridge.web.onProgress(({ id, received, total }) => {
  const row = $(`.web-row[data-wid="${CSS.escape(id)}"]`); if (!row) return;
  const p = total ? received / total : 0;
  row.querySelector('.pp-fill').style.width = (p * 100).toFixed(1) + '%';
  row.querySelector('.lbl').textContent = total ? Math.round(p * 100) + '%' : (received / 1048576).toFixed(1) + ' ' + tr('mb');
});

/* ============================== deck controls ============================== */
function syncModeBtns() {
  $('#shuffleBtn').classList.toggle('on', S.shuffle);
  const r = $('#repeatBtn'); r.classList.toggle('on', S.repeat !== 'off'); r.classList.toggle('one', S.repeat === 'one');
  r.title = tr('rep.' + S.repeat) + ' (R)';
}
function bindDeck() {
  $('#playBtn').onclick = togglePlay;
  $('#nextBtn').onclick = () => next();
  $('#prevBtn').onclick = prev;
  $('#shuffleBtn').onclick = () => { S.shuffle = !S.shuffle; applyShuffle(S.shuffle); syncModeBtns(); renderUpNext(); save(); if (S.view.type === 'queue') render(false); };
  $('#repeatBtn').onclick = () => { S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat]; syncModeBtns(); save(); };
  // crossfade: the next track starts before this one ends (not on «repeat one», not when sleeping after this track)
  engine.addEventListener('nearend', () => {
    if (!S.settings.crossfade || sleepAtEnd || S.repeat === 'one' || !S.queue.length) return;
    if (S.qi >= S.queue.length - 1 && S.repeat !== 'all') return;
    next(true, S.settings.crossfade);
  });
  engine.addEventListener('ended', () => {
    if (sleepAtEnd) { sleepAtEnd = false; bridge.media && bridge.media.sleepEnded && bridge.media.sleepEnded(); engine.seek(0); toast(tr('sleep.done')); return; }
    next(true);
  });
  engine.addEventListener('play', () => {
    stopPreview();
    document.body.classList.add('playing'); document.body.classList.remove('paused');
    // a single soft light impulse around Play — not a constant neon glow
    const pb = $('#playBtn'); pb.classList.remove('impulse'); void pb.offsetWidth; pb.classList.add('impulse');
    clearTimeout(pb._imp); pb._imp = setTimeout(() => pb.classList.remove('impulse'), 1200);
    maybeShowcase();
  });
  engine.addEventListener('pause', () => { document.body.classList.remove('playing'); document.body.classList.add('paused'); save(); markWebRows(); });
  engine.addEventListener('play', markWebRows);
  engine.addEventListener('error', () => { if (S.current && !engine.loading) toast(tr('toast.fileGone', { title: S.current.title })); });

  // seek bar
  const seek = $('#seek'), tip = $('#seekTip'), fill = $('#seekFill'), thumb = $('#seekThumb');
  let dragging = false, dragP = 0;
  const pAt = (x) => { const r = seek.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
  seek.addEventListener('pointermove', (e) => {
    const p = pAt(e.clientX);
    tip.style.left = p * 100 + '%'; tip.textContent = fmt(p * engine.duration);
    wave.hover = p; if (!dragging) wave.draw();
  });
  seek.addEventListener('pointerleave', () => { wave.hover = -1; wave.draw(); });
  dragValue(seek, {
    onStart: (e) => { dragging = true; dragP = pAt(e.clientX); },
    onMove: (e) => { dragP = pAt(e.clientX); },
    // where the finger was lifted: a quick flick ends past its last move event
    onEnd: (e) => { dragging = false; if (e && e.type === 'pointerup') dragP = pAt(e.clientX); engine.seek(dragP * engine.duration); }
  });
  let lastSec = -1;
  const nhDot = $('#nhDot'), nhTime = $('#nhTime'), nhState = $('#nhState'), nhNum = $('#nhNum');
  let lastP = -1;
  const tick = () => {
    requestAnimationFrame(tick);
    if (document.documentElement.classList.contains('win-hidden') || document.hidden) return;
    const d = engine.duration, p = dragging ? dragP : (d ? engine.time / d : 0);
    if (Math.abs(p - lastP) > 1e-4) { // only touch the DOM when something moved
      lastP = p;
      fill.style.width = p * 100 + '%'; thumb.style.left = p * 100 + '%';
      wave.progress(p);
      nhDot.style.left = p * 100 + '%';
    }
    const sec = Math.floor(dragging ? dragP * d : engine.time);
    if (sec !== lastSec) {
      lastSec = sec; $('#curTime').textContent = fmt(sec); $('#durTime').textContent = fmt(d);
      // the small HUD readout in "Now playing": ▶ 00:45 ————• 003
      nhTime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      nhState.textContent = engine.playing ? '▶' : 'Ⅱ';
      nhNum.textContent = String(Math.max(1, S.qi + 1)).padStart(3, '0');
    }
  };
  requestAnimationFrame(tick);

  // volume slider
  const vol = $('#vol'), vf = $('#volFill'), vt = $('#volThumb'), val = $('#volVal');
  const paintVol = () => {
    const v = engine.muted ? 0 : engine.volume, pc = (engine.volume * 100).toFixed(1) + '%';
    vf.style.width = pc; vt.style.left = pc; val.style.left = pc;
    val.textContent = engine.muted ? tr('vol.mute') : Math.round(engine.volume * 100) + '%';
    vol.classList.toggle('muted', engine.muted);
    $('#muteBtn').classList.toggle('on', engine.muted);
    $('.vol-w1').style.opacity = v > 0.05 ? 1 : 0; $('.vol-w2').style.opacity = v > .5 ? 1 : 0;
  };
  const setVol = (v) => { engine.setMuted(false); engine.setVolume(clamp(v, 0, 1)); S.settings.volume = engine.volume; paintVol(); save(); };
  const vAt = (x) => { const r = vol.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
  dragValue(vol, { onStart: (e) => setVol(vAt(e.clientX)), onMove: (e) => setVol(vAt(e.clientX)) });
  vol.addEventListener('wheel', (e) => { e.preventDefault(); setVol(engine.volume + (e.deltaY < 0 ? .04 : -.04)); }, { passive: false });
  $('#muteBtn').onclick = () => { engine.setMuted(!engine.muted); paintVol(); };
  engine.setVolume(S.settings.volume); paintVol();
  bindDeck.setVol = setVol; bindDeck.paintVol = paintVol;
}

/* ============================== language ============================== */
const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function applyLang(l, initial) {
  setLang(l);
  S.settings.lang = getLang();
  bridge.app.setLang && bridge.app.setLang(getLang());
  applyStatic();
  if (initial) return;
  save();
  syncModeBtns();
  applyTheme(S.settings.theme);
  renderSidebar(); render(false); renderUpNext();
  if (S.current) updateNowPlaying(S.current);
  else { $('#npTitle').textContent = tr('np.none'); $('#npArtist').textContent = tr('np.hint'); }
  if (tools && tools.isOpen) tools.show(tools.current);
  renderPop && input.value && renderPop();
}

/* ============================== chrome / settings ============================== */
const DARK_THEMES = new Set(THEMES.filter((t) => t.tone === 'dark').map((t) => t.key));
const PAIR = { soft: 'deep', deep: 'soft', pearl: 'obsidian', obsidian: 'pearl' };
/** Soft ↔ Deep: the light goes out / comes on, spreading from the switch */
function switchSoftDeep() {
  const next = PAIR[S.settings.theme] || 'soft';
  const sw = $('#sdSwitch').getBoundingClientRect();
  const x = sw.left + sw.width / 2, y = sw.top + sw.height / 2;
  if (reducedMotion()) { applyTheme(next); return; }
  if (phone.matches) return dipToTheme(next);
  if (!document.startViewTransition) { applyTheme(next); return; }
  const toDark = DARK_THEMES.has(next);
  document.documentElement.classList.add('sd-vt', toDark ? 'to-dark' : 'to-light');
  const vt = document.startViewTransition(() => applyTheme(next));
  vt.ready.then(() => {
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: toDark ? 900 : 760, easing: toDark ? 'cubic-bezier(.55,0,.25,1)' : 'cubic-bezier(.3,.6,.2,1)', pseudoElement: '::view-transition-new(root)' });
    document.documentElement.animate({ filter: ['brightness(1)', toDark ? 'brightness(.55)' : 'brightness(1.25)'] },
      { duration: toDark ? 900 : 760, easing: 'ease-in', pseudoElement: '::view-transition-old(root)' });
  }).catch(() => {});
  vt.finished.finally(() => document.documentElement.classList.remove('sd-vt', 'to-dark', 'to-light'));
}
/**
 * Soft ↔ Deep on a phone. Drawing the whole screen in the new theme takes a phone ~200 ms (glass blur at
 * ~3 px per point), which a cross-fade or the desktop's circle can only show as a stutter. So the screen
 * dims into the new theme's colour, the theme changes under that veil, and the veil lifts:
 * only the opacity of one layer moves, which the GPU does on its own.
 */
let dipping = false;
async function dipToTheme(next) {
  if (dipping) return;
  dipping = true;
  const veil = h('div', { class: 'theme-veil', style: { background: THEMES.find((t) => t.key === next).bg } });
  document.body.append(veil);
  try {
    await veil.animate({ opacity: [0, 1] }, { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished;
    document.documentElement.classList.add('sd-vt'); // colours switch at once, not through their transitions
    applyTheme(next);
    // two frames: the new theme gets painted (the slow part) while the veil still covers it
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.documentElement.classList.remove('sd-vt');
    await veil.animate({ opacity: [1, 0] }, { duration: 380, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' }).finished;
  } finally { veil.remove(); dipping = false; }
}
function applyTheme(theme) {
  if (LEGACY_THEME[theme]) theme = LEGACY_THEME[theme];
  if (!THEMES.some((t) => t.key === theme)) theme = 'soft';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.tone = toneOf(theme);
  S.settings.theme = theme; save();
  const th = THEMES.find((t) => t.key === theme);
  $('#themeName').textContent = tr(th.name); $('#themeSw').style.background = th.bg;
  bridge.app.setTone && bridge.app.setTone(!DARK_THEMES.has(theme));
  const sd = $('#sdSwitch'); if (sd) { const dark = DARK_THEMES.has(theme); sd.classList.toggle('dark', dark); sd.setAttribute('aria-checked', String(dark)); }
  // accent overrides depend on the tone (darker on light themes): re-derive them, then repaint the canvases
  if (look) look.apply(); else refreshCanvases();
}
/** canvases read colours once; after a theme or accent change they read them again */
function refreshCanvases() {
  requestAnimationFrame(() => {
    viz && viz.readTheme(); wave && wave.draw(); bg && bg.readTheme(); shapes && shapes.readTheme();
    tools && tools.panels.eq && tools.panels.eq.drawCurve && tools.panels.eq.drawCurve();
  });
}
function themeCards(onPick) {
  return h('div', { class: 'theme-grid' }, ...THEMES.map((t) => {
    const pv = h('div', { class: 'pv', style: { background: t.bg } },
      h('i', { style: { left: '8%', top: '14%', width: '22%', height: '62%', background: t.p } }),
      h('i', { style: { left: '34%', top: '14%', width: '58%', height: '62%', background: t.p } }),
      h('i', { style: { left: '40%', top: '26%', width: '30%', height: '6%', background: t.t, opacity: .8 } }),
      h('i', { style: { left: '8%', top: '82%', width: '84%', height: '8%', background: t.p } }),
      h('i', { style: { left: '46%', top: '80%', width: '10px', height: '10px', borderRadius: '50%', background: t.a } }));
    const c = h('button', { class: 'theme-card' + (S.settings.theme === t.key ? ' on' : '') }, pv, h('b', {}, tr(t.name)), h('small', {}, tr(t.desc)));
    // the theme changes under a veil: repainting the whole window in the open stutters
    c.onclick = () => { if (t.key === S.settings.theme) return; !reducedMotion() ? dipToTheme(t.key) : applyTheme(t.key); c.parentNode.querySelectorAll('.theme-card').forEach((x) => x.classList.toggle('on', x === c)); onPick && onPick(); };
    return c;
  }));
}

/* ------------------------------- covers ------------------------------- */
async function pickCover() {
  try { return await bridge.covers.pick(); }
  catch (e) { toast(tr('toast.coverFail', { msg: cleanErr(e) })); return null; }
}
async function setTrackCover(t) {
  const p = await pickCover(); if (!p) return;
  if (!t.customCover) t.origCover = t.cover;
  t.cover = p; t.customCover = true;
  coverChanged(t);
  toast(tr('toast.coverOk'));
}
function coverChanged(t) {
  save(); renderSidebar(); render(false); renderUpNext();
  if (S.current === t) { $('#cover').style.background = art(t); $('#deckCover').style.background = art(t); applyPulse(t); }
}
async function setPlaylistCover(pl) {
  const p = await pickCover(); if (!p) return;
  pl.cover = p; save(); renderSidebar();
  if (S.view.type === 'playlist' && S.view.id === pl.id) render(false);
  toast(tr('toast.plCoverOk', { name: pl.name }));
}
/** Settings → «Папка загрузок»: where downloads from open sources go; change, open, back to the default */
function dlRow(paths) {
  const where = h('small', { class: 'mono set-path' }, paths.downloads);
  const reset = h('button', { class: 'text-btn' }, tr('set.dlReset'));
  reset.hidden = !paths.downloadsCustom;
  const change = h('button', { class: 'chip-btn' }, tr('set.dlChange'));
  const open = h('button', { class: 'chip-btn' }, tr('set.dlOpen'));
  change.onclick = async () => {
    try {
      const dir = await bridge.app.pickDownloads();
      if (dir) { where.textContent = dir; reset.hidden = false; toast(tr('set.dlDone')); }
    } catch (e) { toast(/not-writable/.test(String(e && e.message)) ? tr('set.dlNoWrite') : String(e && e.message || e)); }
  };
  open.onclick = () => bridge.app.openDownloads();
  reset.onclick = async () => { where.textContent = await bridge.app.resetDownloads(); reset.hidden = true; };
  if (!bridge.app.pickDownloads) { change.hidden = true; open.hidden = true; }
  return h('div', { class: 'set-row' }, h('div', { class: 'set-dl' }, h('b', {}, tr('set.dl')), where),
    h('div', { class: 'set-acts' }, reset, open, change));
}

/* ------------------------------ mini player ------------------------------ */
/** the strip shown while the window is the small always-on-top player */
function buildMini() {
  if ($('#miniBar')) return;
  const ic = (d) => '<svg viewBox="0 0 24 24"><path class="fill" d="' + d + '"/></svg>';
  const bar = h('div', { id: 'miniBar', class: 'mini-bar' },
    h('div', { class: 'mini-cover', id: 'miniCover' }),
    h('div', { class: 'mini-meta' }, h('b', { id: 'miniTitle' }), h('small', { id: 'miniArtist' }), h('div', { class: 'mini-prog' }, h('i', { id: 'miniProg' }))),
    h('div', { class: 'mini-ctl' },
      h('button', { class: 'tbtn', title: tr('tr.prev'), html: ic('M18 6v12l-8.5-6zM6 6h2.2v12H6z'), onClick: () => prev() }),
      h('button', { class: 'tbtn mini-play', id: 'miniPlay', title: tr('tr.play'), onClick: () => togglePlay() }),
      h('button', { class: 'tbtn', title: tr('tr.next'), html: ic('M6 6v12l8.5-6zM15.8 6H18v12h-2.2z'), onClick: () => next() })),
    h('button', { class: 'mini-back', title: tr('mini.back'), 'aria-label': tr('mini.back'), html: '<svg viewBox="0 0 12 12"><path d="M7 2.5h2.5V5M5 9.5H2.5V7M9.5 2.5 6.6 5.4M2.5 9.5l2.9-2.9"/></svg>', onClick: () => bridge.win.mini(false) }));
  document.body.append(bar);
  const tick = () => {
    requestAnimationFrame(tick);
    if (!document.body.classList.contains('mini')) return;
    const t = S.current, d = engine.duration;
    $('#miniProg').style.transform = 'scaleX(' + (d ? engine.time / d : 0) + ')';
    if (bar.dataset.id !== (t && t.id) || bar.dataset.p !== String(engine.playing)) {
      bar.dataset.id = t ? t.id : ''; bar.dataset.p = String(engine.playing);
      $('#miniCover').style.background = t ? art(t) : '';
      $('#miniTitle').textContent = t ? t.title : tr('np.none');
      $('#miniArtist').textContent = t ? artistOf(t) : '';
      $('#miniPlay').innerHTML = engine.playing ? ic('M6.5 5h3.8v14H6.5zM13.7 5h3.8v14h-3.8z') : ic('M7 4.8v14.4L19 12z');
    }
  };
  requestAnimationFrame(tick);
}

/** Settings → «Воспроизведение»: crossfade, loudness, output device, global hotkeys */
async function playbackRows(tg) {
  const xf = h('div', { class: 'seg' }, ...[[0, tr('pb.off')], [3, '3 ' + tr('pb.s')], [6, '6 ' + tr('pb.s')], [10, '10 ' + tr('pb.s')]].map(([v, l]) => {
    const b = h('button', { class: (S.settings.crossfade || 0) === v ? 'on' : '' }, l);
    b.onclick = () => { S.settings.crossfade = v; engine.crossfade = v; save(); xf.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
    return b;
  }));
  const outs = await engine.outputs();
  const sel = h('select', { class: 'set-input set-select' },
    h('option', { value: '' }, tr('pb.outDefault')),
    ...outs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => h('option', { value: d.deviceId }, d.label || tr('pb.outUnnamed'))));
  sel.value = S.settings.outputId || '';
  sel.onchange = async () => { const ok = await engine.setOutput(sel.value); if (ok) { S.settings.outputId = sel.value; save(); toast(tr('pb.outDone')); } else { sel.value = S.settings.outputId || ''; toast(tr('pb.outFail')); } };
  return [
    h('div', { class: 'set-sec' }, tr('pb.title')),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('pb.xf')), h('small', {}, tr('pb.xfD'))), xf),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('pb.norm')), h('small', {}, tr('pb.normD'))),
      tg(S.settings.normalize, (v) => { S.settings.normalize = v; save(); engine.setTrackGain(normGain(S.current)); })),
    // Android routes the sound itself (speaker, headphones, Bluetooth); the WebView cannot pick a device
    isAndroid ? null : h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('pb.out')), h('small', {}, tr('pb.outD'))), sel),
    ...(bridge.app.globalKeys ? [h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('pb.keys')), h('small', {}, tr('pb.keysD'))),
      tg(S.settings.globalKeys, async (v) => { S.settings.globalKeys = v; save(); const busy = await bridge.app.globalKeys(v); if (busy && busy.length) toast(tr('pb.keysBusy', { keys: busy.join(', ') })); }))] : []),
    ...(bridge.win.mini ? [h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('pb.mini')), h('small', {}, tr('pb.miniD'))),
      tg(S.settings.miniTop, (v) => { S.settings.miniTop = v; save(); if (document.body.classList.contains('mini')) bridge.win.mini(true, v); }))] : [])
  ];
}

/* ------------------------------ updates ------------------------------ */
let updState = null, updToast = null;
function onUpdate(st) {
  updState = st;
  const row = $('#updStatus'); if (row) row.replaceWith(updStatusEl());
  if (st.status === 'available' && !updToast) {
    const acts = h('div', { class: 'tchips' });
    if (st.canInstall !== false) acts.append(h('button', { class: 'tchip', onClick: () => { bridge.update.download(); updToast && updToast.close(); updToast = null; toast(tr('up.downloading')); } }, tr('up.get')));
    else acts.append(h('button', { class: 'tchip', onClick: () => bridge.web.open('https://github.com/infallibl3/soft-deep-sound/releases/latest') }, tr('up.page')));
    updToast = toast(h('span', {}, tr('up.available', { v: st.version })), { timeout: 0, actions: acts });
  }
  if (st.status === 'ready') toast(h('span', {}, tr('up.ready', { v: st.version })), { timeout: 0, actions: h('div', { class: 'tchips' }, h('button', { class: 'tchip', onClick: () => bridge.update.install() }, tr('up.restart'))) });
}
function updStatusEl() {
  const st = updState || {};
  const txt = { checking: tr('up.checking'), latest: tr('up.latest'), available: tr('up.available', { v: st.version }), downloading: tr('up.progress', { p: st.percent || 0 }),
    ready: tr('up.ready', { v: st.version }), error: tr('up.error'), dev: tr('up.dev') }[st.status] || '';
  return h('small', { id: 'updStatus', class: 'upd-status' }, txt);
}
function updateRows() {
  if (!bridge.update) return [];
  const btn = h('button', { class: 'chip-btn' }, tr('up.check'));
  btn.onclick = async () => { btn.disabled = true; onUpdate(await bridge.update.check()); btn.disabled = false; };
  const did = h('input', { class: 'set-input mono', placeholder: tr('ds.idPh'), value: S.settings.discordId || '', spellcheck: 'false' });
  did.onkeydown = (e) => { if (e.key === 'Escape') { did.blur(); closeModal(); return; } e.stopPropagation(); };
  const applyDiscord = async () => { const st = await bridge.discord.set(S.settings.discord, S.settings.discordId); return st; };
  did.onchange = () => { S.settings.discordId = did.value.trim(); save(); applyDiscord(); };
  const tgl = h('button', { class: 'toggle' + (S.settings.discord ? ' on' : '') });
  tgl.onclick = () => { S.settings.discord = !S.settings.discord; tgl.classList.toggle('on', S.settings.discord); save(); if (S.settings.discord && !/^\d{15,22}$/.test(S.settings.discordId || '')) toast(tr('ds.needId')); applyDiscord(); };
  return [
    h('div', { class: 'set-sec' }, tr('up.sec')),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('up.title', { v: (updState && updState.current) || '' })), updStatusEl()), btn),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('ds.title')), h('small', {}, tr('ds.desc'))), h('div', { class: 'set-acts' }, did, tgl))
  ];
}

/* economy mode: no sphere, no living background, no blur, no entrance animations — for slower phones and PCs.
   It's read once at start (early.js), so switching it asks for a restart: the interface reloads, the library
   is saved first. */
const ecoWanted = () => { try { return localStorage.getItem('sds-eco') === '1'; } catch { return ECO; } };
function setEco(on) {
  try { localStorage.setItem('sds-eco', on ? '1' : '0'); } catch {}
  S.settings.eco = on; save();
  if (on === ECO) return;   // switched back before restarting: nothing to do
  const restart = async () => { try { await (save.flush && save.flush()); } catch {} location.reload(); };
  openModal(h('div', { class: 'modal-card' },
    h('div', { class: 'v-kicker' }, tr('set.eco')), h('h3', {}, tr('eco.restartT')),
    h('p', { class: 'modal-p' }, tr(on ? 'eco.restartOn' : 'eco.restartOff')),
    h('div', { class: 'modal-acts' },
      h('span', { class: 'grow' }),
      h('button', { class: 'chip-btn', onClick: () => { closeModal(); setTimeout(openSettings, 60); } }, tr('eco.later')),
      h('button', { class: 'chip-btn on', onClick: restart }, tr('eco.now')))));
}

async function openSettings() {
  const paths = await bridge.app.paths();
  const prefs = bridge.app.prefs ? await bridge.app.prefs() : null;
  const tg = (on, fn) => { const t = h('button', { class: 'toggle' + (on ? ' on' : '') }); t.onclick = () => { t.classList.toggle('on'); fn(t.classList.contains('on')); }; return t; };
  const jam = h('input', { class: 'set-input', placeholder: tr('set.jamPh'), value: S.settings.jamendoClientId || '' });
  jam.onchange = () => { S.settings.jamendoClientId = jam.value.trim(); save(); };
  jam.onkeydown = (e) => { if (e.key === 'Escape') { jam.blur(); closeModal(); return; } e.stopPropagation(); };
  openModal(h('div', { class: 'modal-card' },
    h('div', { class: 'v-kicker' }, tr('set.kicker')), h('h3', {}, tr('set.title')),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.lang')), h('small', {}, tr('set.langD'))),
      h('div', { class: 'seg' }, ...LANGS.map(([k, name]) => h('button', { class: getLang() === k ? 'on' : '', onClick: () => { applyLang(k); openSettings(); } }, name)))),
    h('div', { class: 'set-row', style: { display: 'block' } }, h('b', { style: { marginBottom: '10px' } }, tr('set.theme')), themeCards()),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.eco')), h('small', {}, tr('set.ecoD'))), tg(ecoWanted(), setEco)),
    look.panel(() => S.current),
    // a phone has no «Состояние медиатеки» tab: it opens from here (and from the library's plaque)
    phone.matches ? h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.health')), h('small', {}, tr('set.healthD'))),
      h('button', { class: 'chip-btn', onClick: () => { closeModal(); setView({ type: 'health' }); } }, tr('set.open'))) : null,
    ...(await playbackRows(tg)),
    ...updateRows(),
    // desktop only: panel layout, the Jamendo key for the web search, keyboard shortcuts
    isAndroid ? null : h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.layout')), h('small', {}, tr('set.layoutD'))), h('button', { class: 'chip-btn', onClick: () => layout.reset() }, tr('set.reset'))),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.chime')), h('small', {}, tr('set.chimeD'))), tg(S.settings.chime, (v) => { S.settings.chime = v; save(); })),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.bg')), h('small', {}, tr('set.bgD'))), tg(S.settings.bgAnalyze, (v) => { S.settings.bgAnalyze = v; save(); if (v) backgroundAnalyze(); })),
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.lyrics')), h('small', {}, tr('set.lyricsD'))), tg(S.settings.lyricsOnline, (v) => { S.settings.lyricsOnline = v; save(); lyricsCache.clear(); })),
    prefs ? h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.tray')), h('small', {}, tr('set.trayD'))), tg(prefs.closeToTray, (v) => bridge.app.setPref('closeToTray', v))) : null,
    prefs && prefs.autostart !== null && prefs.autostart !== undefined ? h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.auto')), h('small', {}, tr('set.autoD'))), tg(prefs.autostart, (v) => bridge.app.setPref('autostart', v))) : null,
    h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('tour.set')), h('small', {}, tr('tour.setD'))), h('button', { class: 'chip-btn', onClick: () => { closeModal(); setTimeout(() => tour.start(), 380); } }, tr('tour.setBtn'))),
    isAndroid ? null : h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.jam')), h('small', {}, tr('set.jamD'))), jam),
    dlRow(paths),
    isAndroid ? null : h('div', { class: 'set-row' }, h('div', {}, h('b', {}, tr('set.keys')),
      h('small', { html: tr('set.keysD') }))),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'chip-btn', onClick: closeModal }, tr('set.done')))));
}

async function pickImport(kind) {
  try { importPaths(await bridge.library.pick(kind)); }
  catch (e) { console.error(e); toast(tr(/permission/.test(e.message) ? 'and.denied' : 'toast.importFail', { msg: e.message || e })); }
}

function bindChrome() {
  $$('[data-win]').forEach((b) => (b.onclick = () => bridge.win[b.dataset.win]()));
  $('#themeBtn').onclick = (e) => popover(e.currentTarget, h('div', {}, h('div', { class: 'pop-title' }, tr('pop.theme')), themeCards(),
    h('div', { class: 'pop-title ap-pop-title' }, tr('ap.accentShort')), look.accentRow(() => S.current, true)));
  $('#layoutBtn').onclick = (e) => layout.menu(e.currentTarget);
  $('#brandHome').onclick = () => { closePopover(); if (tools.isOpen) tools.close(); setView({ type: 'library' }); };
  $('#coverEdit').onclick = (e) => { e.stopPropagation(); if (S.current) setTrackCover(S.current); };
  $('#coverEdit').addEventListener('dblclick', (e) => e.stopPropagation());
  $('#sessionBtn').onclick = openSession;
  $('#helpBtn').onclick = () => tour.start();
  $('#npExpand').onclick = () => deep.show('info');
  $('#npLyrics').onclick = () => deep.show('lyrics');
  $('#viz').addEventListener('click', () => visual.show());
  $('#viz').title = tr('vis.open');
  $('#sdSwitch').onclick = () => switchSoftDeep();
  $('#rackExport').onclick = () => openExport();
  $('#nowplaying').addEventListener('dblclick', (e) => { if (e.target.closest('.upnext, button, .panel-handle, .np-next-head')) return; deep.show(); });
  $('#deckCover').addEventListener('dblclick', () => deep.show());
  $('.deck-left').addEventListener('click', () => { if (phone.matches && S.current) deep.show(); });
  $('#importBtn .cp-ico').innerHTML = ICON.kImport;
  $('#settingsBtn').onclick = openSettings;
  $('#importBtn').onclick = () => pickImport('files');
  $('#importFolderBtn').onclick = () => pickImport('folder');
  $('#newPlaylistBtn').onclick = newPlaylistInline;
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView({ type: b.dataset.view })));
  bridge.onOpenFiles((files) => openFiles(files));
  if (bridge.app.pendingFiles) setTimeout(async () => { const f = await bridge.app.pendingFiles(); if (f && f.length) openFiles(f); }, 0);
  // maximise button shows "restore" while maximised; on macOS full screen hides the traffic lights
  if (bridge.win && bridge.win.onState) bridge.win.onState(({ maximized, fullscreen }) => {
    if (fullscreen !== undefined) { document.documentElement.classList.toggle('fs', fullscreen); return; }
    const b = $('[data-win="max"]');
    if (!b) return;
    b.innerHTML = maximized ? '<svg viewBox="0 0 12 12"><rect x="2" y="3.6" width="6.4" height="6.4" rx="1.3"/><path d="M4 3.6V2.8A1 1 0 0 1 5 1.8h4.2a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1h-.8"/></svg>'
      : '<svg viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.5"/></svg>';
    b.title = tr(maximized ? 'win.restore' : 'win.max');
  });

  // OS file drag & drop
  const ov = $('#dropOverlay');
  let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const inDialog = () => $('#modal').classList.contains('open');
  addEventListener('dragenter', (e) => { if (!isFiles(e) || inDialog()) return; depth++; ov.classList.add('on'); });
  addEventListener('dragleave', (e) => { if (!isFiles(e)) return; if (--depth <= 0) { depth = 0; ov.classList.remove('on'); } });
  addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if (!isFiles(e)) return;
    if (inDialog()) { e.preventDefault(); depth = 0; ov.classList.remove('on'); return; }
    e.preventDefault(); depth = 0; ov.classList.remove('on');
    const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean);
    importPaths(paths);
  });

  // Android «Back»: close what is on top, then return to the library, and only then hide the app (the music keeps playing)
  document.addEventListener('sdsback', () => {
    if (tour.isOpen) { tour.close(); return; }
    if (document.activeElement === input || pop.classList.contains('open')) { input.value = ''; renderPop(); input.blur(); return; }
    if (closeTop()) return;
    if (S.view.type !== 'library') { setView({ type: 'library' }); return; }
    bridge.app.minimize && bridge.app.minimize();
  });

  // keyboard — matched by physical key (e.code), so it works in any layout and with Caps Lock
  addEventListener('keydown', (e) => {
    if (document.getElementById('splash')) return; // the first key only dismisses the intro
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key, c = e.code, ctrl = e.ctrlKey || e.metaKey;
    const modal = $('#modal').classList.contains('open');
    const overlay = visual.isOpen || deep.isOpen;
    if (k === 'Escape') { closeTop(); return; }
    if (modal || e.altKey) return;
    if ((ctrl && c === 'KeyK') || (!ctrl && k === '/')) { if (overlay) return; e.preventDefault(); input.focus(); input.select(); return; }
    if (ctrl && c === 'KeyS') { e.preventDefault(); if (deep.isOpen) deep.close(); if (visual.isOpen) visual.close(); openExport(); return; }
    if (c === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
    if (c === 'ArrowRight' && ctrl) { if (!e.repeat) next(); return; }
    if (c === 'ArrowLeft' && ctrl) { if (!e.repeat) prev(); return; }
    if (c === 'ArrowRight') { engine.seek(engine.time + (e.shiftKey ? 15 : 5)); return; }
    if (c === 'ArrowLeft') { engine.seek(engine.time - (e.shiftKey ? 15 : 5)); return; }
    if (c === 'ArrowUp') { e.preventDefault(); bindDeck.setVol(engine.volume + .05); return; }
    if (c === 'ArrowDown') { e.preventDefault(); bindDeck.setVol(engine.volume - .05); return; }
    if (ctrl || e.repeat) return;
    const tool = (name) => { if (deep.isOpen) deep.close(); if (visual.isOpen) visual.close(); tools.open(name); };
    switch (c) {
      case 'KeyM': engine.setMuted(!engine.muted); bindDeck.paintVol(); break;
      case 'KeyS': $('#shuffleBtn').click(); break;
      case 'KeyR': $('#repeatBtn').click(); break;
      case 'KeyP': tool('pitch'); break;
      case 'KeyA': tool('ambient'); break;
      case 'KeyE': tool('eq'); break;
      case 'KeyF': if (visual.isOpen) visual.close(); deep.toggle(); break;
      case 'KeyL': if (visual.isOpen) visual.close(); deep.toggleLyrics(); break;
      case 'KeyK': if (visual.isOpen) visual.close(); deep.toggleTv(); break;
      case 'KeyV': if (deep.isOpen) deep.close(); visual.isOpen ? visual.close() : visual.show(); break;
      case 'KeyD': switchSoftDeep(); break;
    }
  });;
}

/* ================================ boot ================================ */
async function boot() {
  await loadState();
  applyLang(S.settings.lang || detectLang(), true);
  if (LEGACY_THEME[S.settings.theme]) S.settings.theme = LEGACY_THEME[S.settings.theme];
  if (!THEMES.some((t) => t.key === S.settings.theme)) S.settings.theme = 'soft';
  document.documentElement.dataset.theme = S.settings.theme;
  document.documentElement.dataset.tone = toneOf(S.settings.theme);
  document.documentElement.classList.toggle('android', isAndroid);
  const splash = runSplash({ ctx: engine.ctx, sound: S.settings.chime });

  viz = new Visualizer($('#viz'), engine.viz, () => engine.playing);
  viz.bassEls = [$('#coverFrame'), $('#playBtn')];
  wave = new WaveSeek($('#waveCanvas'));
  bg = new BackgroundFX($('#bgfx'), { isPlaying: () => engine.playing, energy: () => Math.min(1, viz.bass * 1.4) });
  if (ECO) { viz.eco = true; $('#shapes').remove(); }   // economy mode: no sphere, the living background stays off
  else try { // detailed animated forms; without WebGL the 2D backdrop draws simple bubbles instead
    shapes = new Shapes($('#shapes'), { isPlaying: () => engine.playing, energy: () => Math.min(1, viz.bass * 1.4) });
    bg.gl = true; bg.resize();
  } catch (e) { console.warn('shapes off:', e.message); $('#shapes').remove(); }
  trim = createTrim({ S, bridge, engine, art, artistOf, save, addExported });
  look = createAppearance({ S, save, bridge, toast, hslToRgb, rgbToHsl, coverColor, onChange: refreshCanvases,
    energy: () => (viz && engine.playing ? Math.min(1, viz.bass * 1.4) : 0) });
  layout = new Layout(S.settings, save);
  tools = new Tools({ engine, ambient, settings: S.settings, save, onState: (st) => { renderBadges(); $('#navTools').classList.toggle('fx-on', Object.values(st || {}).some(Boolean)); } });
  $('#navTools').onclick = () => (tools.isOpen ? tools.close() : tools.open());
  deep = new DeepView({
    engine, getTrack: () => S.current, tracks: () => S.tracks, art, artistOf,
    playIds, playNext, next: () => next(), prev, toggle: togglePlay,
    ensureAnalysis: (t) => { if (!analyzed(t) && t.av !== -1) runAnalysis(t); },
    ensureFormat: (t) => ensureFormat(t),
    onSimilar: (t) => { deep.close(); setTimeout(() => setView({ type: 'similar', id: t.id }), 420); },
    getLyrics: (t, force, skipLocal) => getLyrics(t, force, skipLocal),
    setLyricsOffset: (t, sec) => { t.lyricsOffset = sec || undefined; save(); },
    saveLyrics: bridge.lyrics && bridge.lyrics.save ? async (t, text, replace) => {
      let r;
      try { r = await bridge.lyrics.save(t.path, text, replace); }
      catch (e) { toast(/read-only/.test(String(e && e.message)) ? tr('ly.readOnly') : String(e && e.message || e)); throw e; }
      lyricsCache.delete(t.id);
      toast(r && r.backup ? tr('ly.replaced') : r && r.where === 'lrc' ? tr('ly.savedLrc') : tr('ly.savedApp'));
    } : null,
    readClipboard: () => (bridge.lyrics && bridge.lyrics.clipboard ? bridge.lyrics.clipboard() : Promise.resolve('')),
    openUrl: (u) => bridge.web.open(u),
    // the name the lyrics lookup recognised: artist and title, the album only if there was none
    renameTrack: (t, m) => {
      t.artist = m.artist; t.title = m.title;
      if (!t.album && m.album) t.album = m.album;
      t.edited = [...new Set([...(t.edited || []), 'artist', 'title', ...(m.album ? ['album'] : [])])];
      lyricsCache.delete(t.id);
      save(); index(); renderSidebar(); render(false); renderUpNext();
      if (S.current === t) updateNowPlaying(t);
      deep.update();
      toast(tr('ly.renamed', { name: m.artist + ' — ' + m.title }));
    },
    openSettings: () => setTimeout(openSettings, 420)
  });
  visual = new VisualMode({ engine, getTrack: () => S.current, artistOf, toggle: togglePlay });
  repair = createLibraryRepair({ S, bridge, save, art, artistOf, render, importPaths, pickImport, setView,
    refreshArt: () => (S.current ? coverChanged(S.current) : renderUpNext()) });
  tour = createTour({ onDone: () => { S.settings.tourDone = true; save(); }, beforeStep: () => { closePopover(); if (deep.isOpen) deep.close(); if (visual.isOpen) visual.close(); if (tools.isOpen) tools.close(); } });
  applyTheme(S.settings.theme);
  bindDeck(); bindChrome(); syncModeBtns();
  renderSidebar(); render(true); renderUpNext();
  await engine.ready;
  tools.restore();
  engine.crossfade = S.settings.crossfade || 0;
  if (S.settings.globalKeys && bridge.app.globalKeys) bridge.app.globalKeys(true);
  if (bridge.update) { bridge.update.onState(onUpdate); bridge.update.get().then((st) => { updState = st; }); }
  if (bridge.discord && S.settings.discord) bridge.discord.set(true, S.settings.discordId);
  if (bridge.win.mini) {
    $('#miniBtn').onclick = () => { buildMini(); bridge.win.mini(true, S.settings.miniTop); };
    bridge.win.onMini((on) => { if (on) buildMini(); document.body.classList.toggle('mini', on); if (on && deep.isOpen) deep.close(); });
  } else $('#miniBtn').remove();
  if (S.settings.outputId) engine.setOutput(S.settings.outputId).then((ok) => { if (!ok) { S.settings.outputId = ''; save(); } });
  bindMedia();
  if (bridge.app.onFlush) bridge.app.onFlush(() => save.flush && save.flush()); // the app is closing: write now
  if (bridge.app.onVisible) bridge.app.onVisible((v) => document.documentElement.classList.toggle('win-hidden', !v));

  // restore last session (paused, at the last position)
  if (S.qi >= 0 && S.queue[S.qi]) loadCurrent(false, S.lastPos || 0);
  await splash;
  if (isMock && !S.tracks.length) await importPaths(await bridge.library.pick('files'));
  // first start on a phone: ask for «Music and audio» and bring in everything Android already knows
  if (isAndroid && !S.tracks.length) { try { await importPaths(await bridge.library.pick('rescan')); } catch (e) { toast(tr(/permission/.test(e.message) ? 'and.denied' : 'toast.importFail', { msg: e.message })); } }
  if (!S.settings.tourDone && !phone.matches && !/notour/.test(location.hash)) setTimeout(() => { if (!$('#modal').classList.contains('open')) tour.start(WELCOME); }, 900);
  setTimeout(() => backgroundAnalyze(), 6000);
}
boot();
window.__applyTheme = (t) => applyTheme(t);
window.__sds = { S, engine, ambient, get tools() { return tools; }, get deep() { return deep; }, get visual() { return visual; } }; // debugging handle
