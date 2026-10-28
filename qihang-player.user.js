// ==UserScript==
// @name         启航播放器增强 · 长按倍速
// @namespace    qihang-player-enhancer
// @version      1.5.1
// @homepageURL  https://github.com/kkkioio/qihang-player-enhancer
// @supportURL   https://github.com/kkkioio/qihang-player-enhancer/issues
// @updateURL    https://raw.githubusercontent.com/kkkioio/qihang-player-enhancer/main/qihang-player.user.js
// @downloadURL  https://raw.githubusercontent.com/kkkioio/qihang-player-enhancer/main/qihang-player.user.js
// @description  长按加速、音量快捷键、字幕外观与位置设置，支持倍速、全屏、字幕和静音快捷键，保留原播放器空格键。
// @match        https://www.iqihang.com/ark/*
// @match        https://iqihang.com/ark/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(() => {
  'use strict';
  const INSTANCE = '__qihangPlayerEnhancer';
  window[INSTANCE]?.destroy();
  const HOLD_DELAY = 280;
  const HOLD_RATES = [1.5, 2, 2.5, 3];
  const RATE_STEPS = [0.8, 1, 1.2, 1.5, 2, 2.5, 3];
  const STORAGE_KEY = 'qihang-enhancer:hold-rate:v1';
  const SUBTITLE_KEY = 'qihang-enhancer:subtitle:v1';
  const FONTS = {
    system:'system-ui,sans-serif', yahei:'"Microsoft YaHei",sans-serif',
    pingfang:'"PingFang SC",sans-serif', noto:'"Noto Sans CJK SC","Source Han Sans SC",sans-serif',
    song:'SimSun,serif', mono:'Consolas,"Microsoft YaHei",monospace',
  };
  const DEFAULT_SUBTITLES = { enabled:false, size:24, color:'#ffffff', weight:600, font:'system', x:50, bottom:12, outline:true, transparency:0 };
  let subtitleConfig = { ...DEFAULT_SUBTITLES };
  let media = null;
  let settingsHost = null;
  let settingsUI = null;
  let settingsOpen = false;
  let settingsMenu = null;
  let lastVolumeAt = -Infinity;
  const cleanups = [];
  const swallowedKeys = new Set();
  const subtitleSelections = new WeakMap();
  const audibleVolumes = new WeakMap();
  let hold = null;
  let preferredRate = 2;
  let host = null;
  let ui = null;
  let toastTimer = 0;
  let suppressClick = null;
  let route = location.href;
  let destroyed = false;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (HOLD_RATES.includes(saved)) preferredRate = saved;
  } catch { /* 倍速记忆不可用时仍可正常使用。 */ }
  try { subtitleConfig = validateSubtitles(JSON.parse(localStorage.getItem(SUBTITLE_KEY))); } catch { /* 使用默认设置。 */ }

  function validateSubtitles(value) {
    const v = value && typeof value === 'object' ? value : {};
    const number = (key, min, max) => typeof v[key] === 'number' && Number.isFinite(v[key])
      ? Math.max(min, Math.min(max, v[key])) : DEFAULT_SUBTITLES[key];
    return {
      enabled:v.enabled === true, size:number('size',12,64), x:number('x',10,90), bottom:number('bottom',4,90),
      color:typeof v.color === 'string' && /^#[\da-f]{6}$/i.test(v.color) ? v.color : DEFAULT_SUBTITLES.color,
      weight:[400,500,600,700,800].includes(v.weight) ? v.weight : DEFAULT_SUBTITLES.weight,
      font:Object.hasOwn(FONTS,v.font) ? v.font : DEFAULT_SUBTITLES.font,
      outline:typeof v.outline === 'boolean' ? v.outline : DEFAULT_SUBTITLES.outline,
      transparency:number('transparency',0,100),
    };
  }

  const format = rate => `${Number(rate.toFixed(2))}×`;
  const coursePage = () => /^\/ark\/(record|playback|playbackBJY)(\/|$)/.test(location.pathname);
  const editable = event => event.composedPath().some(el => el instanceof Element &&
    (el.matches('input,textarea,select,[role="textbox"],[role="slider"],[role="spinbutton"]') || el.isContentEditable));
  const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function on(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function context() {
    if (!coursePage()) return null;
    const video = [...document.querySelectorAll('#player video')].find(v =>
      v.isConnected && v.getBoundingClientRect().width > 0 && v.readyState >= 1);
    if (!video) return null;
    return { video, container: video.closest('.CCH5playerContainer') || document.querySelector('#player') };
  }

  // 普通倍速复用原菜单；临时倍速只改变当前 video，避免 CC 记忆临时速度并传给下一节课。
  function setRate(ctx, rate, temporary = false) {
    if (!ctx?.video.isConnected) return false;
    try {
      if (!temporary) {
        const item = [...ctx.container.querySelectorAll('.ccH5spul li[data-sp]')]
          .find(el => Math.abs(Number(el.dataset.sp) - rate) < 0.001);
        item?.click();
      }
      if (Math.abs(ctx.video.playbackRate - rate) > 0.001) ctx.video.playbackRate = rate;
      return Math.abs(ctx.video.playbackRate - rate) < 0.001;
    } catch { return false; }
  }

  function overlayContainer(ctx) {
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen && fullscreen.contains(ctx.video) && fullscreen.tagName !== 'VIDEO') return fullscreen;
    // CC 全屏的是画面容器，外层 CCH5playerContainer 的兄弟节点不会进入全屏顶层。
    return ctx.video.closest('.ccH5playerBox') || ctx.container;
  }

  function ensureUI(ctx) {
    if (!host) {
      host = document.createElement('div');
      host.id = 'qihang-enhancer-overlay';
      host.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:2147483000;pointer-events:none;max-width:calc(100% - 24px);';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host { color:#fff; font-family:"Microsoft YaHei",system-ui,sans-serif; }
        * { box-sizing:border-box; }
        .panel { display:flex; align-items:center; gap:12px; padding:4px 14px; border-radius:7px; background:rgba(24,24,27,.85); backdrop-filter:blur(10px); box-shadow:0 4px 16px #0004; white-space:nowrap; }
        .left { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:700; }
        .arrows { display:flex; gap:2px; }
        .arrows i { width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:8px solid #aaa;animation:pulse 1s infinite; }
        .arrows i:nth-child(2) { animation-delay:.15s; } .arrows i:nth-child(3) { animation-delay:.3s; }
        @keyframes pulse { 50% { opacity:.35; } }
        .speeds { width:38px; text-align:center; }
        .neighbor { height:12px; line-height:12px; font-size:10px; color:#aaa; }
        .current { font-size:20px; font-weight:800; line-height:22px; }
        .toast { padding:8px 14px; border-radius:7px; background:rgba(24,24,27,.85); font-size:14px; font-weight:600; white-space:nowrap; box-shadow:0 4px 16px #0004; }
        [hidden] { display:none!important; }
        @media (prefers-reduced-motion:reduce) { .arrows i { animation:none; } }
      </style>
      <div class="panel" role="status" hidden>
        <div class="left"><span class="arrows" aria-hidden="true"><i></i><i></i><i></i></span><span>倍速播放中</span></div>
        <div class="speeds"><div class="neighbor previous"></div><div class="current"></div><div class="neighbor next"></div></div>
      </div><div class="toast" role="status" hidden></div>`;
      ui = Object.fromEntries(['panel','previous','current','next','toast'].map(name => [name, shadow.querySelector(`.${name}`)]));
    }
    const parent = overlayContainer(ctx);
    if (host.parentElement !== parent) parent.append(host);
    host.hidden = false;
  }

  function showHold() {
    if (!hold?.active) return;
    ensureUI(hold);
    clearTimeout(toastTimer);
    const index = HOLD_RATES.indexOf(hold.boostRate);
    ui.panel.hidden = false;
    ui.toast.hidden = true;
    ui.current.textContent = format(hold.boostRate);
    ui.previous.textContent = index > 0 ? format(HOLD_RATES[index - 1]) : '';
    ui.next.textContent = index < HOLD_RATES.length - 1 ? format(HOLD_RATES[index + 1]) : '';
  }

  function toast(ctx, text) {
    if (hold?.active) return;
    ensureUI(ctx);
    ui.panel.hidden = true;
    ui.toast.hidden = false;
    ui.toast.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (host && !hold?.active) host.hidden = true; }, 1100);
  }

  function startBoost() {
    if (!hold || hold.active) return;
    if (!hold.video.isConnected || !coursePage() || document.hidden) { finishHold(); return; }
    hold.originalRate = hold.video.playbackRate;
    hold.active = true;
    if (!setRate(hold, hold.boostRate, true)) { finishHold(); return; }
    showHold();
  }

  function beginHold(ctx, kind, pointer = null) {
    if (hold) return;
    hold = { ...ctx, kind, pointer, originalRate:ctx.video.playbackRate, boostRate:preferredRate, active:false, timer:0 };
    hold.timer = setTimeout(startBoost, HOLD_DELAY);
  }

  function finishHold({ shortSeek = false, suppress = true } = {}) {
    if (!hold) return;
    const finished = hold;
    hold = null;
    clearTimeout(finished.timer);
    if (finished.active) {
      if (finished.video.isConnected) setRate(finished, finished.originalRate, true);
      else { try { finished.video.playbackRate = finished.originalRate; } catch { /* 已销毁。 */ } }
      if (suppress && finished.kind === 'pointer') suppressClick = { video:finished.video, until:performance.now() + 700 };
    } else if (shortSeek && finished.kind === 'keyboard' && finished.video.isConnected) {
      seek(finished, 5);
    }
    if (host) host.hidden = true;
  }

  function seek(ctx, seconds) {
    const target = Math.max(0, Math.min(ctx.video.currentTime + seconds, Number.isFinite(ctx.video.duration) ? ctx.video.duration : Infinity));
    try {
      const root = ctx.container.closest('.record');
      const player = root?.__vue__?.player;
      if (typeof player?.jumpToTime === 'function') player.jumpToTime(target);
      else if (typeof player?.seek === 'function') player.seek(target);
      else ctx.video.currentTime = target;
    } catch { /* 视频尚未可以跳转时忽略短按。 */ }
  }

  function adjustHold(direction) {
    if (!hold) return;
    const index = HOLD_RATES.indexOf(hold.boostRate);
    hold.boostRate = HOLD_RATES[Math.max(0, Math.min(HOLD_RATES.length - 1, index + direction))];
    preferredRate = hold.boostRate;
    try { localStorage.setItem(STORAGE_KEY, String(preferredRate)); } catch { /* 可选记忆。 */ }
    if (!hold.active) startBoost();
    else { if (!setRate(hold, hold.boostRate, true)) finishHold(); else showHold(); }
  }

  async function toggleFullscreen(ctx) {
    try {
      const player = ctx.container.closest('.record')?.__vue__?.player;
      const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
        document.webkitIsFullScreen || player?.isFullScreen?.();
      if (fullscreen) {
        if (typeof player?.normalScreen === 'function') player.normalScreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (typeof player?.fullScreen === 'function') player.fullScreen();
      else {
        const button = ctx.container.querySelector('.ccH5FullsBtn');
        if (button) button.click();
        else await ctx.container.requestFullscreen();
      }
    } catch { toast(ctx, '暂时无法全屏，请点击播放器全屏按钮'); }
  }

  function toggleMute(ctx) {
    const video = ctx.video;
    const silent = video.muted || video.volume === 0;
    if (silent) {
      if (video.volume === 0) setVolume(ctx, audibleVolumes.get(video) || 0.8);
      video.muted = false;
    } else {
      audibleVolumes.set(video, video.volume);
      video.muted = true;
    }
    toast(ctx, silent ? '已取消静音' : '已静音');
  }

  function setVolume(ctx, value) {
    const volume = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    const player = ctx.container.closest('.record')?.__vue__?.player;
    try { player?.setVolume?.(volume); } catch { /* 没有可用的 CC 实例时使用媒体接口。 */ }
    if (Math.abs(ctx.video.volume - volume) > 0.001) ctx.video.volume = volume;
    ctx.video.muted = volume === 0;
    if (volume > 0) audibleVolumes.set(ctx.video, volume);
  }

  function adjustVolume(ctx, direction, repeat) {
    const now = performance.now();
    if (repeat && now - lastVolumeAt < 80) return;
    lastVolumeAt = now;
    setVolume(ctx, ctx.video.volume + direction * 0.05);
    toast(ctx, `音量 ${Math.round(ctx.video.volume * 100)}%`);
  }

  function courseTracks(ctx) {
    // 跑马灯水印也用字幕类型轨道；只处理实际课程字幕。
    return [...(ctx.video.textTracks || [])].filter(track =>
      ['subtitles','captions'].includes(track.kind) &&
      !(ctx.container.matches('.CCH5playerContainer') && track.label === '字幕' && track.language === 'zh_CN'));
  }

  function visibleTracks(ctx) {
    return courseTracks(ctx).filter(track => track.mode === 'showing' ||
      (subtitleConfig.enabled && media?.video === ctx.video && media.managed.has(track) && track.mode === 'hidden'));
  }

  function toggleSubtitles(ctx) {
    const video = ctx.video;
    // CC 的跑马灯也用 TextTrack 实现，不能把版权水印当作课程字幕关闭。
    const tracks = courseTracks(ctx);
    if (!tracks.length) { toast(ctx, '当前视频没有可切换字幕'); return; }
    try {
      // 优先点 CC 设置中的字幕开关，同时同步它记住的语言和菜单勾选状态。
      const setting = ctx.container.querySelector('.ccH5SettingArea');
      const nativeToggle = setting?.querySelector('.switchVtt em') ||
        (setting?.querySelector('.switchVtt span[data-type="vtt"]') && setting.querySelector('em'));
      if (nativeToggle) {
        nativeToggle.click();
        syncSubtitles();
        toast(ctx, nativeToggle.classList.contains('checked') ? '字幕已开启' : '字幕已关闭');
        return;
      }
      const showing = visibleTracks(ctx);
      if (showing.length) {
        subtitleSelections.set(video, showing);
        showing.forEach(track => { track.mode = 'disabled'; });
        toast(ctx, '字幕已关闭');
      } else {
        const selected = subtitleSelections.get(video)?.filter(track => tracks.includes(track));
        const restore = selected?.length ? selected : [tracks[0]];
        restore.forEach(track => { track.mode = 'showing'; });
        toast(ctx, '字幕已开启');
      }
      syncSubtitles();
    } catch { toast(ctx, '暂时无法切换字幕，请使用播放器字幕菜单'); }
  }

  function mediaOn(target, type, listener) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener);
    media.listeners.push(() => target.removeEventListener(type, listener));
  }

  function detachMedia() {
    if (!media) return;
    const previous = media;
    media = null;
    previous.listeners.forEach(remove => remove());
    previous.resize?.disconnect();
    // 只还原脚本接管且仍为 hidden 的课程轨道，不重新开启用户已关闭的字幕。
    previous.managed.forEach(track => { if (track.mode === 'hidden') track.mode = 'showing'; });
    previous.layer?.remove();
    releaseSettingsMenu();
    settingsHost?.remove();
    settingsOpen = false;
  }

  function attachMedia(ctx) {
    if (media?.video === ctx?.video) return;
    detachMedia();
    if (!ctx) return;
    media = { ...ctx, managed:new Set(), tracks:new Set(), listeners:[], layer:null, line:null, signature:'', syncing:false };
    mediaOn(ctx.video.textTracks,'change',syncSubtitles);
    mediaOn(ctx.video.textTracks,'addtrack',syncSubtitles);
    mediaOn(ctx.video.textTracks,'removetrack',syncSubtitles);
    for (const type of ['loadedmetadata','loadeddata','timeupdate','seeked']) mediaOn(ctx.video,type,syncSubtitles);
    mediaOn(ctx.video,'ended',() => { if (media?.layer) media.layer.hidden = true; });
    for (const element of ctx.video.querySelectorAll('track')) mediaOn(element,'load',syncSubtitles);
    if (typeof ResizeObserver === 'function') {
      media.resize = new ResizeObserver(renderSubtitles);
      media.resize.observe(ctx.video);
    }
    ensureSettings(ctx);
    syncSubtitles();
  }

  function syncSubtitles() {
    const state = media;
    if (!state || state.syncing) return;
    state.syncing = true;
    try {
      const tracks = courseTracks(state);
      for (const track of tracks) {
        if (!state.tracks.has(track)) { state.tracks.add(track); mediaOn(track,'cuechange',syncSubtitles); }
        if (subtitleConfig.enabled && track.mode === 'showing') {
          state.managed.add(track);
          track.mode = 'hidden'; // 保留字幕加载、时间和事件，仅改由自己的图层显示。
        } else if (track.mode === 'disabled') state.managed.delete(track);
      }
      for (const track of [...state.managed]) {
        if (!subtitleConfig.enabled || !tracks.includes(track)) {
          state.managed.delete(track);
          if (track.mode === 'hidden') track.mode = 'showing';
        }
      }
      const note = tracks.length ? '调整任一选项即可启用；字号随画面大小缩放。'
        : '字幕尚未加载，设置会在字幕出现后应用。';
      if (settingsUI && settingsUI.note.textContent !== note) settingsUI.note.textContent = note;
      renderSubtitles();
    } finally { state.syncing = false; }
  }

  function renderSubtitles() {
    const state = media;
    if (!state) return;
    if (!subtitleConfig.enabled) { if (state.layer) state.layer.hidden = true; return; }
    const parent = overlayContainer(state);
    if (!state.layer) {
      state.layer = document.createElement('div');
      state.layer.id = 'qihang-enhancer-subtitles';
      state.layer.style.cssText = 'position:absolute;pointer-events:none;z-index:2147482990;overflow:hidden;';
      const shadow = state.layer.attachShadow({ mode:'open' });
      shadow.innerHTML = '<style>:host{pointer-events:none}.line{position:absolute;transform:translateX(-50%);width:max-content;max-width:90%;text-align:center;white-space:pre-line;overflow-wrap:anywhere;line-height:1.4}.line *{font-family:inherit;font-size:inherit;font-weight:inherit;color:inherit}.line>div+div{margin-top:.15em}</style><div class="line"></div>';
      state.line = shadow.querySelector('.line');
    }
    if (state.layer.parentElement !== parent) parent.append(state.layer);
    const vr = state.video.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    let width = vr.width, height = vr.height, left = vr.left - pr.left, top = vr.top - pr.top;
    // contain 视频按实际内容区域定位，不把字幕放到黑边上。
    const fit = getComputedStyle(state.video).objectFit;
    if ((fit === 'contain' || fit === 'scale-down') && state.video.videoWidth && state.video.videoHeight) {
      const scale = Math.min(width / state.video.videoWidth, height / state.video.videoHeight, fit === 'scale-down' ? 1 : Infinity);
      const w = state.video.videoWidth * scale, h = state.video.videoHeight * scale;
      left += (width - w) / 2; top += (height - h) / 2; width = w; height = h;
    }
    Object.assign(state.layer.style, { left:`${left}px`, top:`${top}px`, width:`${width}px`, height:`${height}px` });
    const cfg = subtitleConfig;
    Object.assign(state.line.style, {
      left:`${cfg.x}%`, bottom:`${cfg.bottom}%`, fontSize:`${Math.max(12,Math.min(128,cfg.size * height / 720))}px`,
      color:cfg.color, fontWeight:String(cfg.weight), fontFamily:FONTS[cfg.font],
      opacity:String(1 - cfg.transparency / 100),
      textShadow:cfg.outline ? '-1px -1px 1px #000,1px -1px 1px #000,-1px 1px 1px #000,1px 1px 1px #000,0 2px 4px #000b' : 'none',
    });
    const cues = [...state.managed].filter(track => track.mode === 'hidden')
      .flatMap(track => [...(track.activeCues || [])]);
    const signature = JSON.stringify(cues.map(cue => [cue.startTime,cue.endTime,cue.text]));
    if (state.signature !== signature) {
      state.signature = signature;
      state.line.replaceChildren();
      for (const cue of cues) {
        const line = document.createElement('div');
        // 浏览器把 WebVTT 内容转为受限的字幕标记，不把字幕字符串当作任意 HTML。
        if (typeof cue.getCueAsHTML === 'function') line.append(cue.getCueAsHTML());
        else line.textContent = cue.text;
        state.line.append(line);
      }
    }
    state.layer.hidden = !cues.length || state.video.ended;
  }

  function ensureSettings(ctx) {
    const speed = ctx.container.querySelector('span.ccH5sp');
    const bar = speed?.closest('section');
    if (!speed || !bar) {
      releaseSettingsMenu();
      settingsHost?.remove();
      settingsOpen = false;
      return false;
    }
    if (!settingsHost) {
      settingsHost = document.createElement('div');
      settingsHost.id = 'qihang-enhancer-settings';
      settingsHost.style.cssText = 'display:block;position:relative;float:right;width:64px;height:24px;margin:8px 10px 0 0;padding:0;line-height:24px;text-align:left;color:#ddd;';
      const shadow = settingsHost.attachShadow({ mode:'open' });
      shadow.innerHTML = `<style>
        :host{font-family:inherit;color:inherit;font-size:13px}*{box-sizing:border-box}
        button,input,select{font:inherit}button{cursor:pointer;border:0;color:inherit;background:#ffffff12;border-radius:4px;padding:5px 8px}button:hover{background:#ffffff24}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #ff8a24;outline-offset:2px}
        .launcher{display:block;width:64px;height:24px;line-height:24px;padding:0;font-size:12px;background:rgba(51,51,51,.5);border-radius:100px;white-space:nowrap}.launcher[aria-expanded=true]{background:rgba(255,146,10,.6);color:white}
        .settings{position:absolute;bottom:36px;right:var(--qihang-panel-right,0px);width:300px;max-width:var(--qihang-settings-width,300px);max-height:var(--qihang-settings-height,400px);overflow-y:auto;padding:8px 12px 12px;line-height:normal;color:#ddd;background:rgba(30,30,30,.95);border:1px solid #6663;border-radius:4px;box-shadow:0 0 8px #0008;z-index:100000}
        header{display:flex;align-items:center;justify-content:space-between;margin:8px 0}header strong{font-size:13px}
        label{display:block;margin:9px 0}label.row{display:flex;gap:10px;align-items:center;justify-content:space-between}input[type=range]{display:block;width:100%;margin:6px 0 0;accent-color:#ff8a24}input[type=checkbox]{accent-color:#ff8a24}
        select{max-width:150px;padding:4px;color:inherit;background:#353942;border:1px solid #ffffff30;border-radius:4px}input[type=color]{width:44px;height:25px;border:0;padding:2px;background:#353942;border-radius:4px}
        output{float:right;opacity:.7}.note{font-size:11px;line-height:1.5;opacity:.65;margin:8px 0}.reset{width:100%;margin-top:4px}[hidden]{display:none!important}
      </style>
      <button class="launcher" type="button" title="字幕设置（S）" aria-expanded="false" aria-controls="subtitle-appearance">字幕设置</button>
      <section id="subtitle-appearance" class="settings" aria-label="字幕设置" hidden>
        <header><strong>字幕设置</strong><button class="close" type="button" aria-label="收起字幕设置">×</button></header>
        <label class="row">自定义字幕样式<input name="enabled" type="checkbox"></label>
        <label>字号<output data-for="size"></output><input name="size" type="range" min="12" max="64" step="1"></label>
        <label>水平位置<output data-for="x"></output><input name="x" type="range" min="10" max="90" step="1"></label>
        <label>距离底部<output data-for="bottom"></output><input name="bottom" type="range" min="4" max="90" step="1"></label>
        <label class="row">文字颜色<input name="color" type="color"></label>
        <label title="0% 不透明，100% 完全透明">透明度<output data-for="transparency"></output><input name="transparency" type="range" min="0" max="100" step="1"></label>
        <label class="row">粗细<select name="weight"><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option><option value="800">特粗</option></select></label>
        <label class="row">字体<select name="font"><option value="system">系统默认</option><option value="yahei">微软雅黑</option><option value="pingfang">苹方</option><option value="noto">思源黑体</option><option value="song">宋体</option><option value="mono">等宽字体</option></select></label>
        <label class="row">描边阴影<input name="outline" type="checkbox"></label>
        <p class="note"></p><button class="reset" type="button">恢复默认</button>
      </section>`;
      settingsUI = { panel:shadow.querySelector('.settings'), launcher:shadow.querySelector('.launcher'), note:shadow.querySelector('.note'), fields:[...shadow.querySelectorAll('[name]')], shadow };
      on(settingsUI.launcher,'click',() => toggleSettings());
      on(shadow.querySelector('.close'),'click',() => toggleSettings(false));
      on(shadow.querySelector('.reset'),'click',() => saveSubtitles({ ...DEFAULT_SUBTITLES }));
      const change = event => {
        const field = event.target;
        if (!field.name) return;
        const value = field.type === 'checkbox' ? field.checked : ['size','x','bottom','weight','transparency'].includes(field.name) ? Number(field.value) : field.value;
        const next = { ...subtitleConfig, [field.name]:value };
        if (field.name !== 'enabled') next.enabled = true;
        saveSubtitles(next);
      };
      on(shadow,'input',change);
      on(shadow,'change',change);
      // 设置面板中的空格和方向键留给表单，不传到播放器的冒泡监听器。
      on(settingsHost,'keydown',event => event.stopPropagation());
      on(settingsHost,'keyup',event => event.stopPropagation());
      // 不让表单事件触发 CC 菜单委托的字幕/线路/模式切换。
      for (const type of ['click','dblclick','input','change','pointerdown','mousedown','touchstart']) on(settingsHost,type,event => event.stopPropagation());
    }
    if (settingsMenu?.speed !== speed || settingsMenu?.bar !== bar) {
      releaseSettingsMenu();
      const style = document.createElement('style');
      style.textContent = '[data-qihang-settings-controls]{opacity:1!important;visibility:visible!important;bottom:0!important;transform:none!important;pointer-events:auto!important;z-index:2147482995!important}';
      (document.head || document.documentElement).append(style);
      settingsMenu = { speed, bar, style };
    }
    // CC 控件从右向左浮动：插在倍速后面，视觉上位于倍速左侧，保留原倍速菜单的位置。
    if (speed.nextElementSibling !== settingsHost) { speed.after(settingsHost); updateSettings(); }
    const videoRect = ctx.video.getBoundingClientRect();
    const surfaceRect = overlayContainer(ctx).getBoundingClientRect();
    const hostRect = settingsHost.getBoundingClientRect();
    const width = Math.min(300,Math.max(100,surfaceRect.width - 24));
    const panelRight = Math.max(surfaceRect.left + 12 + width,Math.min(hostRect.right,surfaceRect.right - 12));
    settingsHost.style.setProperty('--qihang-panel-right',`${hostRect.right - panelRight}px`);
    settingsHost.style.setProperty('--qihang-settings-width',`${width}px`);
    settingsHost.style.setProperty('--qihang-settings-height',`${Math.max(100,videoRect.height - 90)}px`);
    updateSettingsMenu();
    return true;
  }

  function updateSettingsMenu() {
    if (!settingsMenu) return;
    const { bar } = settingsMenu;
    bar?.toggleAttribute('data-qihang-settings-controls',settingsOpen);
  }

  function releaseSettingsMenu() {
    if (!settingsMenu) return;
    const { bar, style } = settingsMenu;
    bar?.removeAttribute('data-qihang-settings-controls');
    style.remove();
    settingsMenu = null;
  }

  function updateSettings() {
    if (!settingsUI) return;
    for (const field of settingsUI.fields) {
      if (field.type === 'checkbox') field.checked = subtitleConfig[field.name];
      else field.value = String(subtitleConfig[field.name]);
    }
    for (const key of ['size','x','bottom','transparency']) settingsUI.shadow.querySelector(`[data-for="${key}"]`).textContent = `${subtitleConfig[key]}${key === 'size' ? '' : '%'}`;
    settingsUI.panel.hidden = !settingsOpen;
    settingsUI.launcher.setAttribute('aria-expanded',String(settingsOpen));
    updateSettingsMenu();
  }

  function saveSubtitles(config) {
    subtitleConfig = validateSubtitles(config);
    try { localStorage.setItem(SUBTITLE_KEY,JSON.stringify(subtitleConfig)); } catch { /* 本次设置仍生效。 */ }
    updateSettings();
    syncSubtitles();
  }

  function toggleSettings(open = !settingsOpen) {
    const ctx = context();
    if (!ctx) return;
    attachMedia(ctx);
    if (!ensureSettings(ctx)) { toast(ctx,'播放器倍速控制栏尚未加载'); return; }
    if (open) finishHold();
    settingsOpen = open;
    updateSettings();
    if (open) settingsUI.shadow.querySelector('.close').focus();
    else {
      if (settingsHost.shadowRoot.activeElement) settingsHost.shadowRoot.activeElement.blur();
    }
  }

  function keydown(event) {
    if (settingsOpen && event.code === 'Escape') { block(event); swallowedKeys.add(event.code); toggleSettings(false); return; }
    if (settingsOpen && settingsHost && event.composedPath().includes(settingsHost) &&
        !(event.code === 'KeyS' && !editable(event))) return;
    if (event.code === 'ArrowRight' && hold?.kind === 'keyboard') { block(event); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || editable(event)) return;
    const ctx = context();
    if (!ctx) return;
    if ((event.code === 'ArrowUp' || event.code === 'ArrowDown') && hold) {
      block(event);
      swallowedKeys.add(event.code);
      if (!event.repeat) adjustHold(event.code === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      block(event); swallowedKeys.add(event.code);
      adjustVolume(ctx,event.code === 'ArrowUp' ? 1 : -1,event.repeat);
      return;
    }
    if (event.code === 'ArrowRight') {
      block(event);
      swallowedKeys.add(event.code);
      if (!event.repeat && !hold) beginHold(ctx, 'keyboard');
      return;
    }
    if (!['BracketLeft','BracketRight','KeyR','KeyF','KeyC','KeyM','KeyS'].includes(event.code)) return;
    block(event);
    swallowedKeys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyF') { void toggleFullscreen(ctx); return; }
    if (event.code === 'KeyC') { toggleSubtitles(ctx); return; }
    if (event.code === 'KeyM') { toggleMute(ctx); return; }
    if (event.code === 'KeyS') { toggleSettings(); return; }
    // 长按时只允许上下键改变临时速度，避免覆盖恢复值。
    if (hold) return;
    let rate = 1;
    if (event.code === 'BracketRight') rate = RATE_STEPS.find(r => r > ctx.video.playbackRate + 0.001) ?? RATE_STEPS.at(-1);
    if (event.code === 'BracketLeft') rate = [...RATE_STEPS].reverse().find(r => r < ctx.video.playbackRate - 0.001) ?? RATE_STEPS[0];
    if (setRate(ctx, rate)) toast(ctx, `播放速度 ${format(rate)}`);
  }

  function keyup(event) {
    if (swallowedKeys.delete(event.code)) block(event);
    if (event.code === 'ArrowRight' && hold?.kind === 'keyboard') {
      block(event);
      finishHold({ shortSeek:true });
    }
  }

  function pointerdown(event) {
    if (settingsOpen && settingsHost && !event.composedPath().includes(settingsHost)) toggleSettings(false);
    if (event.button !== 0 || !event.isPrimary || event.pointerType !== 'mouse' || hold || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const ctx = context();
    if (!ctx) return;
    // 只在画面表面启动，控制栏、进度条、菜单等完全沿用原操作。
    if (event.target !== ctx.video && !event.target.matches?.('.ccH5playerBox')) return;
    beginHold(ctx, 'pointer', { id:event.pointerId, x:event.clientX, y:event.clientY });
  }

  function pointermove(event) {
    if (hold?.kind !== 'pointer' || event.pointerId !== hold.pointer.id) return;
    if (Math.hypot(event.clientX - hold.pointer.x, event.clientY - hold.pointer.y) > 12) finishHold();
  }

  function pointerup(event) {
    if (hold?.kind !== 'pointer' || event.pointerId !== hold.pointer.id) return;
    if (hold.active) block(event);
    finishHold();
  }

  function cancel() { finishHold(); swallowedKeys.clear(); }
  on(window, 'keydown', keydown, true);
  on(window, 'keyup', keyup, true);
  on(window, 'pointerdown', pointerdown, true);
  on(window, 'pointermove', pointermove, true);
  on(window, 'pointerup', pointerup, true);
  on(window, 'pointercancel', pointerup, true);
  on(window, 'click', event => {
    if (suppressClick && performance.now() < suppressClick.until &&
        (event.target === suppressClick.video || event.target.matches?.('.ccH5playerBox'))) {
      block(event); suppressClick = null;
    }
  }, true);
  on(window, 'blur', cancel);
  on(window, 'pagehide', cancel);
  on(window, 'popstate', cancel);
  on(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  on(document, 'focusin', event => { if (editable(event)) cancel(); }, true);
  on(document, 'ended', event => { if (event.target === hold?.video) cancel(); }, true);
  function fullscreenChanged() {
    const ctx = hold || context();
    if (ctx) {
      if (host?.isConnected && !host.hidden) ensureUI(ctx);
      if (media?.video === ctx.video) { ensureSettings(ctx); renderSubtitles(); }
    }
  }
  on(document, 'fullscreenchange', fullscreenChanged);
  on(document, 'webkitfullscreenchange', fullscreenChanged);
  on(window,'resize',renderSubtitles);

  // 启航不刷新页面也会切换章节；在观察回调里只做状态检查。
  const observer = new MutationObserver(() => {
    if (location.href !== route) { route = location.href; cancel(); host?.remove(); detachMedia(); }
    if (hold && (!hold.video.isConnected || context()?.video !== hold.video)) cancel();
    if (media && (!media.video.isConnected || context()?.video !== media.video)) attachMedia(context());
  });
  observer.observe(document, { childList:true, subtree:true });
  const routeTimer = setInterval(() => {
    if (location.href !== route) { route = location.href; cancel(); host?.remove(); detachMedia(); }
    const ctx = context();
    attachMedia(ctx);
    if (media) { ensureSettings(ctx); syncSubtitles(); }
  }, 400);

  window[INSTANCE] = {
    version:'1.5.1',
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      observer.disconnect();
      clearInterval(routeTimer);
      clearTimeout(toastTimer);
      detachMedia();
      cleanups.forEach(remove => remove());
      host?.remove();
      delete window[INSTANCE];
    },
  };
})();
