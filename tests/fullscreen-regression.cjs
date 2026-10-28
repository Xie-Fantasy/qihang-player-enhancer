const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// 模拟 CC 已核实的 DOM 与媒体状态，验证全屏顶层中的归属及键盘状态恢复。
// jsdom 不渲染画面，因此不将这些结果标为真实浏览器视觉验收。
const dom = new JSDOM(`<!doctype html><body><div class="record"><div id="player">
  <div class="CCH5playerContainer"><div class="ccH5playerBox"><video></video></div>
  <ul class="ccH5spul">${[0.8,1,1.2,1.5,2,2.5,3].map(r=>`<li data-sp="${r}">${r}</li>`).join('')}</ul></div>
</div></div></body>`, { url:'https://www.iqihang.com/ark/record/fixture', runScripts:'outside-only', pretendToBeVisual:true });
const { window } = dom;
const doc = window.document;
const video = doc.querySelector('video');
const surface = doc.querySelector('.ccH5playerBox');
const container = doc.querySelector('.CCH5playerContainer');
Object.defineProperty(video, 'readyState', { value:4 });
let tracks = [];
Object.defineProperty(video, 'textTracks', { get:()=>tracks });
video.getBoundingClientRect = () => ({ width:960, height:540, x:0, y:0 });
video.playbackRate = 1.2;
for (const menu of doc.querySelectorAll('[data-sp]')) menu.addEventListener('click',()=> { video.playbackRate=Number(menu.dataset.sp); });
const results = [];
const check = (name, fn) => { fn(); results.push({name,passed:true}); };
const key = (type, code) => window.dispatchEvent(new window.KeyboardEvent(type,{code,key:code,bubbles:true,cancelable:true}));
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const fullscreen = (node, legacy=false) => {
  Object.defineProperty(doc,'fullscreenElement',{configurable:true,value:legacy?null:node});
  Object.defineProperty(doc,'webkitFullscreenElement',{configurable:true,value:legacy?node:null});
  doc.dispatchEvent(new window.Event(legacy?'webkitfullscreenchange':'fullscreenchange'));
};

(async () => {
  try {
    window.eval(fs.readFileSync(path.join(__dirname,'../qihang-player.user.js'),'utf8'));
    key('keydown','ArrowRight'); await sleep(330);
    const host = doc.getElementById('qihang-enhancer-overlay');
    check('普通窗口挂载到真正的画面容器',()=>assert.equal(host.parentElement,surface));
    check('长按默认 2 倍',()=>assert.equal(video.playbackRate,2));
    check('删除调整和恢复提示',()=>assert.equal(/调整|松开恢复/.test(host.shadowRoot.textContent),false));
    fullscreen(surface);
    check('标准全屏的顶层包含提示条',()=>assert.ok(doc.fullscreenElement.contains(host) && !host.hidden));
    key('keydown','ArrowUp'); key('keyup','ArrowUp');
    check('上键可选择 2.5 倍',()=>assert.equal(video.playbackRate,2.5));
    check('显示当前 2.5 倍和相邻档位',()=>assert.equal(host.shadowRoot.querySelector('.current').textContent,'2.5×'));
    key('keydown','ArrowUp'); key('keyup','ArrowUp');
    check('上键可选择 3 倍',()=>assert.equal(video.playbackRate,3));
    fullscreen(container);
    check('长按中切换全屏目标会重新挂载',()=>assert.equal(host.parentElement,container));
    fullscreen(null);
    check('退出全屏仍保留提示并回到画面容器',()=>assert.equal(host.parentElement,surface));
    key('keydown','ArrowDown'); key('keyup','ArrowDown');
    key('keydown','ArrowDown'); key('keyup','ArrowDown');
    key('keydown','ArrowDown'); key('keyup','ArrowDown');
    check('下键可选择 1.5 倍',()=>assert.equal(video.playbackRate,1.5));
    key('keyup','ArrowRight');
    check('松开恢复 1.2 倍并隐藏提示',()=>assert.ok(video.playbackRate===1.2 && host.hidden));
    fullscreen(surface,true);
    key('keydown','ArrowRight'); await sleep(330);
    check('旧版 WebKit 全屏也显示提示',()=>assert.ok(doc.webkitFullscreenElement.contains(host) && !host.hidden));
    check('下一次长按记住 1.5 倍',()=>assert.equal(video.playbackRate,1.5));
    window.dispatchEvent(new window.Event('blur'));
    check('全屏中失焦仍恢复普通倍速',()=>assert.ok(video.playbackRate===1.2 && host.hidden));
    key('keyup','ArrowRight');
    fullscreen(null,true);
    check('隐藏的提示不会被全屏切换重新显示',()=>assert.ok(host.hidden));
    const tap = code => { key('keydown',code); key('keyup',code); };
    video.volume=0.35;
    tap('KeyM');
    check('M 静音保留原音量',()=>assert.ok(video.muted && video.volume===0.35));
    window.dispatchEvent(new window.KeyboardEvent('keydown',{code:'KeyM',repeat:true,bubbles:true,cancelable:true}));
    check('按键重复不反复切换静音',()=>assert.ok(video.muted));
    tap('KeyM');
    check('再次 M 恢复声音和原音量',()=>assert.ok(!video.muted && video.volume===0.35));
    video.volume=0;
    tap('KeyM');
    check('播放器音量为零时 M 可恢复声音',()=>assert.ok(!video.muted && video.volume===0.35));
    tap('KeyC');
    check('没有字幕时明确提示',()=>assert.equal(host.shadowRoot.querySelector('.toast').textContent,'当前视频没有可切换字幕'));
    const watermark={kind:'subtitles',label:'字幕',language:'zh_CN',mode:'showing'};
    const chinese={kind:'subtitles',label:'简体中文',language:'zh-cn',mode:'disabled'};
    const english={kind:'captions',label:'English',language:'en',mode:'showing'};
    const metadata={kind:'metadata',mode:'hidden'};
    tracks=[watermark,chinese,english,metadata];
    tap('KeyC');
    check('关闭字幕不影响 CC 水印和元数据',()=>assert.ok(english.mode==='disabled' && watermark.mode==='showing' && metadata.mode==='hidden'));
    tap('KeyC');
    check('重新开启恢复所选语言',()=>assert.ok(english.mode==='showing' && chinese.mode==='disabled'));
    const setting=doc.createElement('div');
    setting.className='ccH5SettingArea';
    setting.innerHTML='<div class="switchVtt"><span data-type="vtt" class="active">English</span></div><em class="checked"></em>';
    container.append(setting);
    const nativeToggle=setting.querySelector('em');
    let nativeClicks=0;
    nativeToggle.addEventListener('click',()=>{ nativeClicks++; nativeToggle.classList.toggle('checked'); english.mode=nativeToggle.classList.contains('checked')?'showing':'disabled'; });
    tap('KeyC'); tap('KeyC');
    check('复用 CC 开关并同步原菜单状态',()=>assert.ok(nativeClicks===2 && nativeToggle.classList.contains('checked') && english.mode==='showing'));
    key('keydown','ArrowRight'); await sleep(330);
    tap('KeyM'); tap('KeyC');
    check('加速中允许静音和字幕操作，提示条保持显示',()=>assert.ok(video.muted && english.mode==='disabled' && !host.hidden && !host.shadowRoot.querySelector('.panel').hidden && video.playbackRate===1.5));
    key('keyup','ArrowRight');
    check('松开恢复原速度，不覆盖静音与字幕状态',()=>assert.ok(video.playbackRate===1.2 && video.muted && english.mode==='disabled'));
    const input=doc.createElement('input'); doc.body.append(input);
    input.dispatchEvent(new window.KeyboardEvent('keydown',{code:'KeyM',bubbles:true,cancelable:true}));
    window.dispatchEvent(new window.KeyboardEvent('keydown',{code:'KeyM',ctrlKey:true,bubbles:true,cancelable:true}));
    check('输入框与组合键不触发新功能',()=>assert.ok(video.muted));
    check('空格仍留给原播放器',()=>assert.equal(key('keydown','Space'),true));
    window.__qihangPlayerEnhancer.destroy();
    check('卸载清理提示条及监听',()=>assert.equal(doc.getElementById('qihang-enhancer-overlay'),null));
    console.log(JSON.stringify({version:require('../package.json').version,type:'DOM regression; fullscreen APIs simulated',results},null,2));
  } catch(error) {
    console.error(error);
    process.exitCode=1;
  } finally { window.close(); }
})();
