/* CUPHED: Mug Mayhem — original 1930s-cartoon boss battler.
   Phone/Tablet + desktop. Canvas 2D, procedural audio, no assets. */
(() => {
'use strict';
const W = 960, H = 540, GROUND = 468;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* ---------- helpers ---------- */
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const rnd = (a,b)=>a+Math.random()*(b-a);
const dist2 = (a,b,c,d)=>{const x=a-c,y=b-d;return x*x+y*y;};
const $ = id=>document.getElementById(id);

/* ---------- audio (procedural WebAudio) ---------- */
let AC=null, muted=false;
function audio(){ if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } if(AC&&AC.state==='suspended')AC.resume(); return AC; }
function tone(f,dur,type='square',vol=.12,slide=0){
  if(muted) return; const ac=audio(); if(!ac) return;
  const o=ac.createOscillator(), g=ac.createGain();
  o.type=type; o.frequency.setValueAtTime(f,ac.currentTime);
  if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,f+slide),ac.currentTime+dur);
  g.gain.setValueAtTime(vol,ac.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+dur);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime+dur);
}
function noiseBurst(dur=.2,vol=.15){
  if(muted) return; const ac=audio(); if(!ac) return;
  const n=ac.sampleRate*dur, buf=ac.createBuffer(1,n,ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
  const s=ac.createBufferSource(), g=ac.createGain(), f=ac.createBiquadFilter();
  f.type='lowpass'; f.frequency.value=1200; s.buffer=buf; g.gain.value=vol;
  s.connect(f).connect(g).connect(ac.destination); s.start();
}
const sfx={
  shoot(){tone(720,.09,'square',.07,-300);},
  jump(){tone(300,.16,'square',.1,350);},
  dash(){noiseBurst(.18,.12);tone(200,.15,'sawtooth',.07,300);},
  hit(){noiseBurst(.25,.2);tone(140,.3,'sawtooth',.14,-60);},
  bossHit(){tone(220,.07,'square',.08,80);},
  parry(){tone(660,.12,'sine',.16,660);setTimeout(()=>tone(990,.18,'sine',.16,0),90);},
  super(){tone(120,.6,'sawtooth',.16,700);noiseBurst(.5,.14);},
  mini(){tone(500,.08,'square',.07,-150);},
  win(){[523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,.25,'triangle',.16),i*140));},
  lose(){[400,320,240,150].forEach((f,i)=>setTimeout(()=>tone(f,.3,'sawtooth',.12),i*170));},
  click(){tone(600,.06,'square',.08);},
};

/* ---------- input ---------- */
const keys={};
const touch={left:false,right:false,jump:false,shoot:false,dash:false,parry:false,super:false};
addEventListener('keydown',e=>{
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  keys[e.code]=true;
  if(e.code==='Space') touch.jump=true;
  if(e.code==='KeyJ') touch.shoot=true;
  if(e.code==='KeyK') touch.dash=true;
  if(e.code==='KeyL') touch.parry=true;
  if(e.code==='KeyU') touch.super=true;
  if(e.code==='KeyP'||e.code==='Escape') togglePause();
  if(e.code==='Enter'&&state!=='play') startGame();
  audio();
});
addEventListener('keyup',e=>{
  keys[e.code]=false;
  if(e.code==='Space') touch.jump=false;
  if(e.code==='KeyJ') touch.shoot=false;
  if(e.code==='KeyK') touch.dash=false;
  if(e.code==='KeyL') touch.parry=false;
  if(e.code==='KeyU') touch.super=false;
});
function inp(){
  return {
    left: !!(keys.ArrowLeft||keys.KeyA||touch.left),
    right: !!(keys.ArrowRight||keys.KeyD||touch.right),
    jump: !!(keys.ArrowUp||keys.KeyW||keys.Space||touch.jump),
    shoot: !!(keys.KeyJ||keys.KeyZ||touch.shoot),
    dash: !!(keys.KeyK||keys.KeyX||touch.dash),
    parry: !!(keys.KeyL||keys.KeyC||touch.parry),
    super: !!(keys.KeyU||keys.KeyV||touch.super),
  };
}
// touch buttons (multi-touch safe via pointer events)
function bindHold(id,prop){
  const el=$(id); if(!el) return;
  const on=e=>{e.preventDefault();touch[prop]=true;el.classList.add('held');audio();try{el.setPointerCapture(e.pointerId);}catch(_){}};
  const off=e=>{e.preventDefault();touch[prop]=false;el.classList.remove('held');};
  el.addEventListener('pointerdown',on);
  el.addEventListener('pointerup',off);
  el.addEventListener('pointercancel',off);
  el.addEventListener('pointerleave',e=>{if(touch[prop]){touch[prop]=false;el.classList.remove('held');}});
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
bindHold('dpadL','left'); bindHold('dpadR','right');
bindHold('btnJump','jump'); bindHold('btnShoot','shoot');
bindHold('btnDash','dash'); bindHold('btnParry','parry'); bindHold('btnSuper','super');
canvas.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
canvas.addEventListener('pointerdown',()=>audio());

/* ---------- game state ---------- */
let state='menu'; // menu | play | pause | over | win | help
let player, boss, shots, eshots, minis, parts, floats;
let score, gameTime, shake, slowmo, bgT, best;
try{ best=JSON.parse(localStorage.getItem('cuphed-best')||'{"score":0,"win":false}'); }
catch(e){ best={score:0,win:false}; }

function reset(){
  player={x:150,y:GROUND-60,vx:0,vy:0,w:44,h:58,hp:5,maxHp:5,face:1,ground:true,
    coyote:0,jbuf:0,dashT:0,dashCD:0,inv:0,shootCD:0,parryCD:0,parryFx:0,super:0,
    run:0,shootHeld:0,dead:0};
  boss={x:760,y:200,vx:0,vy:0,w:150,h:130,hp:140,maxHp:140,phase:1,t:0,atkT:1.6,
    atk:'spit',flash:0,chargeDx:0,yBase:200,spitN:0};
  shots=[]; eshots=[]; minis=[]; parts=[]; floats=[];
  score=0; gameTime=0; shake=0; slowmo=0; bgT=0;
}
reset();

function startGame(){ sfx.click(); audio(); reset(); state='play'; show(null); }
function togglePause(){
  if(state==='play'){state='pause';show('pauseOv');}
  else if(state==='pause'){state='play';show(null);}
}
function gameOver(win){
  state=win?'win':'over';
  if(win){sfx.win();}else{sfx.lose();}
  const sc=Math.round(score+Math.max(0,300-gameTime)*5+(win?2000:0)+player.hp*250);
  score=sc;
  if(sc>(best.score||0)){best.score=sc;best.win=best.win||win;try{localStorage.setItem('cuphed-best',JSON.stringify(best));}catch(e){}}
  $('finalStats').innerHTML=
    `<div class="stat"><span>SCORE</span><span>${sc}</span></div>`+
    `<div class="stat"><span>TIME</span><span>${gameTime.toFixed(1)}s</span></div>`+
    `<div class="stat"><span>BOSS HP LEFT</span><span>${Math.max(0,Math.round(boss.hp))}</span></div>`+
    `<div class="stat"><span>BEST</span><span>${best.score}</span></div>`;
  $('winStats').innerHTML=$('finalStats').innerHTML;
  show(win?'winOv':'overOv');
}
function show(id){
  ['menuOv','overOv','winOv','pauseOv','helpOv'].forEach(o=>$(o).classList.add('hidden'));
  if(id) $(id).classList.remove('hidden');
  else if(state==='menu') $('menuOv').classList.remove('hidden');
  else if(state==='help') $('helpOv').classList.remove('hidden');
}
$('startBtn').onclick=startGame;
$('retryBtn').onclick=startGame;
$('retryBtn2').onclick=startGame;
$('resumeBtn').onclick=togglePause;
$('quitBtn').onclick=()=>{state='menu';show('menuOv');};
$('howBtn').onclick=()=>{sfx.click();state='help';show('helpOv');};
$('howBtn2').onclick=()=>{sfx.click();state='help';show('helpOv');};
$('backBtn').onclick=()=>{sfx.click();state='menu';show('menuOv');};
$('pauseBtn').onclick=()=>{sfx.click();if(state==='play')togglePause();};
$('muteBtn').onclick=e=>{muted=!muted;e.target.textContent=muted?'🔇 Muted':'🔊 Sound';e.target.classList.toggle('on',!muted);};
$('touchBtn').onclick=e=>{const t=$('touch');t.classList.toggle('auto-hide');sfx.click();};
$('showTouch').onclick=()=>{const t=$('touch');t.classList.remove('auto-hide');};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')togglePause();});

/* ---------- combat helpers ---------- */
function hurtPlayer(n,srcx){
  if(player.inv>0||player.dashT>0||state!=='play')return;
  player.hp-=n; player.inv=1.2; shake=Math.min(14,shake+7); sfx.hit();
  burst(player.x,player.y+20,14,'#ff5b5b');
  player.vx=(player.x<srcx?-1:1)*260; player.vy=-260; player.ground=false;
  addFloat(player.x,player.y-20,'OUCH!','#ff5b5b');
  if(player.hp<=0){player.hp=0;player.dead=.9;burst(player.x,player.y,40,'#fff');setTimeout(()=>{if(state==='play')gameOver(false);},900);}
}
function hurtBoss(n,x,y){
  if(state!=='play')return;
  boss.hp-=n; boss.flash=.12; sfx.bossHit();
  burst(x,y,5,'#ffe27a');
  score+=25;
  addFloat(x,y,`-${Math.round(n)}`,'#ffe27a');
  const frac=boss.hp/boss.maxHp;
  const np=frac>0.66?1:frac>0.33?2:3;
  if(np!==boss.phase){boss.phase=np;boss.atkT=.8;addFloat(boss.x,boss.y-80,np===2?'PHASE 2 — SOUR SPRAY!':'FINAL PHASE — BOIL OVER!','#ff6fb5');sfx.super();burst(boss.x,boss.y,30,'#ff6fb5');}
  if(boss.hp<=0){boss.hp=0;burst(boss.x,boss.y,80,'#ffd76a');burst(boss.x,boss.y,40,'#ff6fb5');shake=16;setTimeout(()=>{if(state==='play')gameOver(true);},800);}
}
function burst(x,y,n,color){
  for(let i=0;i<n;i++)parts.push({x,y,vx:rnd(-260,260),vy:rnd(-320,80),life:rnd(.3,.8),t:0,color,r:rnd(2,5)});
}
function addFloat(x,y,txt,color){floats.push({x:clamp(x,40,W-40),y,txt,color,t:0});}
function eShoot(x,y,vx,vy,r,pink){
  if(eshots.length>90)eshots.shift();
  eshots.push({x,y,vx,vy,r:r||9,pink:!!pink,t:0});
}

/* ---------- boss AI ---------- */
function bossUpdate(dt){
  boss.t+=dt; if(boss.flash>0)boss.flash-=dt;
  const P=player;
  // drift toward anchor, bob
  const anchorY=170+(boss.phase>=2?60*Math.sin(boss.t*.9):40*Math.sin(boss.t*1.2));
  if(boss.atk!=='charge'){
    boss.x+=clamp(720-boss.x,-1,1)*60*dt;
    boss.y+=(anchorY-boss.y)*Math.min(1,2.5*dt);
  }
  boss.atkT-=dt;
  const speedMul=boss.phase===1?1:boss.phase===2?1.35:1.7;
  if(boss.atkT<=0){
    const opts=boss.phase===1?['spit','spit','summon','spread']:
                 boss.phase===2?['spread','charge','spit','summon','pink']:['spread','charge','pink','spit','summon'];
    boss.atk=opts[(Math.random()*opts.length)|0];
    boss.spitN=boss.phase===3?4:3;
    if(boss.atk==='charge'){boss.chargeDx=-1;boss.vx=-520*speedMul;sfx.dash();}
    if(boss.atk==='summon'){for(let i=0;i<(boss.phase>=2?2:1);i++)minis.push({x:boss.x-40,y:GROUND-26,vx:rnd(-140,-60),vy:0,w:34,h:30,hp:2,t:rnd(0,2)});addFloat(boss.x,boss.y-70,'MINIONS!','#fff');noiseBurst(.2,.1);}
    boss.atkT=(boss.phase===1?2.0:boss.phase===2?1.6:1.2)*rnd(.85,1.2);
  }
  if(boss.atk==='spit'){
    boss.spitCd=(boss.spitCd||0)-dt;
    if(boss.spitCd<=0&&boss.spitN>0){
      boss.spitCd=.42;boss.spitN--;
      const sx=boss.x-70,sy=boss.y+30;
      const dx=P.x-sx,dy=(P.y-20)-sy,d=Math.hypot(dx,dy)||1,sp=(260+60*boss.phase)*speedMul*.8;
      const pink=Math.random()<.28;
      eShoot(sx,sy,dx/d*sp,dy/d*sp-60,pink?10:9,pink);
      sfx.mini();burst(sx,sy,4,'#c98d4b');
    }
  }else if(boss.atk==='spread'){
    boss.spitCd=(boss.spitCd||0)-dt;
    if(boss.spitCd<=0&&boss.spitN>0){
      boss.spitCd=.55;boss.spitN--;
      const sx=boss.x-70,sy=boss.y+20;
      for(let k=-2;k<=2;k++){
        const a=Math.PI+k*.22,sp=300*speedMul*.85;
        eShoot(sx,sy,Math.cos(a)*sp,Math.sin(a)*sp*.6,8,Math.abs(k)===2&&Math.random()<.5);
      }
      sfx.mini();shake=Math.min(10,shake+3);
    }
  }else if(boss.atk==='pink'){
    boss.spitCd=(boss.spitCd||0)-dt;
    if(boss.spitCd<=0&&boss.spitN>0){
      boss.spitCd=.5;boss.spitN--;
      const sx=boss.x-60,sy=boss.y+10;
      eShoot(sx,sy,rnd(-320,-220),rnd(-140,60),11,true);
      eShoot(sx,sy,rnd(-300,-200),rnd(-40,160),11,Math.random()<.6);
      sfx.parry();
    }
  }else if(boss.atk==='charge'){
    boss.x+=boss.vx*dt;
    if(boss.x<180){boss.vx=420*speedMul;boss.chargeDx=1;}
    if(boss.chargeDx===1&&boss.x>700){boss.vx=0;boss.atk='spit';boss.atkT=.8;}
    // contact damage
    if(Math.abs(P.x-boss.x)<95&&Math.abs((P.y-20)-boss.y)<80)hurtPlayer(1,boss.x);
  }
  // boss body contact
  if(boss.atk!=='charge'&&Math.abs(P.x-boss.x)<90&&Math.abs((P.y-20)-boss.y)<75)hurtPlayer(1,boss.x);
}

/* ---------- update ---------- */
let prevIn={jump:false,dash:false,parry:false,super:false};
function update(dt){
  gameTime+=dt; bgT+=dt;
  const i=inp(), P=player;
  const SPEED=300, JUMP=640, GRAV=2100;

  // horizontal
  const ax=(i.right?1:0)-(i.left?1:0);
  if(P.dashT>0){
    P.dashT-=dt; P.vy=0;
    P.vx=P.face*620;
    if(Math.random()<.6)parts.push({x:P.x,y:P.y,vx:rnd(-60,60),vy:rnd(-60,60),life:.3,t:0,color:'#9adcff',r:3});
  }else{
    P.vx+=((ax*SPEED)-P.vx)*Math.min(1,(P.ground?14:8)*dt);
    if(ax!==0)P.face=ax;
    P.vy+=GRAV*dt;
  }
  if(P.ground)P.coyote=.1;else P.coyote-=dt;
  if(i.jump&&!prevIn.jump)P.jbuf=.12;else P.jbuf-=dt;
  if(P.jbuf>0&& (P.ground||P.coyote>0)){
    P.vy=-JUMP;P.ground=false;P.coyote=0;P.jbuf=0;sfx.jump();
    burst(P.x,P.y+28,6,'#fff');
  }
  // variable jump
  if(!i.jump&&P.vy<-260)P.vy+=GRAV*1.6*dt;

  P.x=clamp(P.x+P.vx*dt,30,W-30);
  P.y+=P.vy*dt;
  if(P.y>=GROUND-P.h/2){P.y=GROUND-P.h/2;P.vy=0;P.ground=true;}else if(P.y<GROUND-P.h/2-4)P.ground=false;
  if(P.ground&&Math.abs(P.vx)>40)P.run+=dt*10;else P.run+=dt*2;

  // timers
  if(P.inv>0)P.inv-=dt; if(P.dashCD>0)P.dashCD-=dt;
  if(P.parryCD>0)P.parryCD-=dt; if(P.parryFx>0)P.parryFx-=dt;
  if(P.shootCD>0)P.shootCD-=dt;

  // dash
  if(i.dash&&!prevIn.dash&&P.dashCD<=0&&P.dashT<=0){
    P.dashT=.22;P.dashCD=.8;P.inv=Math.max(P.inv,.3);sfx.dash();
  }
  // shoot
  P.shootHeld=i.shoot?P.shootHeld+dt:0;
  if(i.shoot&&P.shootCD<=0){
    P.shootCD=.16;
    if(shots.length<24)shots.push({x:P.x+P.face*28,y:P.y-8,vx:P.face*640,vy:0,life:1.2});
    sfx.shoot();
    parts.push({x:P.x+P.face*34,y:P.y-8,vx:P.face*120,vy:rnd(-40,40),life:.15,t:0,color:'#ffe27a',r:3});
  }
  // parry (pink objects)
  if(i.parry&&!prevIn.parry&&P.parryCD<=0){
    P.parryCD=.45;P.parryFx=.25;
    let did=false;
    for(let k=eshots.length-1;k>=0;k--){
      const e=eshots[k];
      if(e.pink&&dist2(P.x,P.y,e.x,e.y)<90*90){
        eshots.splice(k,1);did=true;
        burst(e.x,e.y,16,'#ff6fb5');
      }
    }
    if(did){P.vy=-560;P.ground=false;P.super=clamp(P.super+34,0,100);score+=250;sfx.parry();addFloat(P.x,P.y-50,'PARRY! +250','#ff6fb5');shake=Math.min(10,shake+3);}
    else tone(200,.08,'square',.05);
  }
  // super
  if(i.super&&!prevIn.super&&P.super>=100){
    P.super=0;sfx.super();shake=14;
    burst(P.x+P.face*40,P.y-10,40,'#ffe27a');
    hurtBoss(26,boss.x-60,boss.y);
    for(let k=eshots.length-1;k>=0;k--)burst(eshots[k].x,eshots[k].y,3,'#fff');
    eshots.length=0;
    addFloat(P.x,P.y-60,'MEGA SIP!','#f5b301');
    for(let s=0;s<6;s++)shots.push({x:P.x,y:P.y-10+s*4-10,vx:P.face*760,vy:(s-2.5)*40,life:1.4,big:true});
  }

  bossUpdate(dt);

  // player shots
  for(let k=shots.length-1;k>=0;k--){
    const s=shots[k];s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;
    let dead=s.life<=0||s.x<-20||s.x>W+20;
    if(!dead&&Math.abs(s.x-boss.x)<(boss.w/2+(s.big?10:4))&&Math.abs(s.y-boss.y)<boss.h/2){
      hurtBoss(s.big?6:3.2,s.x,s.y);P.super=clamp(P.super+(s.big?4:2.2),0,100);dead=true;
    }
    if(!dead)for(let m=minis.length-1;m>=0;m--){
      const M=minis[m];
      if(Math.abs(s.x-M.x)<22&&Math.abs(s.y-(M.y-10))<22){
        M.hp-=s.big?3:1;dead=true;burst(s.x,s.y,5,'#fff');
        if(M.hp<=0){minis.splice(m,1);score+=150;P.super=clamp(P.super+8,0,100);sfx.mini();burst(M.x,M.y,14,'#c9a2ff');addFloat(M.x,M.y-30,'+150','#c9a2ff');}
        break;
      }
    }
    if(dead)shots.splice(k,1);
  }
  // enemy shots
  for(let k=eshots.length-1;k>=0;k--){
    const e=eshots[k];e.t+=dt;e.vy+=420*dt;
    e.x+=e.vx*dt;e.y+=e.vy*dt;
    if(e.x<-30||e.x>W+30||e.y>H+30){eshots.splice(k,1);continue;}
    if(P.dead<=0&&dist2(P.x,P.y-6,e.x,e.y)<(e.r+14)*(e.r+14)){eshots.splice(k,1);hurtPlayer(1,e.x);}
  }
  // minis chase
  for(const M of minis){
    M.t+=dt;
    const dir=Math.sign(P.x-M.x)||1;
    M.vx+=((dir*120)-M.vx)*Math.min(1,3*dt);
    M.x+=M.vx*dt;M.y=GROUND-15+Math.sin(M.t*8)*2;
    if(Math.abs(P.x-M.x)<34&&Math.abs(P.y-M.y)<44)hurtPlayer(1,M.x);
  }
  // particles/floats
  for(let k=parts.length-1;k>=0;k--){const p=parts[k];p.t+=dt;if(p.t>p.life){parts.splice(k,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=900*dt;}
  for(let k=floats.length-1;k>=0;k--){const f=floats[k];f.t+=dt;f.y-=40*dt;if(f.t>1.1)floats.splice(k,1);}
  if(shake>0)shake=Math.max(0,shake-dt*26);
  prevIn={jump:i.jump,dash:i.dash,parry:i.parry,super:i.super};
}

/* ---------- drawing ---------- */
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawBG(){
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#f9d976');g.addColorStop(.55,'#f5a86b');g.addColorStop(.75,'#c96f4a');g.addColorStop(1,'#7a3b2e');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // sun
  ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.arc(770,110,64,0,7);ctx.fill();
  ctx.strokeStyle='#2b1c12';ctx.lineWidth=4;ctx.beginPath();ctx.arc(770,110,64,0,7);ctx.stroke();
  for(let r=0;r<12;r++){const a=r/12*Math.PI*2+bgT*.05;ctx.beginPath();ctx.moveTo(770+Math.cos(a)*74,110+Math.sin(a)*74);ctx.lineTo(770+Math.cos(a)*92,110+Math.sin(a)*92);ctx.stroke();}
  // parallax hills
  hill('#b25a3f',.12,120,60);hill('#8c4230',.2,220,80);hill('#5e2a22',.3,330,90);
  // ground
  ctx.fillStyle='#3d2318';ctx.fillRect(0,GROUND,W,H-GROUND);
  ctx.fillStyle='#f7e8c9';
  for(let x=-((bgT*30)%48);x<W;x+=48)for(let y=GROUND+8;y<H;y+=34)checker(x,y);
  ctx.fillStyle='#2b1c12';ctx.fillRect(0,GROUND,W,5);
  // tablecloth dots
  ctx.fillStyle='#00000018';
  for(let x=20;x<W;x+=70)for(let y=GROUND+14;y<H;y+=34){ctx.beginPath();ctx.arc(x+((y*7)%20),y,3,0,7);ctx.fill();}
}
function checker(x,y){ctx.save();ctx.translate(x,y);ctx.fillRect(0,0,22,13);ctx.fillRect(26,17,22,13);ctx.restore();}
function hill(color,par,base,amp){
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,H);
  for(let x=0;x<=W;x+=20){const y=base+Math.sin(x*.008+bgT*par)*amp*.4+Math.sin(x*.02+bgT*par*2)*amp*.25;ctx.lineTo(x,GROUND-40-(base-120)*.4+y*.2);}
  ctx.lineTo(W,H);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#2b1c12';ctx.lineWidth=3;ctx.stroke();
}
function drawPlayer(){
  const P=player;if(P.dead>0&&Math.floor(P.dead*12)%2===0&&state==='play')return;
  ctx.save();ctx.translate(P.x,P.y);
  if(P.inv>0&&Math.floor(P.inv*14)%2===0)ctx.globalAlpha=.45;
  ctx.scale(P.face,1);
  const bob=P.ground?Math.abs(Math.sin(P.run))*3:0;
  // legs
  ctx.strokeStyle='#2b1c12';ctx.lineWidth=6;ctx.lineCap='round';
  const lp=P.ground?Math.sin(P.run)*10:8;
  ctx.beginPath();ctx.moveTo(-6,-14);ctx.lineTo(-8+lp*.4,14-bob*.3);ctx.stroke();
  ctx.beginPath();ctx.moveTo(8,-14);ctx.lineTo(10-lp*.4,14-bob*.3);ctx.stroke();
  // shoes
  ctx.fillStyle='#7a2d12';
  rr(-18+lp*.4,8,22,12,6);ctx.fill();ctx.stroke();
  rr(0-lp*.4,8,22,12,6);ctx.fill();ctx.stroke();
  // cup body
  ctx.fillStyle=P.parryFx>0?'#ffe0ef':'#fffdf4';
  ctx.strokeStyle='#2b1c12';ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(-22,-52+bob*.3);ctx.lineTo(22,-52+bob*.3);ctx.lineTo(16,-12);ctx.quadraticCurveTo(0,-6,-16,-12);ctx.closePath();
  ctx.fill();ctx.stroke();
  // stripes
  ctx.save();ctx.clip();
  ctx.fillStyle='#e23b3b';ctx.fillRect(-22,-44+bob*.3,44,7);ctx.fillRect(-22,-32+bob*.3,44,7);
  ctx.restore();
  // handle
  ctx.beginPath();ctx.arc(24,-32,10,-1.2,1.2);ctx.lineWidth=6;ctx.stroke();
  // straw
  ctx.save();ctx.rotate(-.25);ctx.fillStyle='#e23b3b';rr(-5,-84+bob*.3,10,32,4);ctx.fill();ctx.stroke();
  ctx.fillStyle='#fff';for(let s=0;s<3;s++)ctx.fillRect(-5,-80+bob*.3+s*10,10,4);ctx.restore();
  // eyes
  const look=P.shootHeld>0?3:1;
  ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(2,-52+bob*.3,9,11,0,0,7);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.ellipse(18,-52+bob*.3,9,11,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle='#2b1c12';ctx.beginPath();ctx.arc(5+look,-50+bob*.3,3.4,0,7);ctx.fill();
  ctx.beginPath();ctx.arc(21+look,-50+bob*.3,3.4,0,7);ctx.fill();
  // gun arm (finger snap)
  ctx.strokeStyle='#2b1c12';ctx.lineWidth=7;
  ctx.beginPath();ctx.moveTo(14,-30);ctx.lineTo(34,-22);ctx.stroke();
  ctx.fillStyle='#ffd9a0';ctx.beginPath();ctx.arc(37,-21,7,0,7);ctx.fill();ctx.lineWidth=3;ctx.stroke();
  if(P.shootHeld>0){ctx.fillStyle='#ffe27a';ctx.beginPath();ctx.arc(48,-20,6+Math.random()*3,0,7);ctx.fill();}
  // parry ring
  if(P.parryFx>0){ctx.strokeStyle='#ff6fb5';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,-28,44+(.25-P.parryFx)*120,0,7);ctx.stroke();}
  // dash ghost
  if(P.dashT>0){ctx.strokeStyle='#9adcff';ctx.lineWidth=4;for(let k=1;k<4;k++){ctx.globalAlpha=.3/k;ctx.beginPath();ctx.moveTo(-k*22,-44);ctx.lineTo(-k*22,-16);ctx.stroke();}ctx.globalAlpha=1;}
  ctx.restore();
}
function drawBoss(){
  const B=boss;
  ctx.save();ctx.translate(B.x,B.y);
  if(B.flash>0)ctx.filter='brightness(1.8)';
  const wob=Math.sin(B.t*(B.phase*1.2+1))*(B.atk==='charge'?2:6);
  ctx.rotate(B.atk==='charge'?clamp(-B.vx*.0002,-.2,.2):Math.sin(B.t*1.4)*.05);
  // shadow handled separately; body = copper kettle
  ctx.fillStyle='#d98a3d';ctx.strokeStyle='#2b1c12';ctx.lineWidth=5;
  rr(-75,-60+wob*.3,150,120,26);ctx.fill();ctx.stroke();
  // bands
  ctx.fillStyle='#8c4a1d';ctx.fillRect(-75,-18,150,12);ctx.fillRect(-75,14,150,10);
  // lid
  ctx.fillStyle='#f5b301';rr(-34,-92+wob,68,36,12);ctx.fill();ctx.stroke();
  ctx.fillStyle='#e23b3b';ctx.beginPath();ctx.arc(0,-96+wob,10,0,7);ctx.fill();ctx.stroke();
  // spout (left, shoots)
  ctx.fillStyle='#b96a24';
  ctx.beginPath();ctx.moveTo(-75,-20);ctx.lineTo(-118,6);ctx.lineTo(-112,30);ctx.lineTo(-70,14);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#2b1c12';ctx.beginPath();ctx.ellipse(-115,18,8,12,.3,0,7);ctx.fill();
  // handle right
  ctx.lineWidth=10;ctx.beginPath();ctx.arc(80,-2,34,-1.1,1.1);ctx.stroke();
  // angry eyes
  const ey=B.phase>=3?'#ff5b5b':'#fff';
  ctx.fillStyle=ey;
  ctx.beginPath();ctx.ellipse(-24,-34,17,19,0,0,7);ctx.fill();ctx.lineWidth=4;ctx.stroke();
  ctx.beginPath();ctx.ellipse(24,-34,17,19,0,0,7);ctx.fill();ctx.stroke();
  const px=clamp((player.x-B.x)*.01,-6,6);
  ctx.fillStyle='#2b1c12';ctx.beginPath();ctx.arc(-24+px,-30,6,0,7);ctx.fill();
  ctx.beginPath();ctx.arc(24+px,-30,6,0,7);ctx.fill();
  // brows
  ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(-44,-58);ctx.lineTo(-8,-48);ctx.stroke();
  ctx.beginPath();ctx.moveTo(44,-58);ctx.lineTo(8,-48);ctx.stroke();
  // mouth (grill)
  ctx.fillStyle='#2b1c12';rr(-30,2,60,26,8);ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=2;
  for(let m=0;m<3;m++){ctx.beginPath();ctx.moveTo(-24+m*18,4);ctx.lineTo(-24+m*18,26);ctx.stroke();}
  // steam
  ctx.globalAlpha=.6;ctx.fillStyle='#fff';
  for(let s=0;s<3;s++){const sy=-110-((B.t*60+s*40)%90);ctx.beginPath();ctx.arc(Math.sin(B.t*3+s*2)*14+s*10-10,sy,10-s*2,0,7);ctx.fill();}
  ctx.globalAlpha=1;
  ctx.filter='none';
  ctx.restore();
  // phase pips
  ctx.fillStyle='#00000055';rr(B.x-60,B.y-118,120,10,5);ctx.fill();
  ctx.fillStyle=B.phase===1?'#7dff8a':B.phase===2?'#ffd76a':'#ff6f6f';
  rr(B.x-60,B.y-118,120*clamp(B.hp/B.maxHp,0,1),10,5);ctx.fill();
}
function drawShots(){
  for(const s of shots){
    ctx.save();ctx.translate(s.x,s.y);
    ctx.fillStyle=s.big?'#fff3a0':'#e8f7ff';ctx.strokeStyle='#2b1c12';ctx.lineWidth=3;
    ctx.beginPath();ctx.ellipse(0,0,s.big?13:9,s.big?9:6,0,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#9adcff';ctx.beginPath();ctx.arc(3,0,3,0,7);ctx.fill();
    ctx.restore();
  }
  for(const e of eshots){
    ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.t*4);
    if(e.pink){
      ctx.fillStyle='#ff9fd0';ctx.strokeStyle='#a3125b';ctx.lineWidth=3;
      ctx.beginPath();for(let p=0;p<5;p++){const a=p/5*Math.PI*2;ctx.lineTo(Math.cos(a)*e.r,Math.sin(a)*e.r);}ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();
      // pulsing ring so parryable is obvious
      ctx.strokeStyle='#ff6fb5';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,e.r+4+Math.sin(e.t*10)*2,0,7);ctx.stroke();
    }else{
      ctx.fillStyle='#7a4b2a';ctx.strokeStyle='#2b1c12';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,e.r,0,7);ctx.fill();ctx.stroke();
      ctx.fillStyle='#c98d4b';ctx.beginPath();ctx.arc(-2,-2,3,0,7);ctx.fill();
    }
    ctx.restore();
  }
  for(const M of minis){
    ctx.save();ctx.translate(M.x,M.y);
    ctx.fillStyle='#c9a2ff';ctx.strokeStyle='#2b1c12';ctx.lineWidth=3;
    const j=Math.sin(M.t*10)*2;
    rr(-16,-28+j,32,28,6);ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-6,-16+j,5,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(7,-16+j,5,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#2b1c12';ctx.beginPath();ctx.arc(-5,-15+j,2,0,7);ctx.fill();ctx.beginPath();ctx.arc(8,-15+j,2,0,7);ctx.fill();
    ctx.strokeStyle='#2b1c12';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(-12,8);ctx.stroke();
    ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(12,8);ctx.stroke();
    ctx.restore();
  }
}
function drawParts(){
  for(const p of parts){ctx.globalAlpha=1-p.t/p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();}
  ctx.globalAlpha=1;
  ctx.textAlign='center';ctx.font='bold 16px "Trebuchet MS",sans-serif';
  for(const f of floats){ctx.globalAlpha=1-f.t/1.1;ctx.lineWidth=4;ctx.strokeStyle='#000';ctx.strokeText(f.txt,f.x,f.y);ctx.fillStyle=f.color;ctx.fillText(f.txt,f.x,f.y);}
  ctx.globalAlpha=1;
}
function drawHUD(){
  // top bars
  ctx.fillStyle='#00000088';rr(10,8,300,54,10);ctx.fill();
  ctx.fillStyle='#fff';ctx.font='bold 13px "Trebuchet MS",sans-serif';ctx.textAlign='left';
  ctx.fillText('CUPHED',20,28);
  // player hearts
  ctx.font='16px serif';ctx.fillText('❤'.repeat(player.hp)+'🖤'.repeat(Math.max(0,player.maxHp-player.hp)),20,50);
  // boss bar
  const bw=380,bx=W-bw-14;
  ctx.fillStyle='#00000088';rr(bx,8,bw,54,10);ctx.fill();
  ctx.fillStyle='#fff';ctx.font='bold 13px "Trebuchet MS",sans-serif';
  ctx.fillText('LORD KETTLE — P'+boss.phase, bx+10, 28);
  ctx.fillStyle='#3a0e0e';rr(bx+10,34,bw-20,14,7);ctx.fill();
  const f=clamp(boss.hp/boss.maxHp,0,1);
  const grd=ctx.createLinearGradient(bx,0,bx+bw,0);
  grd.addColorStop(0,'#ff5b5b');grd.addColorStop(1,'#f5b301');
  ctx.fillStyle=grd;if(f>0){rr(bx+10,34,(bw-20)*f,14,7);ctx.fill();}
  // super meter
  const sx=322,sy2=8,sw=200;
  ctx.fillStyle='#00000088';rr(sx,sy2,sw,54,10);ctx.fill();
  ctx.fillStyle=player.super>=100?'#f5b301':'#fff';
  ctx.font='bold 13px "Trebuchet MS",sans-serif';ctx.fillText(player.super>=100?'SUPER READY! (U)':'SUPER '+Math.floor(player.super)+'%',sx+10,28);
  ctx.fillStyle='#222';rr(sx+10,34,sw-20,14,7);ctx.fill();
  ctx.fillStyle='#9adcff';if(player.super>0){rr(sx+10,34,(sw-20)*player.super/100,14,7);ctx.fill();}
  // score/time
  ctx.fillStyle='#00000088';rr(10,68,190,34,8);ctx.fill();
  ctx.fillStyle='#ffe27a';ctx.font='bold 15px "Trebuchet MS",sans-serif';
  ctx.fillText(`★ ${score}   ⏱ ${gameTime.toFixed(0)}s`,20,90);
  // dash cooldown pip
  if(player.dashCD>0){ctx.fillStyle='#ffffffaa';ctx.font='bold 12px sans-serif';ctx.fillText(`dash ${player.dashCD.toFixed(1)}`,20,116);}
  // controls hint (desktop)
  ctx.fillStyle='#ffffff99';ctx.font='12px "Trebuchet MS",sans-serif';ctx.textAlign='right';
  ctx.fillText('move ←→ · jump Space · shoot J · dash K · parry L · super U · pause P',W-14,H-10);
}

/* ---------- main loop ---------- */
let last=performance.now();
function frame(now){
  let dt=Math.min(.033,(now-last)/1000);last=now;
  ctx.save();
  if(shake>0)ctx.translate(rnd(-shake,shake)*.5,rnd(-shake,shake)*.5);
  drawBG();
  if(state==='play'||state==='pause'||state==='over'||state==='win'){
    if(state==='play')update(dt);
    // shadows
    ctx.fillStyle='#00000033';ctx.beginPath();ctx.ellipse(player.x,GROUND+8,26,7,0,0,7);ctx.fill();
    ctx.beginPath();ctx.ellipse(boss.x,GROUND+10,80,12,0,0,7);ctx.fill();
    drawBoss();drawPlayer();drawShots();drawParts();drawHUD();
    if(state==='pause'){ctx.fillStyle='#00000088';ctx.fillRect(0,0,W,H);}
  }else{
    // menu attract mode: idle scene
    drawBoss();drawPlayer();drawHUD();
  }
  ctx.restore();
  requestAnimationFrame(frame);
}
function fit(){
  const dpr=Math.min(2,devicePixelRatio||1);
  canvas.width=W*dpr;canvas.height=H*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
fit();addEventListener('resize',fit);
show('menuOv');
$('bestLine').textContent=best.score?`Best score: ${best.score}${best.win?' · 👑 Champion!':''}`:'No records yet — go spill some tea!';
requestAnimationFrame(frame);
})();
