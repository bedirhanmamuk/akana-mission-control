/* AKANA yer istasyonu · Analiz modu
   PlotJuggler'ın çalışma biçiminden esinlenildi (kod alınmadı):
   sinyal ağacından sürükle-bırak, bölünebilir grafik alanı, tüm grafiklerde ortak zaman imleci ve X ekseni,
   XY grafiği, türetilmiş sinyaller (filtreler), olay işaretleri ve kayıt oynatma. Veri kaynağı: Open MCT
   telemetri sağlayıcısının tuttuğu geçmiş (HIST); aynı veri canlı akarken de analiz edilebilir. */
"use strict";
const AN = {
  open:false, panels:[], focus:0, layout:'2x2',
  x0:null, x1:null, follow:true, win:180,           // ortak X aralığı (s); follow: canlı uç takibi
  tt:null, playing:false, speed:1, lastFrame:0,     // imleç / oynatma zamanı
  derived:{}, dseq:0, cache:{},
};
const PALETTE = ['#1f6feb','#e07a12','#8a5cf6','#14915a','#d23c3c','#0e9aa7','#b5478a','#6b7a90'];
const anEl = id => document.getElementById(id);

/* ---------- sinyaller ---------- */
const AN_GROUPS = [['main','Ana UKB'],['backup','Yedek UKB'],['payload','Görev yükü'],['calc','Hesaplanan'],['link','Haberleşme'],['der','Türetilmiş']];
function sigName(k){ const d=AN.derived[k]; if (d) return d.name; const p=POINT_INDEX[k]; return p ? (PREFIX[p.grp] ? PREFIX[p.grp]+' · ' : '')+p.name : k; }
function sigUnit(k){ const d=AN.derived[k]; if (d) return d.unit; const p=POINT_INDEX[k]; return p ? p.unit : ''; }
function rawSeries(k){                                  // HIST → [[t,v]...] (uzunluğa göre önbellekli)
  const h=HIST[k]||[], c=AN.cache[k];
  if (c && c.n===h.length) return c.d;
  const d = c && c.n<h.length ? c.d : [];
  for (let i=c&&c.n<h.length?c.n:0; i<h.length; i++) d.push([(h[i].utc-EPOCH)/1000, +h[i].value]);
  AN.cache[k]={ n:h.length, d }; return d;
}
function series(k){ const d=AN.derived[k]; return d ? derive(d) : rawSeries(k); }

/* ---------- türetilmiş sinyaller (filtreler) ---------- */
const FILTERS = {
  deriv: { name:'Türev', unit:u=>u+'/s', p:null, f:s=>{ const o=[]; for (let i=1;i<s.length;i++){ const dt=s[i][0]-s[i-1][0]; if (dt>1e-6) o.push([s[i][0],(s[i][1]-s[i-1][1])/dt]); } return o; } },
  integ: { name:'İntegral', unit:u=>u+'·s', p:null, f:s=>{ const o=[]; let a=0; for (let i=0;i<s.length;i++){ if (i) a+=(s[i][1]+s[i-1][1])/2*(s[i][0]-s[i-1][0]); o.push([s[i][0],a]); } return o; } },
  mavg:  { name:'Hareketli ortalama', unit:u=>u, p:['Pencere (örnek)',10], f:(s,n)=>{ n=Math.max(1,n|0); const o=[]; let a=0; for (let i=0;i<s.length;i++){ a+=s[i][1]; if (i>=n) a-=s[i-n][1]; o.push([s[i][0],a/Math.min(i+1,n)]); } return o; } },
  mstd:  { name:'Hareketli std. sapma', unit:u=>u, p:['Pencere (örnek)',20], f:(s,n)=>{ n=Math.max(2,n|0); const o=[]; let a=0,b=0; for (let i=0;i<s.length;i++){ a+=s[i][1]; b+=s[i][1]**2; if (i>=n){ a-=s[i-n][1]; b-=s[i-n][1]**2; } const m=Math.min(i+1,n); o.push([s[i][0],Math.sqrt(Math.max(0,b/m-(a/m)**2))]); } return o; } },
  scale: { name:'Ölçek', unit:u=>u, p:['Çarpan',3.28084], f:(s,a)=>s.map(([t,v])=>[t,v*a]) },
  abs:   { name:'Mutlak değer', unit:u=>u, p:null, f:s=>s.map(([t,v])=>[t,Math.abs(v)]) },
  dt:    { name:'Örnekler arası süre', unit:()=>'s', p:null, f:s=>{ const o=[]; for (let i=1;i<s.length;i++) o.push([s[i][0],s[i][0]-s[i-1][0]]); return o; } },
  outl:  { name:'Aykırı değer temizleme', unit:u=>u, p:['Eşik (σ)',3], f:(s,k)=>{ const n=15, o=[]; for (let i=0;i<s.length;i++){ const w=s.slice(Math.max(0,i-n),i+n+1).map(p=>p[1]).sort((a,b)=>a-b), med=w[w.length>>1], mad=w.map(v=>Math.abs(v-med)).sort((a,b)=>a-b)[w.length>>1]*1.4826||1e-9; if (Math.abs(s[i][1]-med)<=k*mad) o.push(s[i]); } return o; } },
};
function derive(d){
  const src=series(d.src), n=src.length;
  if (d.c && d.c.n===n && d.c.last===(n?src[n-1][1]:null)) return d.c.out;
  const out=FILTERS[d.fn].f(src, d.par); d.c={ n, last:n?src[n-1][1]:null, out }; return out;
}
function addDerived(src, fn, par){
  const F=FILTERS[fn], k='der.'+(++AN.dseq);
  AN.derived[k]={ src, fn, par, name:`${F.name}${F.p?` (${fmt(par, Number.isInteger(par)?0:2)})`:''} ← ${sigName(src)}`, unit:F.unit(sigUnit(src)) };
  return k;
}

/* ---------- panel modeli ---------- */
const mkPanel = (curves=[], mode='time', x=null) => ({ mode, x, curves:curves.map((k,i)=>({ k, c:PALETTE[i%PALETTE.length] })) });
function defaultPanels(){
  const temp=addDerived('payload.alt','deriv');                     // görev yükü iniş hızı (türev)
  AN.panels=[
    mkPanel(['main.alt','payload.alt','backup.alt']),
    mkPanel(['main.vz','calc.v', temp]),
    mkPanel(['backup.ax','backup.ay','backup.az']),
    mkPanel(['payload.alt'],'xy','payload.temp'),                   // atmosfer profili: sıcaklık–irtifa
  ];
}
function nextColor(p){ const used=p.curves.map(c=>c.c); return PALETTE.find(c=>!used.includes(c)) || PALETTE[p.curves.length%PALETTE.length]; }
function addToPanel(i, k){
  const p=AN.panels[i]; if (!p) return;
  if (p.mode==='xy' && !p.x){ p.x=k; }
  else if (!p.curves.some(c=>c.k===k)) p.curves.push({ k, c:nextColor(p) });
  renderPanels(); anTree();
}

/* ---------- veri yardımcıları ---------- */
function bsearch(d, t){ let lo=0, hi=d.length-1; if (hi<0) return -1; if (t<=d[0][0]) return 0; if (t>=d[hi][0]) return hi; while (hi-lo>1){ const m=(lo+hi)>>1; if (d[m][0]<t) lo=m; else hi=m; } return t-d[lo][0] < d[hi][0]-t ? lo : hi; }
function valueAt(d, t, tol=1.5){ const i=bsearch(d,t); return i<0 || Math.abs(d[i][0]-t)>tol ? null : d[i][1]; }
function dataSpan(){ let a=Infinity, b=-Infinity; for (const k in HIST){ const h=HIST[k]; if (h.length){ a=Math.min(a,(h[0].utc-EPOCH)/1000); b=Math.max(b,(h[h.length-1].utc-EPOCH)/1000); } } return isFinite(a)?[a,b]:[0,1]; }
function xRange(){
  const [a,b]=dataSpan();
  if (AN.follow && !AN.playing) return [Math.max(a,b-AN.win), b];
  return [AN.x0??a, AN.x1??b];
}
function niceStep(span, n){ const raw=span/n, m=10**Math.floor(Math.log10(raw||1)); return [1,2,2.5,5,10].map(x=>x*m).find(x=>raw<=x); }

/* ---------- çizim ---------- */
function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function drawPanel(i){
  const p=AN.panels[i], el=anEl('anp'+i); if (!el) return;
  const cv=el.querySelector('canvas'), W=cv.clientWidth, H=cv.clientHeight; if (W<10||H<10) return;
  const dpr=Math.min(2,window.devicePixelRatio||1); if (cv.width!==Math.round(W*dpr) || cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const C={ text:css('--text'), muted:css('--faint'), grid:css('--rule'), edge:css('--edge2'), acc:css('--acc'), card:css('--card') };
  const ml=54, mr=10, mt=8, mb=22, pw=W-ml-mr, ph=H-mt-mb;
  g.font='11px '+css('--mono');
  const xy=p.mode==='xy';
  let x0,x1;
  const sets=p.curves.map(c=>({ ...c, d:series(c.k) }));
  let xs=null;
  if (xy){
    xs = p.x ? series(p.x) : [];
    let a=Infinity,b=-Infinity; xs.forEach(q=>{ a=Math.min(a,q[1]); b=Math.max(b,q[1]); }); if (!isFinite(a)){ a=0;b=1; } if (b-a<1e-9){ a-=1; b+=1; }
    x0=a; x1=b;
  } else [x0,x1]=xRange();
  // Y aralığı: görünür veriden
  let lo=Infinity, hi=-Infinity;
  const pairs=[];
  sets.forEach(s=>{
    if (xy){ const pts=[]; s.d.forEach(([t,v])=>{ if (AN.tt!=null && AN.playing && t>AN.tt) return; const xv=valueAt(xs,t,0.6); if (xv!=null){ pts.push([xv,v,t]); lo=Math.min(lo,v); hi=Math.max(hi,v); } }); pairs.push(pts); }
    else { const i0=Math.max(0,bsearch(s.d,x0)-1), i1=Math.min(s.d.length-1,bsearch(s.d,x1)+1); for (let j=i0;j<=i1&&j>=0;j++){ const v=s.d[j][1]; if (isFinite(v)){ lo=Math.min(lo,v); hi=Math.max(hi,v); } } s.i0=i0; s.i1=i1; }
  });
  if (!isFinite(lo)){ lo=0; hi=1; } if (hi-lo<1e-9){ lo-=1; hi+=1; } const pad=(hi-lo)*.06; lo-=pad; hi+=pad;
  const X=v=>ml+(v-x0)/(x1-x0||1)*pw, Y=v=>mt+(1-(v-lo)/(hi-lo))*ph;
  // ızgara
  g.strokeStyle=C.grid; g.fillStyle=C.muted; g.lineWidth=1; g.textAlign='right';
  const ys=niceStep(hi-lo,5); for (let v=Math.ceil(lo/ys)*ys; v<=hi; v+=ys){ const y=Math.round(Y(v))+.5; g.beginPath(); g.moveTo(ml,y); g.lineTo(ml+pw,y); g.stroke(); g.fillText(fmt(v, ys<1?(ys<.1?2:1):0), ml-6, y+4); }
  g.textAlign='center';
  const xst=niceStep(x1-x0, Math.max(2,Math.floor(pw/90))); for (let v=Math.ceil(x0/xst)*xst; v<=x1; v+=xst){ const x=Math.round(X(v))+.5; g.beginPath(); g.moveTo(x,mt); g.lineTo(x,mt+ph); g.stroke(); g.fillText(xy?fmt(v,xst<1?1:0):((v-TIME0)<0?'−':'+')+fmt(Math.abs(v-TIME0),xst<1?1:0)+' s', x, H-6); }
  g.strokeStyle=C.edge; g.strokeRect(ml+.5,mt+.5,pw,ph);
  g.save(); g.beginPath(); g.rect(ml,mt,pw,ph); g.clip();
  // olay işaretleri (yalnız zaman grafiği)
  if (!xy){ g.setLineDash([3,4]); g.strokeStyle=C.muted; g.fillStyle=C.muted; g.textAlign='left';
    let lx=-1e9, row=0; anEvents().forEach(([l,t])=>{ if (t<x0||t>x1) return; const x=Math.round(X(t))+.5; g.beginPath(); g.moveTo(x,mt); g.lineTo(x,mt+ph); g.stroke(); const w=g.measureText(l).width+8; row = x-lx<w ? (row+1)%3 : 0; g.fillText(l,x+4,mt+12+row*13); lx = row===0 ? x : lx; }); g.setLineDash([]); }
  // eğriler: piksel başına min–max indirgeme
  g.lineWidth=1.6; g.lineJoin='round';
  sets.forEach((s,si)=>{
    g.strokeStyle=s.c; g.beginPath();
    if (xy){ const pts=pairs[si]; pts.forEach(([a,b],j)=>{ j?g.lineTo(X(a),Y(b)):g.moveTo(X(a),Y(b)); }); g.stroke(); return; }
    let col=null, mn=0, mx=0, first=true, lastT=null;
    const flush=()=>{ if (col==null) return; g.lineTo(col,Y(mn)); if (mx!==mn) g.lineTo(col,Y(mx)); };
    for (let j=s.i0;j<=s.i1;j++){ const [t,v]=s.d[j]; if (!isFinite(v)) continue; const x=Math.round(X(t));
      if (lastT!=null && t-lastT>1.2){ flush(); col=null; first=true; }                 // veri boşluğu: çizgiyi kes
      if (first){ g.moveTo(x,Y(v)); col=x; mn=mx=v; first=false; }
      else if (x!==col){ flush(); col=x; mn=mx=v; } else { mn=Math.min(mn,v); mx=Math.max(mx,v); }
      lastT=t; }
    flush(); g.stroke();
  });
  // imleç
  const tt=AN.tt;
  const vals=sets.map((s,si)=>{ if (tt==null) return null; if (xy){ const pts=pairs[si]; if (!pts.length) return null; let b=pts[0]; for (const q of pts) if (Math.abs(q[2]-tt)<Math.abs(b[2]-tt)) b=q; return Math.abs(b[2]-tt)<1.5?b:null; } return valueAt(s.d,tt); });
  if (tt!=null){
    if (!xy && tt>=x0 && tt<=x1){ const x=Math.round(X(tt))+.5; g.strokeStyle=C.acc; g.lineWidth=1; g.beginPath(); g.moveTo(x,mt); g.lineTo(x,mt+ph); g.stroke();
      sets.forEach((s,si)=>{ const v=vals[si]; if (v==null) return; g.fillStyle=s.c; g.beginPath(); g.arc(x,Y(v),3.5,0,7); g.fill(); }); }
    if (xy) sets.forEach((s,si)=>{ const q=vals[si]; if (!q) return; g.fillStyle=s.c; g.strokeStyle=C.card; g.lineWidth=2; g.beginPath(); g.arc(X(q[0]),Y(q[1]),5,0,7); g.fill(); g.stroke(); });
  }
  g.restore();
  // lejant değerleri
  const lg=el.querySelector('.anlg');
  const vs=vals.map((v,si)=>v==null?'—':fmt(xy?v[1]:v, Math.abs(xy?v[1]:v)<10?2:1));
  lg.querySelectorAll('[data-v]').forEach((e,si)=>{ e.textContent=vs[si]??'—'; });
  const xv=lg.querySelector('[data-xv]'); if (xv) xv.textContent = xy && vals.find(Boolean) ? fmt(vals.find(Boolean)[0],1) : '—';
  el._geo={ X, Y, x0, x1, ml, pw, xy };
}
function anEvents(){
  return [['Kalkış','BOOST'],['Apogee','APOGEE'],['Ayrılma','PAYLOAD SEPARATION'],['İkincil','RECOVERY'],['İniş','LANDED']]
    .map(([l,k])=>[l,Events.get(k).at]).filter(e=>e[1]!=null);
}

/* ---------- panel DOM ---------- */
function renderPanels(){
  const box=anEl('anGrid'); box.dataset.layout=AN.layout;
  const n = AN.layout==='1' ? 1 : AN.layout==='2' ? 2 : 4;
  while (AN.panels.length<n) AN.panels.push(mkPanel());
  box.innerHTML = AN.panels.slice(0,n).map((p,i)=>`
    <div class="anp ${i===AN.focus?'focus':''}" id="anp${i}" data-i="${i}">
      <div class="anph"><div class="sg"><button data-mode="time" class="${p.mode==='time'?'on':''}">Zaman</button><button data-mode="xy" class="${p.mode==='xy'?'on':''}">XY</button></div>
        <div class="anlg">${p.mode==='xy'?`<span class="anx">X: ${p.x?`${sigName(p.x)} <b data-xv>—</b> ${sigUnit(p.x)} <button data-rx aria-label="X eksenini kaldır">✕</button>`:'<em>buraya bir sinyal bırakın</em>'}</span>`:''}
          ${p.curves.map((c,ci)=>`<span class="anli"><i style="background:${c.c}"></i>${sigName(c.k)} <b data-v>—</b> ${sigUnit(c.k)}<button data-rm="${ci}" aria-label="Kaldır">✕</button></span>`).join('')}
          ${!p.curves.length&&p.mode==='time'?'<em>Soldaki listeden sinyal sürükleyin veya seçip “Ekle”ye basın</em>':''}</div>
        <button class="mb" data-clr title="Grafiği temizle" aria-label="Grafiği temizle">⌫</button></div>
      <div class="anc"><canvas></canvas></div></div>`).join('');
  box.querySelectorAll('.anp').forEach(el=>{
    const i=+el.dataset.i, p=AN.panels[i], cv=el.querySelector('canvas');
    el.addEventListener('pointerdown',()=>{ if (AN.focus!==i){ AN.focus=i; box.querySelectorAll('.anp').forEach(x=>x.classList.toggle('focus',+x.dataset.i===i)); } }, true);
    el.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{ p.mode=b.dataset.mode; renderPanels(); });
    el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ p.curves.splice(+b.dataset.rm,1); renderPanels(); anTree(); });
    const rx=el.querySelector('[data-rx]'); if (rx) rx.onclick=()=>{ p.x=null; renderPanels(); };
    el.querySelector('[data-clr]').onclick=()=>{ p.curves=[]; p.x=null; renderPanels(); anTree(); };
    el.addEventListener('dragover',e=>{ e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave',()=>el.classList.remove('drop'));
    el.addEventListener('drop',e=>{ e.preventDefault(); el.classList.remove('drop'); const k=e.dataTransfer.getData('text/plain'); if (k) addToPanel(i,k); });
    // imleç, yakınlaştırma, kaydırma (zaman grafikleri ortak X eksenini paylaşır)
    let drag=null;
    cv.addEventListener('pointermove',e=>{ const g=el._geo; if (!g) return; const r=cv.getBoundingClientRect(), x=e.clientX-r.left;
      if (drag && !g.xy){ const dt=(drag.x-x)/g.pw*(drag.x1-drag.x0); AN.follow=false; AN.x0=drag.x0+dt; AN.x1=drag.x1+dt; anDraw(); return; }
      if (!AN.playing && !g.xy){ AN.tt=g.x0+(x-g.ml)/g.pw*(g.x1-g.x0); anDraw(); anTimeline(); } });
    cv.addEventListener('pointerdown',e=>{ const g=el._geo; if (!g||g.xy) return; drag={ x:e.clientX-cv.getBoundingClientRect().left, x0:g.x0, x1:g.x1 }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointerup',()=>drag=null);
    cv.addEventListener('wheel',e=>{ const g=el._geo; if (!g||g.xy) return; e.preventDefault(); const r=cv.getBoundingClientRect(), tm=g.x0+(e.clientX-r.left-g.ml)/g.pw*(g.x1-g.x0), f=e.deltaY<0?1/1.35:1.35;
      AN.follow=false; AN.x0=tm-(tm-g.x0)*f; AN.x1=tm+(g.x1-tm)*f; anDraw(); }, { passive:false });
    cv.addEventListener('dblclick',()=>{ anFit(); });
  });
  anDraw();
}
function anFit(){ const [a,b]=dataSpan(); AN.follow=false; AN.x0=a; AN.x1=b; anDraw(); }
function anDraw(){ if (!AN.open) return; const n=AN.layout==='1'?1:AN.layout==='2'?2:4; for (let i=0;i<n;i++) drawPanel(i); }

/* ---------- sinyal ağacı ---------- */
function anTree(){
  const q=(anEl('anQ').value||'').toLocaleLowerCase('tr');
  const used=new Set(AN.panels.flatMap(p=>[...p.curves.map(c=>c.k), p.x].filter(Boolean)));
  const items=g=> g==='der' ? Object.keys(AN.derived) : (POINTS[g]||[]).map(p=>pointKey(g,p.key)).filter(k=>k!=='main.phase'&&k!=='payload.sep');
  anEl('anTree').innerHTML = AN_GROUPS.map(([g,label])=>{
    const ks=items(g).filter(k=>!q || sigName(k).toLocaleLowerCase('tr').includes(q)); if (!ks.length) return '';
    return `<div class="ang">${label}</div>`+ks.map(k=>`<div class="ani ${used.has(k)?'used':''} ${AN.sel===k?'sel':''}" draggable="true" data-k="${k}" tabindex="0"><span>${sigName(k).replace(/^(Ana|Yedek|GY) · /,'')}</span><small>${sigUnit(k)}</small></div>`).join('');
  }).join('');
  anEl('anTree').querySelectorAll('.ani').forEach(e=>{
    e.addEventListener('dragstart',ev=>{ ev.dataTransfer.setData('text/plain',e.dataset.k); ev.dataTransfer.effectAllowed='copy'; });
    e.onclick=()=>{ AN.sel=e.dataset.k; anEl('anSrc').value=e.dataset.k; anTree(); };
    e.ondblclick=()=>addToPanel(AN.focus,e.dataset.k);
    e.onkeydown=ev=>{ if (ev.key==='Enter') addToPanel(AN.focus,e.dataset.k); };
  });
  // türetme kaynağı listesi
  const all=AN_GROUPS.flatMap(([g])=>items(g)), cur=anEl('anSrc').value;
  anEl('anSrc').innerHTML=all.map(k=>`<option value="${k}">${sigName(k)}</option>`).join(''); if (all.includes(cur)) anEl('anSrc').value=cur;
}

/* ---------- zaman çubuğu / oynatma ---------- */
function anTimeline(){
  const [a,b]=dataSpan(), s=anEl('anSlider'); s.min=a; s.max=b; s.step=.1;
  if (AN.tt!=null) s.value=AN.tt;
  const t=AN.tt??b, ph=valueAt(rawSeries('main.phase'),t,3);
  anEl('anT').textContent = ts(t)+' s';
  anEl('anPh').textContent = ph==null?'—':CFG.phases[Math.round(ph)];
  anEl('anMarks').innerHTML = anEvents().map(([l,te])=>`<i style="left:${((te-a)/(b-a||1)*100).toFixed(2)}%" title="${l}"></i>`).join('');
  anEl('anPlay').textContent = AN.playing ? '❚❚' : '▶';
  anEl('anLive').classList.toggle('on', AN.follow && !AN.playing);
}
function anTick(now){
  if (!AN.open){ AN.lastFrame=0; return; }
  if (AN.playing){
    const dt=AN.lastFrame?Math.min(.25,(now-AN.lastFrame)/1000):0, [a,b]=dataSpan();
    AN.tt=Math.min(b,(AN.tt??a)+dt*AN.speed);
    const w=(AN.x1??b)-(AN.x0??a) || 60;                         // pencere imleci takip eder
    if (AN.tt>(AN.x1??b) || AN.tt<(AN.x0??a)){ AN.x0=AN.tt-w*.7; AN.x1=AN.tt+w*.3; }
    if (AN.tt>=b){ AN.playing=false; }
    anTimeline();
  }
  AN.lastFrame=now;
}
function anSetup(){
  defaultPanels();
  anEl('anQ').oninput=anTree;
  document.querySelectorAll('[data-lay]').forEach(b=>b.onclick=()=>{ AN.layout=b.dataset.lay; document.querySelectorAll('[data-lay]').forEach(x=>x.classList.toggle('on',x===b)); AN.focus=Math.min(AN.focus,(AN.layout==='1'?1:AN.layout==='2'?2:4)-1); renderPanels(); });
  anEl('anFn').innerHTML=Object.entries(FILTERS).map(([k,f])=>`<option value="${k}">${f.name}</option>`).join('');
  const syncPar=()=>{ const F=FILTERS[anEl('anFn').value]; anEl('anParW').hidden=!F.p; if (F.p){ anEl('anParL').textContent=F.p[0]; anEl('anPar').value=F.p[1]; } };
  anEl('anFn').onchange=syncPar; syncPar();
  anEl('anMake').onclick=()=>{ const F=FILTERS[anEl('anFn').value]; const k=addDerived(anEl('anSrc').value, anEl('anFn').value, F.p?parseFloat(String(anEl('anPar').value).replace(',','.'))||F.p[1]:null); addToPanel(AN.focus,k); AN.sel=k; anTree(); };
  anEl('anAdd').onclick=()=>{ const k=AN.sel||anEl('anSrc').value; if (k) addToPanel(AN.focus,k); };
  anEl('anPlay').onclick=()=>{ const [a,b]=dataSpan(); if (!AN.playing && (AN.tt==null || AN.tt>=b-.2)) AN.tt=Math.max(a,(Events.get('BOOST').at??a)-10); AN.playing=!AN.playing; AN.follow=false;
    if (AN.playing && (AN.x0==null || AN.tt<AN.x0 || AN.tt>AN.x1)){ AN.x0=AN.tt-20; AN.x1=AN.tt+40; } anTimeline(); };
  anEl('anSpeed').onchange=()=>{ AN.speed=+anEl('anSpeed').value; };
  anEl('anSlider').oninput=()=>{ AN.playing=false; AN.follow=false; AN.tt=+anEl('anSlider').value; const w=(AN.x1??0)-(AN.x0??0)||60; if (AN.x0==null||AN.tt<AN.x0||AN.tt>AN.x1){ AN.x0=AN.tt-w/2; AN.x1=AN.tt+w/2; } anTimeline(); anDraw(); };
  anEl('anLive').onclick=()=>{ AN.follow=true; AN.playing=false; AN.tt=null; AN.x0=AN.x1=null; anTimeline(); anDraw(); };
  anEl('anFit').onclick=anFit;
  addEventListener('resize',()=>anDraw());
  const loop=now=>{ anTick(now); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  setInterval(()=>{ if (AN.open){ anDraw(); if (!AN.playing) anTimeline(); } }, 250);
}
function anToggle(open){
  AN.open=open; document.body.classList.toggle('an',open);
  if (open){ anTree(); renderPanels(); anTimeline(); }
}
