const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>启航提示条预览</title>
<style>
body{margin:0;background:#15171c;color:#ddd;font:15px system-ui,"Microsoft YaHei",sans-serif;padding:32px}button{margin-right:12px;background:#343a48;border:0;border-radius:7px;color:white;padding:10px 18px;cursor:pointer}.record{width:min(960px,100%);margin:24px auto}.CCH5playerContainer{height:540px;position:relative}.ccH5playerBox{width:100%;height:100%;position:relative;background:#25292d;overflow:hidden}.ccH5playerBox:fullscreen{width:100vw;height:100vh}.ccH5playerBox video{width:100%;height:100%;display:block;object-fit:contain}.toolbar{width:min(960px,100%);margin:auto}h1{font-size:19px}.ccH5spul{display:none}
.ccH5playerBox section{height:40px;width:100%;position:absolute;left:0;bottom:0;z-index:3;background:#0008}.ccH5Setting{float:right}.ccH5SettingBtn{margin:0 12px;padding:7px 10px;background:transparent}.ccH5SettingArea{position:absolute;bottom:35px;right:8px;background:rgba(30,30,30,.85);box-shadow:0 0 8px #0008;border-radius:4px;border:1px solid #6663;z-index:100000;display:none;padding:16px 24px 0;color:#fffa}.ccH5SettingRow{margin-bottom:16px;color:#fffa}.ccH5SettingRow span{display:inline-block;width:100px;height:24px;line-height:24px;background:#ffffff1a;border-radius:4px;margin-top:8px;cursor:pointer;text-align:center}.ccH5SettingRow:last-child span{width:64px}.ccH5FadeOut{opacity:0}
</style><div class="toolbar"><h1>音量与字幕设置预览 · 自制模拟画面</h1><button id="demo">演示 2.5 倍</button><button id="end">结束演示</button><button id="full">进入全屏</button><button id="settings">展示字幕设置</button><p id="status"></p></div>
<div class="record"><div id="player"><div class="CCH5playerContainer"><div class="ccH5playerBox"><video autoplay muted playsinline></video></div><ul class="ccH5spul">${[0.8,1,1.2,1.5,2,2.5,3].map(r=>'<li data-sp="'+r+'">'+r+'</li>').join('')}</ul></div></div></div>
<script>
const video=document.querySelector('video');const box=document.querySelector('.ccH5playerBox');
const controls=document.createElement('section');controls.innerHTML='<div class="ccH5Setting"><button class="ccH5SettingBtn" aria-label="播放器设置">⚙</button><div class="ccH5SettingArea"><div class="ccH5SettingRow switchUrl"><div>线路</div><div><span data-type="line">线路1</span></div></div><div class="ccH5SettingRow switchVtt"><div><em class="checked">✓</em> 字幕</div><div><span data-type="vtt">中文</span></div></div></div></div>';box.append(controls);
const speed=document.createElement('span');speed.className='ccH5sp';speed.textContent='正常';speed.style.cssText='float:right;margin:8px 10px 0 0;width:60px;height:24px;line-height:24px;border-radius:100px;background:#3338;text-align:center;font-size:12px;cursor:pointer';controls.append(speed);
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const paint=canvas.getContext('2d');
function draw(){paint.fillStyle='#272c30';paint.fillRect(0,0,1280,720);paint.fillStyle='#e8eee9';paint.fillRect(60,70,1160,580);paint.fillStyle='#53655e';paint.font='36px sans-serif';paint.textAlign='center';paint.fillText('启航播放器增强 · 功能预览',640,220);paint.font='24px sans-serif';paint.fillText('↑ ↓ 音量调节     S 字幕设置     C 字幕开关',640,300);paint.fillStyle='#9fac9f';paint.fillRect(250,380,780,2);requestAnimationFrame(draw)}draw();video.srcObject=canvas.captureStream(5);video.play().catch(()=>{});
const subtitle=video.addTextTrack('subtitles','简体中文','zh-cn');subtitle.addCue(new VTTCue(0,36000,'这是一条用于预览的独立字幕，可调整位置和外观。'));subtitle.mode='showing';video.volume=0.35;
const nativeMenu=document.querySelector('.ccH5SettingArea'),gear=document.querySelector('.ccH5Setting');gear.addEventListener('mouseover',()=>nativeMenu.style.display='block');gear.addEventListener('mouseout',()=>nativeMenu.style.display='none');
nativeMenu.querySelector('em').onclick=e=>{e.target.classList.toggle('checked');subtitle.mode=e.target.classList.contains('checked')?'showing':'disabled'};
const watermark=video.addTextTrack('subtitles','字幕','zh_CN');const watermarkCue=new VTTCue(0,36000,'模拟水印');watermarkCue.line=1;watermarkCue.position=85;watermark.addCue(watermarkCue);watermark.mode='showing';
const updateStatus=()=>{document.querySelector('#status').textContent='静音：'+video.muted+' · 音量：'+video.volume+' · 字幕：'+subtitle.mode};
video.addEventListener('volumechange',updateStatus);video.textTracks.addEventListener('change',updateStatus);updateStatus();
document.querySelector('.record').__vue__={player:{isFullScreen:()=>!!document.fullscreenElement,fullScreen:()=>box.requestFullscreen(),normalScreen:()=>document.exitFullscreen(),jumpToTime:t=>{video.currentTime=t},setVolume:v=>{video.volume=v}}};
for(const li of document.querySelectorAll('[data-sp]'))li.onclick=()=>{video.playbackRate=Number(li.dataset.sp)};
const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,key:code,bubbles:true,cancelable:true}));
document.querySelector('#demo').onclick=()=>{key('keyup','ArrowRight');key('keydown','ArrowRight');setTimeout(()=>{for(const code of ['ArrowDown','ArrowDown','ArrowDown','ArrowUp','ArrowUp']){key('keydown',code);key('keyup',code)}},350)};
document.querySelector('#end').onclick=()=>key('keyup','ArrowRight');document.querySelector('#full').onclick=()=>box.requestFullscreen();
document.querySelector('#settings').onclick=()=>{key('keydown','KeyS');key('keyup','KeyS')};
</script><script src="/qihang-player.user.js"></script></html>`;
http.createServer((req,res)=> {
  if(req.url==='/qihang-player.user.js') {res.setHeader('Content-Type','application/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'../qihang-player.user.js')));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
}).listen(18765,'127.0.0.1',()=>console.log('Preview available at http://127.0.0.1:18765/ark/record/preview'));
