/* Missing logo intro — vanilla JS, no dependencies.
 * MissingLogo.svg(opts)  -> static logo markup (for header, footer, favicon...)
 * MissingLogo.intro(opts) -> plays the intro, then flies the logo into opts.target
 */
(function (global) {
  'use strict';
  var COLORS = { leaf: '#22C55E', legsOnLight: '#2563EB', legsOnDark: '#38BDF8', navy: '#0F172A' };
  var BAR = 'M28 58 V46 A12 12 0 0 1 40 34 H160 A12 12 0 0 1 172 46 V58 Z';

  function bez(p, t) {
    var u = 1 - t;
    return [u*u*u*p[0][0] + 3*u*u*t*p[1][0] + 3*u*t*t*p[2][0] + t*t*t*p[3][0],
            u*u*u*p[0][1] + 3*u*u*t*p[1][1] + 3*u*t*t*p[2][1] + t*t*t*p[3][1]];
  }
  // A curve drawn as a filled outline whose width goes from w0 to w1.
  function taper(segs, w0, w1, power) {
    var n = 60, pts = [], i, k;
    for (i = 0; i < segs.length; i++)
      for (k = 0; k < n + (i === segs.length - 1 ? 1 : 0); k++) pts.push(bez(segs[i], k / n));
    var L = [], R = [], N = pts.length;
    for (i = 0; i < N; i++) {
      var a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, N - 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      var nx = -dy / d, ny = dx / d, w = (w0 + (w1 - w0) * Math.pow(i / (N - 1), power)) / 2;
      L.push(pts[i][0] + nx * w, pts[i][1] + ny * w);
      R.unshift(pts[i][0] - nx * w, pts[i][1] - ny * w);
    }
    return L.concat(R); // R was built back to front, so the outline closes
  }
  var S_POLY = taper([[[140,46],[96,46],[64,70],[92,98]], [[92,98],[124,122],[126,156],[90,172]]], 22, 1.5, 1.1);
  var T_POLY = taper([[[100,46],[100,64],[100,80],[100,98]], [[100,98],[100,124],[100,150],[100,172]]], 20, 20, 1);
  function toD(a) {
    var s = 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1);
    for (var i = 2; i < a.length; i += 2) s += ' L' + a[i].toFixed(1) + ' ' + a[i + 1].toFixed(1);
    return s + 'Z';
  }
  var S_D = toD(S_POLY);

  // MAO: four QR-viewfinder corners around the logo (logo is scaled to 60% inside them).
  var BRK = '<path d="M26 56 V46 A20 20 0 0 1 46 26 H56"/><path d="M144 26 H154 A20 20 0 0 1 174 46 V56"/><path d="M174 144 V154 A20 20 0 0 1 154 174 H144"/><path d="M56 174 H46 A20 20 0 0 1 26 154 V144"/>';

  function legPath(x, color) {
    return '<path d="M' + x + ' 57 V166" fill="none" stroke="' + color + '" stroke-width="24" stroke-linecap="round"/>';
  }

  // Static logo. theme: 'light' (blue legs) or 'dark' (light-blue legs).
  function svg(opts) {
    opts = opts || {};
    var legs = opts.theme === 'dark' ? COLORS.legsOnDark : COLORS.legsOnLight;
    var size = opts.size || 40, label = opts.label || 'Missing';
    var frame = opts.theme === 'dark' ? '#F8FAFC' : COLORS.navy;
    var open = opts.frame
      ? '<g fill="none" stroke="' + frame + '" stroke-width="' + (size < 60 ? 12 : 7) + '" stroke-linecap="round" stroke-linejoin="round">' + BRK + '</g><g transform="translate(100 100) scale(0.6) translate(-100 -100)">'
      : '<g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="' + size + '" height="' + size +
      '" role="img" aria-label="' + label + '">' + open + '<g transform="translate(0 -6)">' +
      legPath(40, legs) + legPath(160, legs) +
      '<path d="' + BAR + '" fill="' + COLORS.leaf + '"/><path d="' + S_D + '" fill="' + COLORS.leaf + '"/></g></g></svg>';
  }

  /* ---------- Sound logo (Web Audio, synthesised, no files) ----------
   * MissingLogo.sound(ctx, when, dest) schedules the whole sound on an AudioContext
   * (or OfflineAudioContext) starting at time `when`, in step with the intro timeline.
   * Returns the master GainNode so the caller can fade it out.
   */
  function sound(ctx, when, dest, o) {
    o = o || {};
    var t0 = when || ctx.currentTime;
    var master = ctx.createGain(); master.gain.value = 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(dest || ctx.destination);

    var noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    function env(g, at, peak, a, d) {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + a);
      g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
    }
    function tone(freq, at, dur, peak, type, freqEnd) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, at);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
      env(g, at, peak, 0.005, dur); o.connect(g); g.connect(master);
      o.start(at); o.stop(at + dur + 0.05);
    }
    // soft bell: fundamental + bright partial, quick attack, long tail
    function bell(freq, at, peak, dur) {
      tone(freq, at, dur, peak, 'sine');
      tone(freq * 2.01, at, dur * 0.5, peak * 0.35, 'sine');
      tone(freq * 3.98, at, dur * 0.2, peak * 0.12, 'triangle');
    }
    function whoosh(at, dur, f0, f1, peak) {
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.08);
      s.connect(bp); bp.connect(g); g.connect(master);
      s.start(at); s.stop(at + dur + 0.1);
    }
    function hit(at, peak) {
      tone(140, at, 0.22, peak, 'sine', 45);                 // body thump
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;  // click on contact
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      var g = ctx.createGain(); env(g, at, peak * 0.5, 0.001, 0.05);
      s.connect(hp); hp.connect(g); g.connect(master); s.start(at); s.stop(at + 0.08);
    }
    function spin(at, dur, peak) {                           // whirl while a bar turns
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.value = 1800;
      var g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.setValueAtTime(14, at); lfo.frequency.linearRampToValueAtTime(4, at + dur);
      lg.gain.value = peak * 0.5; lfo.connect(lg); lg.connect(g.gain);
      g.gain.setValueAtTime(peak * 0.5, at); g.gain.linearRampToValueAtTime(0, at + dur);
      s.connect(bp); bp.connect(g); g.connect(master);
      s.start(at); s.stop(at + dur); lfo.start(at); lfo.stop(at + dur);
    }

    function chordAt(at) { bell(1046.5, at, 0.16, 1.4); bell(1318.5, at, 0.08, 1.2); }   // C6 + E6
    master.chord = function () { chordAt(ctx.currentTime + 0.01); };
    var T = function (ms) { return t0 + ms / 1000; };
    tone(392, T(0), 0.7, 0.06, 'sine', 784);                 // T appears: soft rise
    whoosh(T(900), 0.45, 500, 3200, 0.35);                    // right bar flies in
    whoosh(T(1200), 0.45, 450, 2800, 0.3);                    // left bar flies in
    hit(T(1350), 0.7); hit(T(1650), 0.6);                     // the two hits
    tone(196, T(1360), 0.5, 0.12, 'triangle', 294);           // stem bends: springy rise
    tone(220, T(1660), 0.5, 0.1, 'triangle', 330);
    spin(T(1380), 0.9, 0.12); spin(T(1680), 0.85, 0.1);       // bars spin back
    tone(330, T(2550), 0.18, 0.08, 'sine');                   // bars land: little tick
    // signature: two rising notes; the voice "Mít xinh!" follows, then a soft chord
    tone(2093, T(2650), 0.11, 0.05, 'square');                // scan beep (MAO)
    bell(659.25, T(2700), 0.22, 0.5);    // E5
    bell(783.99, T(2860), 0.24, 0.6);    // G5
    if (!o.noChord) chordAt(T(3150));    // without a voice the chord follows straight on
    whoosh(T(3650), 0.6, 2400, 600, 0.12);                    // flies home
    tone(1567.98, T(4300), 0.6, 0.05, 'sine');                // settles: sparkle
    return master;
  }

  /* ---------- Voice "Mít xinh!" (the visitor's own Vietnamese system voice) ----------
   * Prefers Linh (Enhanced / Nâng cao), then any Linh, then any Vietnamese voice.
   * Returns false when the device has no Vietnamese voice, so the caller can fall back to the chord.
   */
  var VOICE = { text: 'Mít xinh!', pitch: 1.35, rate: 0.95 };
  function pickVoice() {
    var syn = global.speechSynthesis; if (!syn) return null;
    var all = syn.getVoices() || [], enh = /(enhanced|premium|nâng cao)/i;
    var vi = all.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('vi') === 0; });
    var linh = vi.filter(function (v) { return /linh/i.test(v.name); });
    return linh.filter(function (v) { return enh.test(v.name); })[0] || linh[0] || vi[0] || null;
  }
  function sayName(onEnd) {
    var syn = global.speechSynthesis, v = pickVoice();
    if (!syn || !v) return false;
    var u = new SpeechSynthesisUtterance(VOICE.text);
    u.voice = v; u.lang = v.lang; u.pitch = VOICE.pitch; u.rate = VOICE.rate;
    var fired = false, fin = function () { if (!fired) { fired = true; if (onEnd) onEnd(); } };
    u.onend = fin; u.onerror = fin; setTimeout(fin, 1800);
    syn.cancel(); syn.speak(u);
    return true;
  }
  if (global.speechSynthesis && global.speechSynthesis.getVoices) global.speechSynthesis.getVoices();   // warm up the list

  var clamp = function (t) { return Math.max(0, Math.min(1, t)); };
  var seg = function (t, s, e) { return clamp((t - s) / (e - s)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeIn = function (t) { return t * t * t; };
  var easeBack = function (t) { var c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  var LAND = 2550;   // ms: logo fully assembled
  var WORD = 800;    // ms: the word runs out beside the logo (only when opts.word is given)
  var HOLD = 300;    // ms: pause before flying to the target
  var FLY = 700;     // ms: flight into the target slot

  /* opts.target     element (svg/img/div, square) where the logo lives after the intro; required
   * opts.background overlay colour, default navy
   * opts.word       element holding the wordmark text (e.g. "missing") in the header; optional.
   *                 When given, the word runs out beside the logo, then flies into this element.
   * opts.theme      legs colour of the TARGET logo: 'light' | 'dark' (default 'light')
   * opts.sound      play the sound logo (default true). Browsers only allow sound after the
   *                 visitor has interacted with the page, so on a cold page load it stays silent.
   * opts.voice      say "Mít xinh!" with the visitor's Vietnamese voice, Linh Enhanced first (default true)
   * opts.once       play once per browser session (default true)
   * opts.onDone     callback when finished
   */
  function intro(opts) {
    opts = opts || {};
    var target = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var word = typeof opts.word === 'string' ? document.querySelector(opts.word) : opts.word;
    var done = function () {
      if (target) target.style.visibility = '';
      if (word) word.style.visibility = '';
      if (opts.onDone) opts.onDone();
    };
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var seen = false;
    try { seen = opts.once !== false && sessionStorage.getItem('missing-intro') === '1'; } catch (e) {}
    if (!target || reduce || seen) { done(); return; }
    try { sessionStorage.setItem('missing-intro', '1'); } catch (e) {}

    var legsIntro = COLORS.legsOnDark;
    var legsEnd = opts.theme === 'dark' ? COLORS.legsOnDark : COLORS.legsOnLight;
    target.style.visibility = 'hidden';
    if (word) word.style.visibility = 'hidden';

    var overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;' +
      'background:' + (opts.background || COLORS.navy) + ';cursor:pointer;';
    var size = Math.min(400, Math.round(Math.min(innerWidth, innerHeight) * 0.7));   // logo is drawn at 60% inside the frame
    overlay.innerHTML =
      '<svg viewBox="0 0 200 200" width="' + size + '" height="' + size + '" style="overflow:visible;transform-origin:0 0">' +
      '<g class="mi-br" fill="none" stroke="#F8FAFC" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0">' + BRK + '</g>' +
      '<line class="mi-scan" x1="34" x2="166" y1="30" y2="30" stroke="' + COLORS.leaf + '" stroke-width="3" stroke-linecap="round" opacity="0"/>' +
      '<g transform="translate(100 100) scale(0.6) translate(-100 -100)"><g transform="translate(0 -6)"><g class="mi-shake">' +
      '<g class="mi-legL"><path class="mi-trailL" d="M-136 111.5 H-36" fill="none" stroke="' + legsIntro + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="30 12"/>' +
      '<g class="mi-spinL">' + legPath(40, legsIntro) + '</g></g>' +
      '<g class="mi-legR"><path class="mi-trailR" d="M236 111.5 H336" fill="none" stroke="' + legsIntro + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="30 12"/>' +
      '<g class="mi-spinR">' + legPath(160, legsIntro) + '</g></g>' +
      '<path class="mi-stem" fill="' + COLORS.leaf + '"/><path class="mi-bar" d="' + BAR + '" fill="' + COLORS.leaf + '"/>' +
      '</g></g></g></svg>';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;';
    row.appendChild(overlay.firstChild);
    overlay.appendChild(row);
    var wordBox = null, wordText = null, wordW = 0;
    if (word) {
      var ws = getComputedStyle(word);
      wordBox = document.createElement('div');
      wordBox.style.cssText = 'overflow:hidden;width:0;flex:none;';
      wordText = document.createElement('span');
      wordText.textContent = word.textContent.trim();
      wordText.style.cssText = 'display:inline-block;white-space:nowrap;line-height:1.3;color:#F8FAFC;transform-origin:0 0;' +
        'padding-left:' + Math.round(size * 0.024) + 'px;font-family:' + ws.fontFamily + ';font-weight:' + ws.fontWeight +
        ';letter-spacing:' + (ws.letterSpacing === 'normal' ? '0' : (parseFloat(ws.letterSpacing) / parseFloat(ws.fontSize)) + 'em') +
        ';font-size:' + Math.round(size * 0.252) + 'px;';
      wordBox.appendChild(wordText);
      row.appendChild(wordBox);
    }
    document.body.appendChild(overlay);
    if (wordText) {
      wordW = wordText.getBoundingClientRect().width;
      // on narrow screens shrink logo + word so the pair fits the width
      var fit = Math.min(1, innerWidth * 0.86 / (size + wordW));
      if (fit < 1) {
        var svgEl = row.firstChild;
        svgEl.setAttribute('width', Math.round(size * fit)); svgEl.setAttribute('height', Math.round(size * fit));
        wordText.style.fontSize = Math.round(size * 0.252 * fit) + 'px';
        wordText.style.paddingLeft = Math.round(size * 0.024 * fit) + 'px';
        wordW = wordText.getBoundingClientRect().width;
      }
    }
    var root = row.firstChild, q = function (c) { return root.querySelector('.' + c); };
    var stem = q('mi-stem'), bar = q('mi-bar'), legL = q('mi-legL'), legR = q('mi-legR'),
        spinL = q('mi-spinL'), spinR = q('mi-spinR'), trailL = q('mi-trailL'), trailR = q('mi-trailR'), shake = q('mi-shake'),
        br = q('mi-br'), scan = q('mi-scan');
    var N = T_POLY.length / 4, U = [], k;
    for (k = 0; k < 2 * N; k++) U.push(k < N ? k / (N - 1) : (2 * N - 1 - k) / (N - 1));

    function barMotion(t, t0, hit, dy, far, dir) {
      var tHit = t0 + 450, tEnd = tHit + 900;
      if (t < tHit) return { x: lerp(far, hit, easeIn(seg(t, t0, tHit))), y: dy, r: 90 };
      var p = seg(t, tHit, tEnd), e = easeOut(p);
      return { x: lerp(hit, 0, e) + Math.sin(Math.PI * Math.min(p * 1.4, 1)) * 46 * dir,
               y: lerp(dy, 0, e) - Math.sin(Math.PI * p) * 14, r: 90 + 630 * e };
    }
    function frame(t) {
      bar.setAttribute('transform', 'translate(100 46) scale(' + Math.max(easeOut(seg(t, 0, 600)), .001) + ' 1) translate(-100 -46)');
      stem.setAttribute('transform', 'translate(100 46) scale(1 ' + Math.max(easeOut(seg(t, 250, 800)), .001) + ') translate(-100 -46)');
      var R = barMotion(t, 900, 16.5, -24, 340, 1), Lb = barMotion(t, 1200, -16.5, 30, -340, -1);
      legR.setAttribute('transform', 'translate(' + R.x + ' ' + R.y + ')');
      legL.setAttribute('transform', 'translate(' + Lb.x + ' ' + Lb.y + ')');
      spinR.setAttribute('transform', 'rotate(' + R.r + ' 160 111.5)');
      spinL.setAttribute('transform', 'rotate(' + (-Lb.r) + ' 40 111.5)');
      legR.style.opacity = t >= 900 ? 1 : 0;
      legL.style.opacity = t >= 1200 ? 1 : 0;
      trailR.style.opacity = t < 1350 ? .55 * seg(t, 900, 1300) : 0;
      trailL.style.opacity = t < 1650 ? .55 * seg(t, 1200, 1600) : 0;
      var jolt = function (s, dir) { var j = seg(t, s, s + 240); return j > 0 && j < 1 ? dir * Math.sin(j * Math.PI * 4) * 4 * (1 - j) : 0; };
      shake.setAttribute('transform', 'translate(' + (jolt(1350, -1) + jolt(1650, 1)) + ' 0)');
      var mTop = easeBack(seg(t, 1350, 1800)), mBot = easeBack(seg(t, 1650, 2150)), out = new Array(T_POLY.length);
      for (var i = 0; i < T_POLY.length; i += 2) {
        var m = lerp(mTop, mBot, smooth(.3, .7, U[i / 2]));
        out[i] = lerp(T_POLY[i], S_POLY[i], m); out[i + 1] = lerp(T_POLY[i + 1], S_POLY[i + 1], m);
      }
      stem.setAttribute('d', toD(out));
      // MAO: QR corners pop in, then a green scan line sweeps down
      var bb = easeOut(seg(t, 2450, 2950));
      br.setAttribute('opacity', bb);
      br.setAttribute('transform', 'translate(100 100) scale(' + lerp(1.18, 1, bb) + ') translate(-100 -100)');
      var sc = seg(t, 2650, 3250), sy = lerp(32, 168, sc);
      scan.setAttribute('y1', sy); scan.setAttribute('y2', sy);
      scan.setAttribute('opacity', sc > 0 && sc < 1 ? Math.sin(Math.PI * sc) * 0.95 : 0);
      if (wordBox) {
        var w = easeOut(seg(t, LAND + 100, LAND + WORD));
        wordBox.style.width = (wordW * w) + 'px';
        wordText.style.transform = 'translateX(' + lerp(-40, 0, w) + 'px)';
        wordText.style.opacity = Math.min(1, w * 1.6);
      }
    }
    var END = LAND + (word ? WORD : 0);

    var actx = null, master = null;
    if (opts.sound !== false) {
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        actx = new AC(); if (actx.resume) actx.resume();
        master = sound(actx, actx.currentTime + 0.05, null, { noChord: opts.voice !== false });
      } catch (e) { actx = null; }
    }
    var voiceTimer = 0;
    if (master && opts.voice !== false) {
      voiceTimer = setTimeout(function () {
        if (!sayName(function () { if (!skipped) master.chord(); })) master.chord();
      }, 3020);
    }
    var skipped = false;
    var start = null, raf = 0, finished = false;
    function flyHome() {
      if (finished) return; finished = true;
      cancelAnimationFrame(raf);
      if (skipped && master) master.gain.setTargetAtTime(0, actx.currentTime, 0.06);
      if (skipped) { clearTimeout(voiceTimer); if (global.speechSynthesis) global.speechSynthesis.cancel(); }
      frame(END);
      // the logo already sits in the target spot, so recolour the legs to the target theme
      root.querySelectorAll('.mi-spinL path, .mi-spinR path').forEach(function (p) {
        p.style.transition = 'stroke ' + FLY + 'ms'; p.style.stroke = legsEnd;
      });
      var a = root.getBoundingClientRect(), b = target.getBoundingClientRect();
      var s = b.width / a.width;
      var dx = b.left - a.left, dy = b.top - a.top;
      var fly = root.animate([{ transform: 'none' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }],
        { duration: FLY, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
      overlay.animate([{ backgroundColor: getComputedStyle(overlay).backgroundColor }, { backgroundColor: 'rgba(0,0,0,0)' }],
        { duration: FLY * 0.8, easing: 'ease-out', fill: 'forwards' });
      if (wordText) {
        var ws2 = getComputedStyle(word), a2 = wordText.getBoundingClientRect(), b2 = word.getBoundingClientRect();
        var pad = parseFloat(wordText.style.paddingLeft) || 0;
        var s2 = parseFloat(ws2.fontSize) / parseFloat(wordText.style.fontSize);
        var tx = b2.left - (a2.left + pad * s2), ty = (b2.top + b2.height / 2) - (a2.top + a2.height * s2 / 2);
        wordBox.style.overflow = 'visible';
        wordText.animate([{ transform: 'none', color: '#F8FAFC' },
                          { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + s2 + ')', color: ws2.color }],
          { duration: FLY, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
      }
      fly.onfinish = function () {
        overlay.remove(); done();
        if (actx) setTimeout(function () { try { actx.close(); } catch (e) {} }, skipped ? 300 : 2600);
      };
    }
    function tick(now) {
      if (start === null) start = now;
      var t = now - start;
      if (t >= END + HOLD) { flyHome(); return; }
      frame(Math.min(t, END));
      raf = requestAnimationFrame(tick);
    }
    overlay.addEventListener('click', function () { skipped = true; flyHome(); });   // tap to skip
    frame(0);
    raf = requestAnimationFrame(tick);
  }

  // Play only the sound logo (e.g. from a button). Must be called from a user action.
  function playSound(withVoice) {
    var AC = global.AudioContext || global.webkitAudioContext, c = new AC();
    var m = sound(c, c.currentTime + 0.05, null, { noChord: withVoice !== false });
    if (withVoice !== false) setTimeout(function () { if (!sayName(m.chord)) m.chord(); }, 3020);
    setTimeout(function () { try { c.close(); } catch (e) {} }, 7000);
  }

  global.MissingLogo = { svg: svg, intro: intro, sound: sound, playSound: playSound, sayName: sayName, colors: COLORS, paths: { bar: BAR, s: S_D } };
})(window);
