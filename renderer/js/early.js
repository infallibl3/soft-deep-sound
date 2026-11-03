// Runs before the first paint (a classic script, so it blocks): on Android the library lives in localStorage,
// and the theme saved with it is applied at once — no light splash flashing before a dark theme loads.
(function () {
  // macOS: the window keeps its own traffic lights, so the titlebar makes room for them (styles.css, html.mac)
  try { if (window.sds && window.sds.platform === 'darwin') document.documentElement.classList.add('mac'); } catch (e) {}
  // economy mode is decided once per start (the heavy parts are simply never created), so it reads here
  try { if (localStorage.getItem('sds-eco') === '1') document.documentElement.classList.add('eco'); } catch (e) {}
  try {
    var th = localStorage.getItem('sds-theme');
    if (!th) return;
    document.documentElement.dataset.theme = th;
    document.documentElement.dataset.tone = th === 'deep' || th === 'obsidian' ? 'dark' : 'light';
  } catch (e) {}
})();

// A phone has no developer console: when the interface has not come up after 10 s, the splash shows what went wrong
// (this runs before i18n.js exists, so the heading carries both languages)
(function () {
  var errs = [];
  addEventListener('error', function (e) {
    var t = e.target;
    errs.push(e.message ? e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '')
      : 'not loaded: ' + ((t && (t.src || t.href)) || '?'));
  }, true);
  addEventListener('unhandledrejection', function (e) { var r = e.reason; errs.push('promise: ' + ((r && (r.stack || r.message)) || r)); });
  setTimeout(function () {
    var sp = document.getElementById('splash');
    if (!sp || document.body.classList.contains('ready')) return;
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 12px);max-height:45vh;overflow:auto;z-index:99;'
      + 'margin:0;padding:12px;border-radius:12px;background:rgba(0,0,0,.78);color:#fff;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word';
    box.textContent = 'Ошибка запуска / Startup error\n' + navigator.userAgent + '\n\n' + (errs.join('\n\n') || 'no error reported: something is still waiting');
    sp.appendChild(box);
  }, 10000);
})();
