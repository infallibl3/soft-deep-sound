/**
 * Fine-tuning on top of the four themes:
 *   • accent colour — the theme's own, a preset, any custom colour, or «from the cover» (follows the
 *     artwork of the playing track). Every accent-derived variable is recomputed and kept readable:
 *     darker on light themes, brighter on dark ones;
 *   • the living background — live / calm / still / off;
 *   • glass — fully clear / less / normal / more / solid (clear and solid drop the blur altogether);
 *   • the interface font — the theme's own, a bundled or common one, or any font installed on the computer;
 *   • your own background — any number of images, GIFs or short videos; every one added stays in the
 *     gallery (copies live in userData/backgrounds), one is shown behind the interface, softened to taste.
 * Everything is set as inline custom properties on <html>, so the theme files stay untouched and
 * «as in the theme» simply removes the overrides.
 */
import { h } from './ui.js';
import { t as tr } from './i18n.js';
import { PRESET_IDS, createPresetBg, drawPresetThumb } from './bgpresets.js';

export const PRESETS = [
  ['cobalt', '#1f45e8'], ['violet', '#7c4dff'], ['fuchsia', '#e0359b'], ['coral', '#ff5a3c'],
  ['amber', '#f0a020'], ['mint', '#14b88c'], ['teal', '#0fa3c4'], ['steel', '#8a94a6']
];
const VARS = ['--accent', '--accent-2', '--accent-rgb', '--accent-deep', '--on-accent', '--hot', '--hot-2', '--hot-rgb', '--wave-1', '--wave-2',
  '--blue-rgb', '--n1', '--n2', '--n3', '--n1-rgb', '--n3-rgb', '--shape-c1', '--shape-c2', '--shape-c3',
  '--line', '--line-faint', '--shade', '--glass-edge', '--groove', '--groove-edge', '--chrome-4', '--viz-a'];
const BLUR = { less: '8px', more: '44px' };
const ECO = document.documentElement.classList.contains('eco');   // economy mode, fixed for this start (early.js)
/** interface fonts: bundled ones work everywhere; the last three are Windows fonts, so phones don't list them */
export const FONTS = [
  ['system', 'system-ui, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif'],
  ['manrope', '"Manrope", sans-serif'],
  ['unbounded', '"Unbounded", "Manrope", sans-serif'],
  ['mono', '"JBMono", "Cascadia Mono", Consolas, monospace'],
  ['serif', 'Georgia, "Noto Serif", "Times New Roman", serif'],
  ['verdana', 'Verdana, sans-serif', true],
  ['trebuchet', '"Trebuchet MS", sans-serif', true],
  ['tahoma', 'Tahoma, sans-serif', true]
];
const LOCAL = 'local:';
/** the CSS font stack for a saved choice, or null for the theme's own */
function fontStack(v) {
  if (!v || v === 'theme') return null;
  if (v.startsWith(LOCAL)) return `"${v.slice(LOCAL.length).replace(/["\\]/g, '')}", "Manrope", sans-serif`;
  const f = FONTS.find((x) => x[0] === v);
  return f ? f[1] : null;
}

const hexToRgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const rgbToHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function createAppearance({ S, save, bridge, toast, hslToRgb, rgbToHsl, coverColor, onChange, energy }) {
  const look = () => S.settings.look;
  let coverRgb = null;

  /** the colour to use right now, or null for the theme's own */
  function wanted() {
    const a = look().accent;
    if (a === 'cover') return coverRgb;
    return a && a !== 'theme' ? hexToRgb(a) : null;
  }

  function apply() {
    const root = document.documentElement, st = root.style, L = look();
    VARS.forEach((v) => st.removeProperty(v));
    const rgb = wanted();
    if (rgb) {
      const light = root.dataset.tone === 'light';
      let [hh, ss, ll] = rgbToHsl(...rgb);
      // the accent is also a text colour (titles, artist lines): keep it readable on the theme's background
      ll = light ? Math.min(Math.max(ll, .3), .5) : Math.max(Math.min(ll, .74), .6);
      if (ss > .08) ss = Math.min(.95, Math.max(ss, .45));
      const a = hslToRgb(hh, ss, ll);
      const a2 = hslToRgb((hh + (light ? 12 : 28)) % 360, ss, Math.min(.8, ll + .14));
      const a3 = hslToRgb((hh + 330) % 360, ss * .9, Math.min(.82, ll + .2));
      const deep = hslToRgb(hh, ss, Math.max(.16, ll - .17));
      const j = (c) => c.join(' '), rgba = (c, k) => `rgba(${c.join(', ')}, ${k})`;
      const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; };
      const set = {
        '--accent': rgbToHex(a), '--accent-2': rgbToHex(a2), '--accent-rgb': j(a), '--accent-deep': rgbToHex(deep),
        '--on-accent': lum(a) > .45 ? '#0b0c10' : '#ffffff',
        '--hot': rgbToHex(a), '--hot-2': rgbToHex(a2), '--hot-rgb': j(a), '--wave-1': j(a), '--wave-2': j(a2), '--blue-rgb': j(a2),
        '--n1': rgbToHex(a), '--n2': rgbToHex(a2), '--n3': rgbToHex(a3), '--n1-rgb': j(a), '--n3-rgb': j(a3),
        '--shape-c1': j(light ? a : a3), '--shape-c2': j(light ? a2 : a), '--shape-c3': j(light ? a3 : a2),
        '--viz-a': rgba(a, light ? .12 : .14)
      };
      // light themes tint their lines, glass edges and grooves with the accent too
      if (light) Object.assign(set, { '--line': rgba(a, .3), '--line-faint': rgba(a, .1), '--shade': rgba(a, .06), '--glass-edge': rgba(a, .14),
        '--groove': rgba(a, .055), '--groove-edge': rgba(a, .14), '--chrome-4': rgba(a, .25) });
      for (const [k, v] of Object.entries(set)) st.setProperty(k, v);
    }
    root.dataset.fx = ECO ? 'off' : L.fx || 'live';
    renderBackground();
    if (BLUR[L.blur]) st.setProperty('--blur', BLUR[L.blur]); else st.removeProperty('--blur');
    if (L.blur === 'clear' || L.blur === 'solid') root.dataset.glass = L.blur; else delete root.dataset.glass;
    const stack = fontStack(L.font);
    if (stack) { st.setProperty('--font', stack); st.setProperty('--display', stack); } else { st.removeProperty('--font'); st.removeProperty('--display'); }
    seen = new WeakMap();   // a new look: decide afresh, not from the last background's history
    adaptSoon();
    onChange && onChange();
  }

  /** «from the cover»: called whenever the playing track changes */
  async function onTrack(t) {
    if (look().accent !== 'cover') return;
    const rgb = t ? await coverColor(t) : null;
    if (look().accent !== 'cover') return;
    coverRgb = rgb;
    apply();
  }

  function setLook(patch, track) {
    Object.assign(look(), patch);
    save();
    if (patch.accent === 'cover') onTrack(track); else apply();
  }

  /* ------------------------------ controls ------------------------------ */
  function accentRow(getTrack, compact) {
    const row = h('div', { class: 'ap-swatches', role: 'radiogroup', 'aria-label': tr('ap.accent') });
    const mark = () => row.querySelectorAll('.ap-sw').forEach((b) => { const on = b.dataset.v === look().accent || (b.dataset.v === 'custom' && /^#/.test(look().accent) && !PRESETS.some((p) => p[1] === look().accent)); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    const sw = (v, title, style, extra) => {
      const b = h('button', { class: 'ap-sw ' + (extra || ''), role: 'radio', title, 'aria-label': title, dataset: { v }, style });
      b.onclick = () => { setLook({ accent: v }, getTrack()); mark(); };
      return b;
    };
    row.append(sw('theme', tr('ap.theme'), {}, 'theme'));
    PRESETS.forEach(([k, hex]) => row.append(sw(hex, tr('ap.c.' + k), { background: hex })));
    // any colour: the native picker behind a swatch
    const custom = /^#/.test(look().accent) && !PRESETS.some((p) => p[1] === look().accent) ? look().accent : '#ff7a59';
    const pick = h('input', { type: 'color', value: custom, tabindex: '-1', 'aria-hidden': 'true' });
    const cb = h('label', { class: 'ap-sw custom', role: 'radio', title: tr('ap.custom'), 'aria-label': tr('ap.custom'), dataset: { v: 'custom' }, tabindex: '0', style: { '--c': custom } }, pick);
    pick.oninput = () => { cb.style.setProperty('--c', pick.value); setLook({ accent: pick.value }, getTrack()); mark(); };
    cb.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } };
    row.append(cb);
    const cov = h('button', { class: 'ap-sw cover', role: 'radio', title: tr('ap.coverT'), 'aria-label': tr('ap.coverT'), dataset: { v: 'cover' } });
    cov.onclick = () => { setLook({ accent: 'cover' }, getTrack()); mark(); };
    row.append(cov);
    mark();
    if (compact) return row;
    return h('div', { class: 'set-row ap-row' }, h('div', {}, h('b', {}, tr('ap.accent')), h('small', {}, tr('ap.accentD'))), row);
  }

/** settings changed from elsewhere (e.g. choosing a background turns the living one off): repaint the switches */
  function syncSegs() {
    document.querySelectorAll('.ap .seg[data-key]').forEach((sg) => sg.querySelectorAll('button[data-v]').forEach((b) => {
      const on = look()[sg.dataset.key] === b.dataset.v;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    }));
  }
  /**
   * A background of your own (or a built-in one) replaces the living background, so that one is switched
   * off — and comes back as it was when «as in the theme» is chosen again.
   */
  function chooseBg(id) {
    const L = look(), patch = { bgActive: id };
    if (id) {
      if (!L.bgActive && L.fx !== 'off') patch.fxBefore = L.fx;
      patch.fx = 'off';
    } else if (L.bgActive) {
      patch.fx = L.fxBefore || 'live';
      patch.fxBefore = null;
    }
    setLook(patch);
    syncSegs();
  }

  function seg(key, options, label, desc) {
    const s = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label, dataset: { key } }, ...options.map(([v, text]) => {
      const b = h('button', { class: look()[key] === v ? 'on' : '', role: 'radio', 'aria-checked': String(look()[key] === v), dataset: { v } }, text);
      b.onclick = () => { setLook({ [key]: v }); s.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); };
      return b;
    }));
    return h('div', { class: 'set-row' }, h('div', {}, h('b', {}, label), h('small', {}, desc)), s);
  }

  /* ------------------------------ your own background ------------------------------ */
  const DIM = { none: 0, soft: .4, strong: .66 };
  let layer = null, media = null, mediaPath = null, preset = null;
  const presetOf = (id) => (/^preset:/.test(id || '') && PRESET_IDS.includes(id.slice(7)) ? id.slice(7) : null);
  function renderBackground() {
    const root = document.documentElement, L = look();
    const pid = presetOf(L.bgActive);
    // economy mode shows no animated scenes: the theme's own backdrop instead
    const item = pid ? (ECO ? null : { kind: 'preset', path: L.bgActive }) : (L.bgList || []).find((b) => b.path === L.bgActive);
    if (!item || item.path !== mediaPath) {
      if (media) media.remove();
      if (preset && (!item || item.kind !== 'preset')) preset.stop();
      if (!item || item.kind !== 'preset') { media = null; mediaPath = null; }
    }
    if (!item) { delete root.dataset.userbg; return; }
    if (!layer) { layer = h('div', { id: 'userBg', 'aria-hidden': 'true' }); document.body.prepend(layer); }
    root.dataset.userbg = item.kind;
    root.style.setProperty('--ubg-dim', String(DIM[L.bgDim] ?? DIM.soft));
    if (item.kind === 'preset') {
      // built-in scenes take their colours from the theme: repaint them after every theme / accent change
      preset = preset || createPresetBg({ energy });
      preset.recolor();
      if (mediaPath !== item.path) { layer.append(preset.canvas); media = preset.canvas; mediaPath = item.path; preset.start(pid); }
      return;
    }
    if (mediaPath === item.path) return;
    const src = bridge.mediaUrl(item.path);
    media = item.kind === 'video' ? h('video', { loop: true, playsinline: true }) : h('img', { alt: '' });
    // anonymous CORS (the media protocol allows it) so adaptInk can read the pixels
    media.crossOrigin = 'anonymous';
    media.src = src;
    media.addEventListener(item.kind === 'video' ? 'loadeddata' : 'load', adaptSoon);
    if (item.kind === 'video') { media.muted = true; if (!ECO) media.play().catch(() => {}); }   // economy mode: the first frame, still
    // the copy is gone (cleaned up by hand): fall back to the theme instead of a blank screen
    media.onerror = () => { if (look().bgActive === item.path) { look().bgActive = null; save(); renderBackground(); } };
    layer.append(media);
    mediaPath = item.path;
  }
  /* ------------------------------ text that keeps reading ------------------------------ */
  /**
   * Whatever is behind the interface (your own picture or video, a built-in scene, the theme's living
   * background) can land at the same brightness as the text. It is sampled into a tiny canvas and, for every
   * panel, the part behind it is averaged and mixed with the dimming layer and the panel's own glass.
   *   • The text keeps the theme's colours. When they stop reading, the panel gets a scrim (its ::before,
   *     --scrim) just strong enough for the secondary text to reach 4.5:1, so it eases in and out smoothly
   *     instead of switching.
   *   • Only where there is nothing to darken — the title bar, or panels in «Clear» glass — the text may flip
   *     to the opposite ink (.ink-light / .ink-dark), and only when that clearly wins and stays winning for
   *     a few looks in a row, so a moving background can't make it blink.
   */
  const PANELS = ['.titlebar', '.sidebar', '.content', '.nowplaying', '.deck'];
  const SW = 64, SH = 36;
  let probe = null, probeG = null, one = null;
  let seen = new WeakMap();   // panel → { bg: smoothed backdrop, flip: pending flip, n: looks it has held }; reset on every look change
  /** any CSS colour → [r, g, b, a 0..1], through the canvas so hex, rgba() and color() all work */
  function rgbaOf(css) {
    if (!one) one = h('canvas', { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    one.clearRect(0, 0, 1, 1); one.fillStyle = '#0000'; one.fillStyle = css; one.fillRect(0, 0, 1, 1);
    const d = one.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const lin = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  const lumOf = (c) => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
  const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
  /** the panel's own fill: a plain colour, or the first stop of its gradient */
  function fillOf(el) {
    const cs = getComputedStyle(el);
    const c = rgbaOf(cs.backgroundColor);
    if (c[3] > 0) return c;
    const m = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i.exec(cs.backgroundImage || '');
    return m ? rgbaOf(m[1]) : [0, 0, 0, 0];
  }
  /** paint what is behind the interface into the probe; false when there is nothing readable to paint */
  function paintBehind(root) {
    if (!probe) { probe = h('canvas', { width: SW, height: SH }); probeG = probe.getContext('2d', { willReadFrequently: true }); }
    const vw = innerWidth, vh = innerHeight, cs = getComputedStyle(root);
    // the theme's own backdrop first (the body gradient), then whatever is drawn over it
    const gr = probeG.createLinearGradient(SW * .3, 0, SW * .7, SH);
    gr.addColorStop(0, cs.getPropertyValue('--bg-1').trim() || '#888');
    gr.addColorStop(.55, cs.getPropertyValue('--bg-2').trim() || '#888');
    gr.addColorStop(1, cs.getPropertyValue('--bg-3').trim() || '#888');
    probeG.fillStyle = gr; probeG.fillRect(0, 0, SW, SH);
    try {
      if (root.dataset.userbg && media) {
        const w = media.videoWidth || media.naturalWidth || media.width, hh = media.videoHeight || media.naturalHeight || media.height;
        if (!w || !hh) return false;
        // the same crop as object-fit: cover, scaled down to the probe
        const k = Math.max(vw / w, vh / hh), dw = w * k * SW / vw, dh = hh * k * SH / vh;
        probeG.drawImage(media, (SW - dw) / 2, (SH - dh) / 2, dw, dh);
        const dim = root.dataset.userbg === 'preset' ? 0 : (parseFloat(cs.getPropertyValue('--ubg-dim')) || 0);
        if (dim) { probeG.globalAlpha = dim; probeG.fillStyle = cs.getPropertyValue('--bg-2').trim() || '#000'; probeG.fillRect(0, 0, SW, SH); probeG.globalAlpha = 1; }
      } else {
        const fx = document.getElementById('bgfx');
        if (fx && fx.width && getComputedStyle(fx).display !== 'none') probeG.drawImage(fx, 0, 0, SW, SH);
      }
      return probeG.getImageData(0, 0, SW, SH).data;
    } catch { return false; }
  }
  /** how much of `scrim` must lie over `L` for text of luminance `ink` to reach `target` (0 when it already does) */
  function scrimNeed(ink, L, scrim, bg, target) {
    if (contrast(ink, L) >= target) return 0;
    for (let a = .05; a <= .8; a += .05) if (contrast(ink, lumOf(over([...scrim, a], bg))) >= target) return a;
    return .8;
  }
  function adaptInk() {
    const root = document.documentElement;
    const els = PANELS.map((s) => document.querySelector(s)).filter(Boolean);
    // economy mode and solid glass: the panels are opaque, so the theme's colours read there as they are;
    // the title bar still sits right on the background
    const opaque = root.classList.contains('eco') || root.dataset.glass === 'solid';
    if (opaque) els.filter((el) => !el.matches('.titlebar')).forEach((el) => { el.classList.remove('ink-light', 'ink-dark'); el.style.removeProperty('--scrim'); });
    const px = paintBehind(root);
    if (!px) return;
    const vw = innerWidth, vh = innerHeight, cs = getComputedStyle(root);
    const dark = root.dataset.tone === 'dark';
    // secondary text (--ink-2) must reach 4.5:1 and the faint labels (--ink-3) 3:1 — those are what blend first
    const ink2 = lumOf(rgbaOf(cs.getPropertyValue('--ink-2').trim())), ink3 = lumOf(rgbaOf(cs.getPropertyValue('--ink-3').trim()));
    const OPP_INK2 = dark ? [14, 18, 34, .78] : [244, 246, 251, .8], OPP_INK3 = dark ? [14, 18, 34, .58] : [244, 246, 251, .6];   // of .ink-dark / .ink-light
    const SCRIM = dark ? [8, 8, 12] : [250, 251, 255], SCRIM_OPP = dark ? [250, 251, 255] : [8, 8, 12];
    const clearGlass = root.dataset.glass === 'clear', moving = isMoving(root);
    for (const el of els) {
      el.classList.remove(dark ? 'ink-light' : 'ink-dark');   // left over from the other tone
      if (opaque && !el.matches('.titlebar')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x0 = Math.max(0, Math.floor(r.left / vw * SW)), x1 = Math.min(SW, Math.ceil(r.right / vw * SW));
      const y0 = Math.max(0, Math.floor(r.top / vh * SH)), y1 = Math.min(SH, Math.ceil(r.bottom / vh * SH));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * SW + x) * 4; sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; n++; }
      if (!n) continue;
      const bg = over(fillOf(el), [sr / n, sg / n, sb / n]);
      // smoothed, so one bright frame of a video doesn't move anything
      const fresh = !seen.has(el), st = seen.get(el) || { bg: null, flip: null, n: 0 };
      st.bg = st.bg ? st.bg.map((v, i) => v * .6 + bg[i] * .4) : bg;
      const L = lumOf(st.bg);
      const mayFlip = el.matches('.titlebar') || clearGlass;
      const needTheme = Math.max(scrimNeed(ink2, L, SCRIM, st.bg, 4.5), scrimNeed(ink3, L, SCRIM, st.bg, 3));
      const needOpp = Math.max(scrimNeed(lumOf(over(OPP_INK2, st.bg)), L, SCRIM_OPP, st.bg, 4.5), scrimNeed(lumOf(over(OPP_INK3, st.bg)), L, SCRIM_OPP, st.bg, 3));
      const flipped = el.classList.contains(dark ? 'ink-dark' : 'ink-light');
      // flip only when the other ink reads clearly better, and only after it has kept winning for three looks
      const wantFlip = mayFlip && (flipped ? needOpp <= needTheme + .15 : needOpp + .3 < needTheme);
      if (wantFlip !== flipped) {
        st.n = st.flip === wantFlip ? st.n + 1 : 1; st.flip = wantFlip;
        if (st.n >= (moving && !fresh ? 3 : 1)) { el.classList.toggle(dark ? 'ink-dark' : 'ink-light', wantFlip); st.n = 0; st.flip = null; }
      } else { st.n = 0; st.flip = null; }
      seen.set(el, st);
      const nowFlipped = el.classList.contains(dark ? 'ink-dark' : 'ink-light');
      // the title bar has no panel to darken; in clear glass the scrim stays light-handed
      const need = el.matches('.titlebar') ? 0 : Math.min(nowFlipped ? needOpp : needTheme, clearGlass ? .45 : .8);
      const c = nowFlipped ? SCRIM_OPP : SCRIM;
      el.style.setProperty('--scrim', `rgba(${c.join(', ')}, ${need.toFixed(2)})`);
    }
  }
  let inkT = 0;
  // twice: the living background may draw its first frame only after a theme or glass change has landed
  const adaptSoon = () => { clearTimeout(inkT); inkT = setTimeout(() => { adaptInk(); inkT = setTimeout(adaptInk, 1200); }, 120); };
  /** true while what's behind the panels keeps changing (a video, a scene, the living background) */
  const isMoving = (root) => (root.dataset.userbg ? !!media && media.tagName !== 'IMG' : root.dataset.fx !== 'off' && root.dataset.fx !== 'still');
  addEventListener('resize', adaptSoon);
  // a video, a scene or the living background moves under the panels: look again now and then, while it can be seen
  setInterval(() => {
    const root = document.documentElement;
    if (document.hidden || root.classList.contains('win-hidden') || root.classList.contains('eco')) return;
    if (isMoving(root)) adaptInk();
  }, 2000);

  // a video background rests while nothing of it can be seen
  setInterval(() => {
    if (!media || media.tagName !== 'VIDEO') return;
    const b = document.body.classList, hidden = document.hidden || document.documentElement.classList.contains('win-hidden') || b.contains('deep-open') || b.contains('visual-open');
    if ((hidden || ECO) && !media.paused) media.pause(); else if (!hidden && !ECO && media.paused) media.play().catch(() => {});
  }, 1000);

  /** gallery: «theme» + every background ever added + «add»; the chosen one is ringed */
  function bgRow() {
    const wrap = h('div', { class: 'set-row ap-bg-row' });
    const paint = () => {
      const L = look();
      wrap.innerHTML = '';
      const tiles = h('div', { class: 'ap-bgs', role: 'radiogroup', 'aria-label': tr('ap.bg') });
      const themeOn = !L.bgActive || (ECO && !!presetOf(L.bgActive));   // a scene chosen before economy mode shows the theme now
      const none = h('button', { class: 'ap-bg none' + (themeOn ? ' on' : ''), role: 'radio', 'aria-checked': String(themeOn), title: tr('ap.bg.none') }, h('span', {}, tr('ap.bg.none')));
      none.onclick = () => { chooseBg(null); paint(); };
      tiles.append(none);
      for (const id of ECO ? [] : PRESET_IDS) {   // animated scenes don't run in economy mode
        const cv = h('canvas', { width: 184, height: 116 });
        drawPresetThumb(cv, id);
        const key = 'preset:' + id, on = L.bgActive === key;
        const t = h('button', { class: 'ap-bg preset' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), title: tr('ap.bg.p.' + id) }, cv, h('i', { class: 'ap-bg-name' }, tr('ap.bg.p.' + id)));
        t.onclick = () => { chooseBg(key); paint(); };
        tiles.append(t);
      }
      for (const b of L.bgList || []) {
        const src = bridge.mediaUrl(b.path);
        const thumb = b.kind === 'video' ? h('video', { src, preload: 'metadata' }) : h('img', { src, alt: '', loading: 'lazy' });
        if (thumb.tagName === 'VIDEO') thumb.muted = true;
        const on = L.bgActive === b.path;
        const t = h('button', { class: 'ap-bg' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), title: b.name || '' }, thumb,
          b.kind === 'video' ? h('i', { class: 'ap-bg-kind' }, tr('ap.bg.video')) : null);
        t.onclick = () => { chooseBg(b.path); paint(); };
        const del = h('button', { class: 'ap-bg-del', title: tr('ap.bg.remove'), 'aria-label': tr('ap.bg.remove'), html: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6"/></svg>' });
        del.onclick = async (e) => {
          e.stopPropagation();
          await bridge.backgrounds.remove(b.path).catch(() => {});
          L.bgList = L.bgList.filter((x) => x !== b);
          if (L.bgActive === b.path) chooseBg(null);
          save(); apply(); paint();
        };
        tiles.append(h('div', { class: 'ap-bg-wrap' }, t, del));
      }
      const add = h('button', { class: 'ap-bg add', title: tr('ap.bg.add') }, h('b', {}, '+'), h('small', {}, tr('ap.bg.add')));
      add.onclick = async () => {
        if (!bridge.backgrounds) return;
        const r = await bridge.backgrounds.add().catch(() => null);
        if (!r) return;
        if (r.added.length) { look().bgList = [...(look().bgList || []), ...r.added]; chooseBg(r.added[r.added.length - 1].path); paint(); }
        if (r.skipped) toast(tr('ap.bg.skipped', { n: r.skipped }));
      };
      tiles.append(add);
      wrap.append(h('div', { class: 'ap-bg-head' }, h('b', {}, tr('ap.bg')), h('small', {}, tr('ap.bgD'))), tiles);
      if (L.bgActive && !presetOf(L.bgActive)) {
        const dim = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('ap.bg.dim') }, ...[['none', tr('ap.bg.dim.none')], ['soft', tr('ap.bg.dim.soft')], ['strong', tr('ap.bg.dim.strong')]].map(([v, text]) => {
          const cur = L.bgDim || 'soft';
          const b = h('button', { class: cur === v ? 'on' : '', role: 'radio', 'aria-checked': String(cur === v) }, text);
          b.onclick = () => { setLook({ bgDim: v }); paint(); };
          return b;
        }));
        wrap.append(h('div', { class: 'ap-bg-dim' }, h('small', {}, tr('ap.bg.dim')), dim));
      }
    };
    paint();
    return wrap;
  }

  /* ------------------------------ interface font ------------------------------ */
  const isAndroid = /Android|iPhone|iPad/i.test(navigator.userAgent); // a phone: no Windows fonts there
  /** tiles, each written in its own font: the theme's, the built-in list, and «from the computer» */
  function fontRow() {
    const wrap = h('div', { class: 'set-row ap-font-row' });
    let listOpen = false, families = null;
    const pickFont = (v) => { listOpen = false; setLook({ font: v }); paint(); };
    const paint = () => {
      const cur = look().font || 'theme';
      wrap.innerHTML = '';
      const tiles = h('div', { class: 'ap-fonts', role: 'radiogroup', 'aria-label': tr('ap.font') });
      const tile = (v, name, stack) => {
        const on = cur === v;
        const b = h('button', { class: 'ap-font' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), title: name, style: stack ? { fontFamily: stack } : {} },
          h('b', {}, 'Аа'), h('small', {}, name));
        b.onclick = () => pickFont(v);
        return b;
      };
      tiles.append(tile('theme', tr('ap.font.theme'), null));
      for (const [id, stack, windowsOnly] of FONTS) if (!(windowsOnly && isAndroid)) tiles.append(tile(id, tr('ap.font.' + id), stack));
      if (cur.startsWith(LOCAL)) tiles.append(tile(cur, cur.slice(LOCAL.length), fontStack(cur)));
      // any font installed on the computer (Chromium's Local Font Access; phones don't have it)
      if (typeof window.queryLocalFonts === 'function') {
        const more = h('button', { class: 'ap-font more' + (listOpen ? ' on' : ''), title: tr('ap.font.local') }, h('b', {}, '+'), h('small', {}, tr('ap.font.local')));
        more.onclick = async () => {
          if (!families) {
            try { families = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort((a, b) => a.localeCompare(b)); } catch { families = []; }
            if (!families.length) { families = null; toast(tr('ap.font.none')); return; }
          }
          listOpen = !listOpen; paint();
        };
        tiles.append(more);
      }
      wrap.append(h('div', { class: 'ap-bg-head' }, h('b', {}, tr('ap.font')), h('small', {}, tr('ap.fontD'))), tiles);
      if (listOpen && families) {
        const q = h('input', { class: 'set-input ap-font-q', placeholder: tr('ap.font.search') });
        const list = h('div', { class: 'ap-font-list', role: 'listbox' });
        // only the first matches are drawn: every row loads its own font, and a computer can have a thousand
        const fill = () => {
          const needle = q.value.trim().toLowerCase();
          const hits = families.filter((f) => !needle || f.toLowerCase().includes(needle)).slice(0, 80);
          list.innerHTML = '';
          for (const f of hits) {
            const v = LOCAL + f, row = h('button', { class: 'ap-font-item' + (cur === v ? ' on' : ''), role: 'option', style: { fontFamily: fontStack(v) } }, f);
            row.onclick = () => pickFont(v);
            list.append(row);
          }
          if (!hits.length) list.append(h('small', { class: 'ap-font-empty' }, tr('ap.font.nothing')));
        };
        q.oninput = fill;
        q.onkeydown = (e) => { if (e.key === 'Escape') { listOpen = false; paint(); } e.stopPropagation(); };
        fill();
        wrap.append(h('div', { class: 'ap-font-pick' }, q, list));
        setTimeout(() => q.focus(), 0);
      }
    };
    paint();
    return wrap;
  }

  /** the «Оформление» block for Settings */
  function panel(getTrack) {
    const glass = seg('blur', [['clear', tr('ap.blur.clear')], ['less', tr('ap.blur.less')], ['normal', tr('ap.blur.normal')], ['more', tr('ap.blur.more')], ['solid', tr('ap.blur.solid')]], tr('ap.blur'), tr('ap.blurD'));
    glass.classList.add('ap-wide');
    // economy mode turns the living background, animated scenes and glass off: their switches would do nothing
    return h('div', { class: 'ap' },
      accentRow(getTrack),
      ECO ? h('div', { class: 'notice ap-eco-note' }, tr('ap.ecoNote')) : seg('fx', [['live', tr('ap.fx.live')], ['calm', tr('ap.fx.calm')], ['still', tr('ap.fx.still')], ['off', tr('ap.fx.off')]], tr('ap.fx'), tr('ap.fxD')),
      bgRow(),
      ECO ? null : glass,
      fontRow());
  }

  return { apply, onTrack, panel, accentRow };
}
