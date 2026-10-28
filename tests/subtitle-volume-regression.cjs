const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname,'../qihang-player.user.js'),'utf8');
const dom = new JSDOM('<!doctype html><style>'+fs.readFileSync(path.join(__dirname,'fixtures/player-skin.css'),'utf8')+'</style><style id="ccVttStyle">video::cue { color:white }</style><div class="record"><div id="player"><div class="CCH5playerContainer"><div class="ccH5playerBox"><video></video><section><div class="ccH5Setting"><button class="ccH5SettingBtn">设置</button><div class="ccH5SettingArea" style="display:none"><div class="ccH5SettingRow switchUrl"><div>线路</div><div><span data-type="line">线路1</span></div></div></div></div></section></div></div></div></div>',
  { url:'https://www.iqihang.com/ark/record/fixture',runScripts:'outside-only',pretendToBeVisual:true });
const w = dom.window, doc = w.document;
const surface = doc.querySelector('.ccH5playerBox'), container = doc.querySelector('.CCH5playerContainer');
let native=doc.querySelector('.ccH5SettingArea');
const bar=native.closest('section');
let speed=doc.createElement('span');speed.className='ccH5sp';speed.textContent='正常';bar.append(speed);
const rect = () => ({left:0,top:0,right:960,bottom:540,width:960,height:540});
surface.getBoundingClientRect = container.getBoundingClientRect = rect;
class Tracks extends w.EventTarget {
  constructor(){ super(); this.items=[]; }
  [Symbol.iterator](){ return this.items[Symbol.iterator](); }
  add(track){ this.items.push(track); this.dispatchEvent(new w.Event('addtrack')); }
}
class Track extends w.EventTarget {
  constructor(list,video,label,language,mode,cues=[],kind='subtitles') {
    super(); Object.assign(this,{list,video,label,language,kind,cues,_mode:mode});
  }
  get mode(){ return this._mode; }
  set mode(value){ if(this._mode===value)return; this._mode=value; queueMicrotask(()=>this.list.dispatchEvent(new w.Event('change'))); }
  get activeCues(){ return this.mode==='disabled'?null:this.cues.filter(c=>c.startTime<=this.video.currentTime && c.endTime>this.video.currentTime); }
}
const cue = (text,startTime=0,endTime=10) => ({text,startTime,endTime,getCueAsHTML(){const f=doc.createDocumentFragment();const span=doc.createElement('i');span.textContent=text;f.append(span);return f;}});
function setupVideo(video){
  Object.defineProperty(video,'readyState',{value:4});
  Object.defineProperty(video,'videoWidth',{configurable:true,value:1280});
  Object.defineProperty(video,'videoHeight',{configurable:true,value:720});
  video.getBoundingClientRect=rect; video.volume=0.35; video.playbackRate=1.2;
  const tracks=new Tracks(); Object.defineProperty(video,'textTracks',{value:tracks}); return tracks;
}
const video=doc.querySelector('video'), tracks=setupVideo(video);
const english=new Track(tracks,video,'English','en','showing',[cue('第一句字幕'),cue('第二句字幕',10,20)]);
const chinese=new Track(tracks,video,'简体中文','zh-cn','disabled',[cue('中文课程字幕')]);
const watermark=new Track(tracks,video,'字幕','zh_CN','showing',[cue('版权水印')]);
tracks.items=[english,chinese,watermark];
const volumeCalls=[];
doc.querySelector('.record').__vue__={player:{setVolume(value){volumeCalls.push(value);doc.querySelector('video').volume=value;}}};
const results=[];
const check=(name,fn)=>{fn();results.push({name,passed:true});};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const key=(type,code,target=w,extra={})=>target.dispatchEvent(new w.KeyboardEvent(type,{code,bubbles:true,composed:true,cancelable:true,...extra}));
const tap=(code,target=w)=>{key('keydown',code,target);key('keyup',code,target);};
const settings=()=>doc.getElementById('qihang-enhancer-settings').shadowRoot;
const change=(name,value)=>{const field=settings().querySelector(`[name="${name}"]`);if(field.type==='checkbox')field.checked=value;else field.value=String(value);field.dispatchEvent(new w.Event('input',{bubbles:true,composed:true}));};
const subtitles=()=>doc.getElementById('qihang-enhancer-subtitles');
const line=()=>subtitles().shadowRoot.querySelector('.line');

(async()=>{
  try {
    w.eval(source); await sleep(430);
    check('字幕设置与倍速按钮相邻，齿轮内无新增入口，默认使用原字幕',()=>assert.ok(speed.nextElementSibling===doc.getElementById('qihang-enhancer-settings') && !native.contains(doc.getElementById('qihang-enhancer-settings')) && settings().querySelector('.launcher').textContent==='字幕设置' && english.mode==='showing' && !subtitles()));
    tap('ArrowUp');
    check('上键增加 5% 并调用原播放器音量接口',()=>assert.ok(video.volume===0.4 && volumeCalls.at(-1)===0.4));
    key('keydown','ArrowUp',w,{repeat:true});key('keyup','ArrowUp');
    check('连续按键事件限速，避免瞬间跳到最大音量',()=>assert.equal(video.volume,0.4));
    await sleep(90); key('keydown','ArrowUp',w,{repeat:true});key('keyup','ArrowUp');
    check('长按上键仍可持续增加音量',()=>assert.equal(video.volume,0.45));
    video.volume=0.98;tap('ArrowUp');
    check('音量最大限制 100%',()=>assert.equal(video.volume,1));
    video.volume=0.02;tap('ArrowDown');
    check('音量最小限制 0%，同时静音',()=>assert.ok(video.volume===0 && video.muted));
    tap('ArrowUp');
    check('增加音量会解除静音',()=>assert.ok(video.volume===0.05 && !video.muted));
    key('keydown','ArrowRight');await sleep(310);tap('ArrowUp');
    check('长按右键时上下键仍只调整倍速',()=>assert.ok(video.playbackRate===2.5 && video.volume===0.05));
    key('keyup','ArrowRight');
    check('松开加速恢复速度而不改变音量',()=>assert.equal(video.playbackRate,1.2));
    tap('KeyS');
    check('S 打开设置面板',()=>assert.equal(settings().querySelector('.settings').hidden,false));
    check('S 展开字幕面板并固定控制栏，不打开齿轮菜单',()=>assert.ok(w.getComputedStyle(native).display==='none' && bar.hasAttribute('data-qihang-settings-controls')));
    native.style.display='none';native.closest('section').className='ccH5FadeOut';
    check('原控制栏自动隐藏不会关闭正在调整的表单',()=>assert.ok(!settings().querySelector('.settings').hidden && w.getComputedStyle(bar).opacity==='1'));
    let delegated=0;const delegate=()=>delegated++;bar.addEventListener('click',delegate);
    settings().querySelector('.reset').click();
    check('自定义表单点击不传到原菜单委托事件',()=>assert.equal(delegated,0));
    native.querySelector('[data-type="line"]').click();
    check('原菜单线路选项仍能接收点击',()=>assert.equal(delegated,1));
    bar.removeEventListener('click',delegate);
    const input=settings().querySelector('[name="size"]');
    tap('ArrowUp',input);
    check('设置滑块上的方向键不调整音量',()=>assert.equal(video.volume,0.05));
    let nativeSpace=0;const originalSpace=e=>{if(e.code==='Space')nativeSpace++;};w.addEventListener('keyup',originalSpace);
    tap('Space',input);
    check('设置面板内空格不传播到原播放器',()=>assert.equal(nativeSpace,0));
    w.removeEventListener('keyup',originalSpace);
    change('size',32); await sleep(0);
    check('修改字号启用独立显示层并隐藏原绘制',()=>assert.ok(english.mode==='hidden' && !subtitles().hidden && line().textContent==='第一句字幕'));
    check('原始字幕文字、时间和水印轨道完全保留',()=>assert.ok(english.cues[0].text==='第一句字幕' && english.cues[0].endTime===10 && watermark.mode==='showing' && !line().textContent.includes('版权水印')));
    change('color','#abcdef');change('weight',700);change('font','song');change('x',35);change('bottom',25);change('outline',false);
    check('颜色、粗细、字体、位置和阴影设置立即生效',()=>assert.ok(line().style.color==='rgb(171, 205, 239)' && line().style.fontWeight==='700' && line().style.fontFamily.includes('SimSun') && line().style.left==='35%' && line().style.bottom==='25%' && line().style.textShadow==='none'));
    check('字号按画面比例缩放',()=>assert.equal(line().style.fontSize,'24px'));
    change('transparency',40);
    check('透明度 40% 即时显示为 60% 不透明，文本内容与轨道保持',()=>assert.ok(line().style.opacity==='0.6' && line().textContent==='第一句字幕' && english.mode==='hidden' && watermark.mode==='showing'));
    change('transparency',100);
    check('100% 完全透明，不关闭或删除字幕轨道',()=>assert.ok(line().style.opacity==='0' && english.mode==='hidden' && line().textContent==='第一句字幕'));
    change('transparency',0);
    check('0% 恢复完全不透明',()=>assert.equal(line().style.opacity,'1'));
    change('transparency',40);
    check('不改动 CC 原生字幕或水印样式',()=>assert.equal(doc.getElementById('ccVttStyle').textContent,'video::cue { color:white }'));
    video.currentTime=11;video.dispatchEvent(new w.Event('seeked'));
    check('跳转进度立即显示当前字幕',()=>assert.equal(line().textContent,'第二句字幕'));
    video.currentTime=30;video.dispatchEvent(new w.Event('timeupdate'));
    check('没有当前字幕时隐藏自定义显示层',()=>assert.ok(subtitles().hidden));
    video.currentTime=1;video.dispatchEvent(new w.Event('seeked'));
    tap('KeyS',settings().querySelector('.close'));
    check('设置面板中再按 S 可以关闭',()=>assert.ok(settings().querySelector('.settings').hidden));
    check('关闭设置恢复原菜单隐藏及控制栏自动隐藏',()=>assert.ok(w.getComputedStyle(native).display==='none' && !native.closest('section').hasAttribute('data-qihang-settings-controls')));
    settings().querySelector('.launcher').click();
    check('倍速旁的字幕设置按钮展开面板',()=>assert.ok(!settings().querySelector('.settings').hidden));
    surface.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,composed:true}));
    check('点击菜单外画面收起设置',()=>assert.ok(settings().querySelector('.settings').hidden && !native.hasAttribute('data-qihang-settings-open')));
    tap('KeyC');
    check('C 可以关闭被自定义层接管的字幕',()=>assert.ok(english.mode==='disabled' && subtitles().hidden));
    tap('KeyC');await sleep(0);
    check('C 再次开启并恢复所选语言和样式',()=>assert.ok(english.mode==='hidden' && !subtitles().hidden && line().textContent==='第一句字幕' && line().style.left==='35%'));
    const vtt=doc.createElement('div');vtt.className='ccH5SettingRow switchVtt';
    vtt.innerHTML='<div><em class="checked"></em>字幕</div><div><span data-type="vtt">中文</span></div>';
    native.append(vtt);
    check('接入后仍保留原字幕语言按钮的 64px 宽度',()=>assert.equal(w.getComputedStyle(vtt.querySelector('span')).width,'64px'));
    const nativeToggle=native.querySelector('em');
    nativeToggle.onclick=()=>{nativeToggle.classList.toggle('checked');if(nativeToggle.classList.contains('checked'))setTimeout(()=>{chinese.mode='showing';},100);else{english.mode='disabled';chinese.mode='disabled';}};
    vtt.querySelector('span').onclick=()=>{english.mode='disabled';chinese.mode='disabled';setTimeout(()=>{chinese.mode='showing';},100);};
    vtt.querySelector('span').click();await sleep(120);
    check('原播放器切换字幕语言后继续接管新轨道',()=>assert.ok(english.mode==='disabled' && chinese.mode==='hidden' && line().textContent==='中文课程字幕'));
    tap('KeyC');await sleep(0);
    check('原菜单关闭字幕时自定义层同步隐藏',()=>assert.ok(subtitles().hidden && chinese.mode==='disabled'));
    tap('KeyC');await sleep(120);
    check('原菜单异步开启字幕后自定义层自动恢复',()=>assert.ok(chinese.mode==='hidden' && !subtitles().hidden));
    Object.defineProperty(doc,'fullscreenElement',{configurable:true,value:surface});doc.dispatchEvent(new w.Event('fullscreenchange'));
    check('播放器容器全屏时字幕设置与字幕均进入顶层',()=>assert.ok(surface.contains(subtitles()) && bar.contains(doc.getElementById('qihang-enhancer-settings')) && line().style.opacity==='0.6'));
    tap('KeyS');tap('Escape');
    check('Escape 先关闭字幕面板',()=>assert.ok(settings().querySelector('.settings').hidden));
    Object.defineProperty(doc,'fullscreenElement',{configurable:true,value:null});doc.dispatchEvent(new w.Event('fullscreenchange'));
    check('退出全屏后设置仍在倍速旁',()=>assert.ok(subtitles().parentElement===surface && speed.nextElementSibling===doc.getElementById('qihang-enhancer-settings')));
    video.style.objectFit='contain';Object.defineProperty(video,'videoWidth',{configurable:true,value:960});
    w.dispatchEvent(new w.Event('resize'));
    check('contain 黑边画面按实际视频内容区域定位',()=>assert.ok(subtitles().style.width==='720px' && subtitles().style.left==='120px'));
    const saved=JSON.parse(w.localStorage.getItem('qihang-enhancer:subtitle:v1'));
    check('保存所有字幕外观、位置及透明度设置',()=>assert.ok(saved.enabled && saved.size===32 && saved.font==='song' && saved.color==='#abcdef' && saved.bottom===25 && saved.transparency===40));
    w.__qihangPlayerEnhancer.destroy();
    check('卸载恢复原生字幕显示并移除设置层',()=>assert.ok(chinese.mode==='showing' && watermark.mode==='showing' && !subtitles() && !doc.getElementById('qihang-enhancer-settings')));
    check('卸载移除控制栏标记与新增样式，保留原字幕菜单',()=>assert.ok(!doc.querySelector('[data-qihang-settings-controls]') && ![...doc.querySelectorAll('style')].some(s=>s.textContent.includes('data-qihang-settings-controls')) && native.querySelector('.switchVtt')));
    w.eval(source);await sleep(430);
    check('重新加载恢复记住的字幕设置及透明度',()=>assert.ok(chinese.mode==='hidden' && line().style.opacity==='0.6' && line().style.left==='35%' && settings().querySelector('[name="font"]').value==='song'));
    const replaced=doc.createElement('span');replaced.className='ccH5sp';
    tap('KeyS');speed.replaceWith(replaced);await sleep(430);
    check('倍速控件重建后自动迁移入口且只保留一个实例',()=>assert.ok(replaced.nextElementSibling===doc.getElementById('qihang-enhancer-settings') && doc.querySelectorAll('#qihang-enhancer-settings').length===1));
    speed=replaced;tap('Escape');
    speed.remove();await sleep(430);tap('KeyS');
    check('倍速控件暂时移除时等待控制栏，不回退到齿轮菜单',()=>assert.ok(!doc.getElementById('qihang-enhancer-settings') && doc.getElementById('qihang-enhancer-overlay').shadowRoot.querySelector('.toast').textContent==='播放器倍速控制栏尚未加载'));
    bar.append(speed);await sleep(430);
    check('倍速控件重新出现后自动接入并保持收起',()=>assert.ok(speed.nextElementSibling===doc.getElementById('qihang-enhancer-settings') && settings().querySelector('.settings').hidden));
    vtt.remove(); // 新章节的模拟播放器不再提供旧章节的语言开关。
    const nextVideo=doc.createElement('video');const nextTracks=setupVideo(nextVideo);
    const nextSubtitle=new Track(nextTracks,nextVideo,'新章节','zh-cn','showing',[cue('下一节课字幕')]);nextTracks.items=[nextSubtitle];
    video.remove();surface.append(nextVideo);w.history.pushState({},'', '/ark/record/next');await sleep(450);
    check('切换章节绑定新视频并恢复原视频字幕状态',()=>assert.ok(chinese.mode==='showing' && nextSubtitle.mode==='hidden' && line().textContent==='下一节课字幕' && line().style.fontWeight==='700'));
    tap('KeyS');settings().querySelector('.reset').click();await sleep(0);
    check('恢复默认撤销自定义并重置透明度',()=>assert.ok(nextSubtitle.mode==='showing' && subtitles().hidden && !settings().querySelector('[name="enabled"]').checked && settings().querySelector('[name="transparency"]').value==='0'));
    change('enabled',true);await sleep(0);tap('Escape');tap('KeyC');
    w.__qihangPlayerEnhancer.destroy();
    check('卸载不会重新开启用户关闭的字幕',()=>assert.equal(nextSubtitle.mode,'disabled'));
    w.localStorage.setItem('qihang-enhancer:subtitle:v1',JSON.stringify({enabled:true,size:1e9,x:-200,bottom:500,transparency:200,color:'red;position:fixed',font:'unknown',weight:999,outline:'bad'}));
    nextSubtitle.mode='showing';w.eval(source);await sleep(430);
    check('记忆设置校验范围并拒绝注入或未知字体',()=>assert.ok(settings().querySelector('[name="size"]').value==='64' && settings().querySelector('[name="x"]').value==='10' && settings().querySelector('[name="bottom"]').value==='90' && settings().querySelector('[name="color"]').value==='#ffffff' && settings().querySelector('[name="font"]').value==='system'));
    check('记忆中的越界透明度限制为 100%',()=>assert.equal(settings().querySelector('[name="transparency"]').value,'100'));
    w.__qihangPlayerEnhancer.destroy();
    w.localStorage.setItem('qihang-enhancer:subtitle:v1',JSON.stringify({enabled:true,size:28,color:'#abcdef',font:'song'}));
    w.eval(source);await sleep(430);
    check('旧版设置缺少透明度时默认不透明并保留原设置',()=>assert.ok(line().style.opacity==='1' && settings().querySelector('[name="transparency"]').value==='0' && settings().querySelector('[name="size"]').value==='28' && settings().querySelector('[name="color"]').value==='#abcdef'));
  } catch(error) {
    // 继续由下面统一报告失败和清理。
    throw error;
  }
})().then(()=>{},error=>{console.error(error);process.exitCode=1;}).finally(()=>{w.__qihangPlayerEnhancer?.destroy();w.close();console.log(JSON.stringify({version:require('../package.json').version,type:'DOM regression; media/TextTrack/fullscreen simulated',results},null,2));});
