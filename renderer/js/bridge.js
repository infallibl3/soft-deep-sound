/**
 * Bridge to the main process. In Electron this is window.sds (preload).
 * In the Android app (Capacitor) the phone's music comes from the MusicLibrary plugin (android/…/MusicLibraryPlugin.java);
 * the iPhone app has its own MusicLibrary (ios/App/App/MusicLibraryPlugin.swift) with the same calls plus a file picker.
 * Opened in a plain browser (UI development / tests) a mock with synthesized demo tracks is used.
 */
const cap = window.Capacitor;
import { cleanName, stripJunk } from './names.js';
import { createWebSearch } from './websearch.js';
import { t as tr } from './i18n.js';
import { createRepair } from './mb-repair.js';

// «isAndroid» means the phone app, Android or iPhone: they share everything but where the music comes from
export const isAndroid = !window.sds && !!(cap && cap.isNativePlatform && cap.isNativePlatform());
export const isIOS = isAndroid && cap.getPlatform() === 'ios';
const OS = isIOS ? 'iOS' : 'Android';
export const isMock = !window.sds && !isAndroid;

function wav(channels, sr) {
  const n = channels[0].length, nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { v.setInt16(o, Math.max(-1, Math.min(1, channels[c][i])) * 32767, true); o += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

async function demoTrack(bpm, root, seconds = 36) {
  const sr = 22050;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const beat = 60 / bpm;
  const out = ctx.createGain(); out.gain.value = .6; out.connect(ctx.destination);
  for (let t = 0; t < seconds; t += beat) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .12);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(.001, t + .28);
    o.connect(g).connect(out); o.start(t); o.stop(t + .3);
    const hb = ctx.createBufferSource(); const nb = ctx.createBuffer(1, sr * .05, sr); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * .008));
    hb.buffer = nb; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const hg = ctx.createGain(); hg.gain.value = .25; hb.connect(hp).connect(hg).connect(out); hb.start(t + beat / 2);
  }
  const chord = [0, 4, 7, 11].map((s) => root * Math.pow(2, s / 12));
  for (const f of chord) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = .05; o.connect(g).connect(out); o.start(0);
  }
  // "vocal" phrases: formant-filtered saw in bars 3-4, 7-8 … (exercises Smart Duck)
  const bar = beat * 4;
  for (let b = 2; b * bar < seconds; b += 4) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * 2;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1200; f2.Q.value = 8;
    const g = ctx.createGain(); const t0 = b * bar, t1 = t0 + bar * 2;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.9, t0 + .1); g.gain.setValueAtTime(.9, t1 - .2); g.gain.linearRampToValueAtTime(0, t1);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(out);
    o.start(t0); vib.start(t0); o.stop(t1); vib.stop(t1);
  }
  const buf = await ctx.startRendering();
  return URL.createObjectURL(wav([buf.getChannelData(0), buf.getChannelData(1)], sr));
}

const DEMO = [
  ['Glass Horizon', 'Aerolume', 'Skylines', 124, 110],
  ['Runner Line', 'Faith & Rooftops', 'Catalyst', 96, 98],
  ['Soft Signal', 'Mira Vale', 'Low Light', 140, 130.8],
  ['Deep Current', 'Northbound', 'Undertow', 78, 87.3],
  ['Chrome Weather', 'Aerolume', 'Skylines', 110, 123.5],
  ['Frosted Avenue', 'Lumen Park', 'Glasshouse', 132, 146.8, 128],
  ['Ïðèâåò ìèð', 'Êèíî', '', 118, 98, 192],
  ['Glass Horizon', 'Aerolume', 'Skylines', 124, 110, 128]
];
const BR = [320, 256, 1411, 192, 320, 128, 192, 128];

function mock() {
  let store = null;
  try { store = JSON.parse(localStorage.getItem('sds-mock') || 'null'); } catch {}
  const urls = new Map();
  return {
    isElectron: false,
    mediaUrl: (p) => urls.get(p) || p,
    pathForFile: (f) => { const u = URL.createObjectURL(f); urls.set(f.name, u); return f.name; },
    store: { load: async () => null, save: async () => true },
    library: {
      pick: async () => DEMO.map((d, i) => `demo://${i}`),
      probe: async (paths) => Promise.all(paths.map(async (p) => {
        const i = +p.split('//')[1];
        const d = DEMO[i];
        if (p.startsWith('export://')) return { id: 'x' + p.length + Math.random().toString(36).slice(2, 6), path: p, title: p.slice(9).replace(/\.\w+$/, ''), artist: '', album: '', duration: 36, cover: null, format: p.endsWith('.wav') ? 'WAV' : 'MP3', addedAt: Date.now(), bpm: null };
        if (!d) return { id: 'f' + Math.random().toString(36).slice(2), path: p, title: p, artist: '', album: '', duration: 0, cover: null, format: 'MP3', addedAt: Date.now(), bpm: null };
        if (!urls.has(p)) urls.set(p, await demoTrack(d[3], d[4]));
        return { id: 'demo' + i, path: p, title: d[0], artist: d[1], album: d[2], duration: 36, cover: null, format: BR[i] === 1411 ? 'FLAC' : 'MP3', bitrate: BR[i], codec: BR[i] === 1411 ? 'FLAC' : 'MPEG 1 Layer 3', lossless: BR[i] === 1411, sampleRate: 44100, genre: i % 2 ? 'Electronic' : 'Ambient', year: 2020 + i, addedAt: Date.now() - i * 1000, bpm: null };
      })),
      exists: async () => true,
      existsMany: async (paths) => paths.map((p) => !p.includes('//4')),
      formatInfo: async (paths) => Object.fromEntries(paths.map((p) => { const i = +p.split('//')[1]; return [p, { bitrate: BR[i] || 192, sampleRate: 44100, bitDepth: null, codec: 'MPEG 1 Layer 3', lossless: false, channels: 2, size: 4200000, genre: 'Electronic', year: 2021 }]; })),
      reveal: async () => {},
      scan: async () => { await new Promise((r) => setTimeout(r, 900)); return [{ path: 'C:\Users\demo\Music', count: DEMO.length }, { path: 'D:\Музыка', count: 2 }]; }
    },
    lyrics: { get: async () => { await new Promise((r) => setTimeout(r, 400)); return { source: 'lrc', text: Array.from({ length: 14 }, (_, i) => `[00:${String(i * 2.5 | 0).padStart(2, '0')}.${i % 2 ? '50' : '00'}]Demo line ${i + 1}${i % 4 === 3 ? '' : ' — words of the song'}`).join('\n') }; } },
    // no network lookups in the browser preview: every second track "is found"
    backgrounds: { add: async () => ({ added: [], skipped: 0 }), remove: async () => true },
    meta: { repair: async (t) => { await new Promise((r) => setTimeout(r, 250)); return t.title.length % 2 ? null : { mbid: 'demo', confidence: t.title.length % 3 ? .93 : .7, title: t.title, artist: t.artist || 'Demo Artist', album: t.album || 'Demo Album', year: 2019, genre: 'Ambient', cover: null }; } },
    web: {
      search: async (q) => {
        await new Promise((r) => setTimeout(r, 900));
        return {
          results: [
            { id: 'w1', title: `${q} (Live Session)`, artist: 'Open Stage Collective', providerLabel: 'Internet Archive', provider: 'archive', fileUrl: 'https://archive.org/download/x/a.mp3', pageUrl: 'https://archive.org/details/x', format: 'MP3', duration: 214, license: 'CC BY 4.0' },
            { id: 'w2', title: `${q} — Ambient Mix`, artist: 'Freesound user', providerLabel: 'Openverse · freesound', provider: 'openverse', fileUrl: 'https://cdn.freesound.org/a.mp3', pageUrl: 'https://freesound.org/x', format: 'MP3', duration: 182, license: 'CC0 1.0' },
            { id: 'w3', title: `${q} Instrumental`, artist: 'Jamendo Artist', providerLabel: 'Openverse · jamendo', provider: 'openverse', fileUrl: 'https://prod-1.storage.jamendo.com/a.mp3', pageUrl: 'https://jamendo.com/x', format: 'MP3', duration: 245, license: 'CC BY-SA 3.0' }
          ], errors: []
        };
      },
      download: async (item) => {
        for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 120)); window.__mockProgress && window.__mockProgress({ id: item.id, received: i * 1e5, total: 1e6 }); }
        if (!urls.has('demo://0')) urls.set('demo://0', await demoTrack(DEMO[0][3], DEMO[0][4]));
        return { id: 'dl' + item.id, path: 'demo://0', title: item.title, artist: item.artist, album: 'Web', duration: 36, cover: null, format: 'MP3', addedAt: Date.now(), bpm: null };
      },
      extract: async (u) => {
        await new Promise((r) => setTimeout(r, 700));
        if (/fail/.test(u)) throw new Error('Сайт ответил 404');
        return { page: { url: u, title: 'Demo Artist — Night Drive (Free Download)', host: 'example.com' }, results: [
          { id: 'lk1', title: 'Night Drive', artist: 'Demo Artist', provider: 'link', providerLabel: 'example.com', fileUrl: 'https://example.com/a.mp3', pageUrl: u, format: 'MP3', duration: 0, license: '' },
          { id: 'lk2', title: 'Night Drive (Instrumental)', artist: 'Demo Artist', provider: 'link', providerLabel: 'cdn.example.com', fileUrl: 'https://cdn.example.com/b.ogg', pageUrl: u, format: 'OGG', duration: 0, license: '' }] };
      },
      open: async (u) => window.open(u, '_blank'),
      onProgress: (cb) => { window.__mockProgress = cb; }
    },
    exporter: {
      pick: async (name, format) => ({ path: `export://${name}.${format}`, format }),
      write: async (p, data) => { urls.set(p, URL.createObjectURL(new Blob([data], { type: p.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }))); window.__lastExport = data; return p; }
    },
    covers: {
      pick: () => new Promise((res) => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
        i.onchange = () => { const f = i.files[0]; res(f ? URL.createObjectURL(f) : null); };
        i.click();
      })
    },
    app: { paths: async () => ({ downloads: '~/Music/Soft&Deep Sound', userData: '(browser)' }), prefs: async () => ({ closeToTray: true }), setPref: async () => true },
    media: { state: (st) => { window.__media = st; }, onCommand: (cb) => { window.__mediaCmd = cb; } },
    win: { min() {}, max() {}, close() {}, onState() {} },
    onOpenFiles() {}
  };
}

/** JSON over Capacitor's native HTTP (no CORS, no CSP in the way); a busy server (5xx) gets two more tries */
async function nativeJSON(url, { timeout = 12000, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', headers: { Accept: 'application/json', ...headers }, responseType: 'json', readTimeout: timeout, connectTimeout: timeout });
    if (r.status === 404) return null;
    if (r.status >= 200 && r.status < 300) return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (r.status < 500 || attempt >= 2) throw new Error(r.status + ' ' + url);
    await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
  }
}

/** SafeDownload.java's short reasons, in words (the desktop has the same ones in src/i18n-main.js) */
function downloadError(code) {
  const c = String(code || '');
  if (/too-big/.test(c)) return tr('ws.err.big');
  if (/timeout|timed out/i.test(c)) return tr('ws.err.slow');
  if (/not-audio-bytes/.test(c)) return tr('ws.err.sniff');
  if (/not-audio/.test(c)) return tr('ws.err.notAudio');
  if (/https only|blocked address|redirects/.test(c)) return tr('ws.err.addr');
  const st = /HTTP (\d+)/.exec(c); if (st) return tr('ws.err.status', { code: st[1] });
  if (/Unable to resolve|UnknownHost|ENOTFOUND|connect/i.test(c)) return tr('ws.err.net');
  return c || tr('ws.err.net');
}

/** LRCLIB (lrclib.net), the open lyrics database the desktop uses too */
async function lrclib({ title, artist, album, duration }, { online } = {}) {
  title = stripJunk(title); artist = stripJunk(artist);
  if (!online || !title || (!artist && !(duration > 0))) return null;
  const ua = `SoftDeepSound (${OS}; https://github.com/infallibl3/soft-deep-sound)`;
  const ask = (url) => nativeJSON(url, { headers: { 'User-Agent': ua, 'Lrclib-Client': ua } });
  const pick = (r) => (r && r.instrumental ? '[instrumental]' : r && (r.syncedLyrics || r.plainLyrics) ? (r.syncedLyrics || r.plainLyrics).trim() : '');
  const near = (r) => !(duration > 0) || !r.duration || Math.abs(r.duration - duration) <= 3;
  let text = '';
  if (artist) {
    const q = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) q.set('album_name', album);
    if (duration > 0) q.set('duration', String(Math.round(duration)));
    text = pick(await ask('https://lrclib.net/api/get?' + q));
  }
  if (!text) {
    // looser: a search, keeping only entries of (almost) the same length
    const q = artist ? new URLSearchParams({ track_name: title, artist_name: artist }) : new URLSearchParams({ q: title });
    const fit = ((await ask('https://lrclib.net/api/search?' + q)) || []).filter(near);
    text = pick(fit.find((r) => r.syncedLyrics) || fit[0]);
  }
  return text ? { source: 'lrclib', text } : null;
}

/** the phone's library repair (renderer/js/mb-repair.js): JSON over native HTTP, artwork saved by MusicLibraryPlugin.saveCover */
let repairInst = null;
function repairer() {
  const ua = `SoftDeepSound (${OS}; https://github.com/infallibl3/soft-deep-sound)`;
  return repairInst || (repairInst = createRepair({
    getJSON: (url) => nativeJSON(url, { timeout: 15000, headers: { 'User-Agent': ua } }),
    saveImage: async (url, key) => (await cap.nativePromise('MusicLibrary', 'saveCover', { url, key })).path || null
  }));
}

/** Android: the mock's harmless stubs, with the library, storage and media URLs made real */
function android() {
  const base = mock();
  const call = (method, opts = {}) => cap.nativePromise('MusicLibrary', method, opts);
  let found = new Map();
  // voice messages and call/voice recordings are audio, not music
  const NOT_MUSIC = /\/(WhatsApp Voice Notes|Voice Recorder|Recordings|Call|Sounds\/CallRecord)\//i;
  const scan = async () => { const r = await call('scan'); const ts = r.tracks.filter((t) => !NOT_MUSIC.test(t.path)); found = new Map(ts.map((t) => [t.path, t])); return ts; };
  const ext = (p) => (p.match(/\.(\w+)$/) || [, ''])[1].toUpperCase();
  const track = (p) => {
    const t = found.get(p);
    if (!t) return null;
    const format = ext(p) || 'MP3';
    const parts = p.split('/'), base = parts.pop().replace(/\.\w+$/, ''), folder = parts.pop();
    // no tags → Android just repeats the file name as the title: split «Artist - Title» and drop site junk, as on the desktop
    const fromFile = cleanName(base);
    const tagged = t.title && t.title !== base;
    const title = (tagged && stripJunk(t.title)) || fromFile.title;
    const artist = stripJunk(t.artist) || (tagged ? '' : fromFile.artist);
    // without an album tag Android names the album after the folder («Download»)
    const album = t.album && t.album !== folder ? stripJunk(t.album) : '';
    return { id: t.id, path: p, title, artist, album, duration: t.duration,
      cover: t.cover || null, format, lossless: /FLAC|WAV/.test(format), year: t.year || null, addedAt: t.addedAt || Date.now(), bpm: null };
  };
  // iPhone: paths are «/Documents/…» and «/Caches/…», since the real folders move when AltStore reinstalls the app
  let roots = null;
  // (never more than 4 s: a missing answer must not hold the whole start)
  const rootsReady = isIOS ? Promise.race([call('roots').then((r) => { roots = r; }, () => {}), new Promise((r) => setTimeout(r, 4000))]) : Promise.resolve();
  const iosFile = (p) => {
    const m = /^\/(Documents|Caches)(\/.*)$/.exec(p);
    return m && roots ? (m[1] === 'Documents' ? roots.documents : roots.caches) + m[2].split('/').map(encodeURIComponent).join('/') : null;
  };
  return {
    ...base,
    isAndroid: true,
    isIOS,
    // files on the phone and cached artwork go through Capacitor's local server (same origin, so Web Audio can read them)
    mediaUrl: (p) => (isIOS && iosFile(p || '') ? cap.convertFileSrc('file://' + iosFile(p)) : p && p.startsWith('/') ? cap.convertFileSrc('file://' + p) : base.mediaUrl(p)),
    store: {
      load: async () => { await rootsReady; try { return JSON.parse(localStorage.getItem('sds-library') || 'null'); } catch { return null; } },
      save: async (d) => { try { localStorage.setItem('sds-library', JSON.stringify(d)); if (d && d.settings) localStorage.setItem('sds-theme', d.settings.theme); return true; } catch { return false; } }
    },
    library: {
      ...base.library,
      // «add music» on Android = everything Android knows as music; there is no file picker to walk through.
      // The iPhone shows only the app's own folder: «add music» opens the system picker and copies the files in.
      pick: async (kind) => {
        if (isIOS && kind !== 'rescan') await call('importFiles', { folder: kind === 'folder' });
        return (await scan()).map((t) => t.path);
      },
      probe: async (paths) => { if (paths.some((p) => !found.has(p))) await scan(); return paths.map(track).filter(Boolean); },
      exists: async (p) => (await call('exists', { paths: [p] })).exists[0],
      existsMany: async (paths) => (await call('exists', { paths })).exists,
      formatInfo: async (paths) => Object.fromEntries(paths.map((p) => { const t = found.get(p); return [p, { size: t ? t.size : null, codec: ext(p), lossless: /FLAC|WAV/.test(ext(p)), year: t ? t.year : null }]; })),
      scan: undefined
    },
    lyrics: { get: (t, opts) => lrclib(t, opts) },
    // web search in open sources (the desktop's providers, renderer/js/websearch.js); downloads go to Music/Soft&Deep Sound
    web: (() => {
      const ws = createWebSearch({
        tm: (k) => tr('ws.' + k),
        getJSON: async (url, timeout = 10000) => { const d = await nativeJSON(url, { timeout, headers: { 'User-Agent': `SoftDeepSound/1.0 (${OS} music player)` } }); if (d === null) throw new Error('404 ' + url); return d; }
      });
      let onProgress = () => {};
      cap.nativeCallback('MusicLibrary', 'addListener', { eventName: 'download' }, (d) => { if (d && d.id) onProgress(d); });
      return {
        ...base.web,
        search: (query, settings) => ws.searchAll(query, settings || {}),
        extract: undefined, // a page link is not followed on the phone yet
        onProgress: (cb) => { onProgress = cb; },
        open: (url) => cap.nativePromise('MediaControls', 'openUrl', { url }).catch(() => {}),
        async download(item) {
          let path;
          try { ({ path } = await cap.nativePromise('MusicLibrary', 'download', { id: item.id, url: item.fileUrl, referer: item.pageUrl || null, name: item.artist ? item.artist + ' - ' + item.title : item.title })); }
          catch (e) { throw new Error(downloadError(e && e.message)); }
          await scan().catch(() => {});
          // Android may not count a short or untagged file as music: then the web result's own data stands in
          return track(path) || { id: 'w' + item.id, path, title: item.title, artist: item.artist || '', album: '', duration: item.duration || 0, cover: null, format: (ext(path) || 'MP3'), addedAt: Date.now(), bpm: null };
        }
      };
    })(),
    // not on the phone yet: page links (the UI hides them)
    backgrounds: undefined,
    // tags and artwork from MusicBrainz and the Cover Art Archive, as on the desktop (only names are sent)
    meta: { repair: (t) => repairer().repair({ title: stripJunk(String(t.title || '').slice(0, 300)), artist: stripJunk(String(t.artist || '').slice(0, 300)), duration: Number(t.duration) || 0 },
      { wantCover: !!t.wantCover, wantGenre: !!t.wantGenre }) },
    // the player in the notification shade and on the lock screen (android/…/PlaybackService.java)
    app: { ...base.app, minimize: () => cap.nativePromise('MediaControls', 'minimize', {}).catch(() => {}),
      // the phone's status bar icons follow the theme
      setTone: (light) => cap.nativePromise('MediaControls', 'setBars', { light }).catch(() => {}) },
    // iPhone: WebKit feeds the lock screen and Control Center from navigator.mediaSession (app.js) by itself
    media: isIOS ? { state() {}, onCommand() {} } : {
      state: (st) => {
        if (!st.hasTrack) return cap.nativePromise('MediaControls', 'stop', {}).catch(() => {});
        const { title, artist, album, cover, playing, position, duration, rate } = st;
        cap.nativePromise('MediaControls', 'update', { title, artist, album, cover, playing, position: position || 0, duration: duration || 0, rate: rate || 1 }).catch(() => {});
      },
      onCommand: (cb) => cap.nativeCallback('MediaControls', 'addListener', { eventName: 'command' }, (d) => { if (d && d.cmd) cb(d.cmd === 'seek' ? 'seek:' + d.pos : d.cmd); })
    }
  };
}

const raw = window.sds || (isAndroid ? android() : mock());
/** a track or cover from the web search is an https address and is used as it is; files go through the app's own url */
export const bridge = { ...raw, mediaUrl: (p) => (/^https:\/\//i.test(p || '') ? p : raw.mediaUrl(p)) };
