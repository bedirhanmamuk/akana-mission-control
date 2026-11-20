/* AKANA yer istasyonu · sade görev ekranı
   Veri ve grafik altyapısı Open MCT'dir: uçuş profili Open MCT plot görünümü olarak gömülür,
   gelişmiş çalışma alanı (ağaç, tablolar, düzenler, defter) tek tuşla açılır. */
"use strict";
const SKY = { tab:'alt', unit:'m', plotView:null, rtab:'log' };
const $$ = id => document.getElementById(id);
const UM = () => SKY.unit === 'ft' ? FT : 1;
const tS = t => { const x=Math.abs(t), m=Math.floor(x/60), s=Math.floor(x%60); return `T${t<0?'−':'+'}${pad2(m)}:${pad2(s)}`; };

const TABS = [['alt','İrtifa','plot.alt'],['vel','Hız','plot.vel'],['acc','İvme','plot.acc'],['p','Basınç','plot.p'],['tmp','Sıcaklık','plot.tmp'],['hum','Nem','plot.hum'],['rf','Sinyal','plot.rf']];

/* ---------- göstergeler ---------- */
function skyKpis(){
  const S=Store.get(), M=S.latest.main.fields, P=S.latest.payload.fields, B=S.latest.backup.fields, fa=(s,k)=>Store.fieldAge(s,k,UI.T);
  const cell=(l,val,d,u,age)=>{ const na=val==null, st=!na&&age!=null&&age>1.5; return `<div class="box kpi"><label>${l}</label><b class="${na?'na':st?'st':''}">${na?'—':fmt(val,d)}${na||!u?'':`<small>${u}</small>`}</b></div>`; };
  $$('kpis').innerHTML =
    `<div class="box kpi ph"><label>Durum</label><b>${CFG.phases[M.phase??0]}</b></div>`+
    cell('İrtifa (AGL)', M.alt==null?null:M.alt*UM(),0,SKY.unit,fa('main','alt'))+
    cell('Dikey hız', M.vz,1,'m/s',fa('main','vz'))+
    cell('Görev yükü', P.alt==null?null:P.alt*UM(),0,SKY.unit,fa('payload','alt'))+
    cell('Batarya', B.bat,2,'V',fa('backup','bat'))+
    `<div class="box kpi tm"><label>Zaman</label><b>${tS(UI.T)}</b></div>`;
}
function skyMax(){
  const S=Store.get(), vz=(S.series.main.vz||[]).reduce((m,p)=>Math.max(m,p[1]),0);
  const az=S.series.backup.az||[], ax=S.series.backup.ax||[], ay=S.series.backup.ay||[]; let acc=0;
  az.forEach((p,i)=>{ acc=Math.max(acc,Math.hypot(ax[i]?ax[i][1]:0,ay[i]?ay[i][1]:0,p[1])); });
  const tgt=CFG.mission.targetFt/FT, ap=Events.get('APOGEE').at!=null, dev=S.maxAlt?Math.abs(S.maxAlt-tgt)/tgt*100:null, u=SKY.unit;
  $$('maxr').innerHTML =
    `<div>Maks. irtifa (MSL)<b>${S.maxAlt?fmt((S.maxAlt+CFG.site.alt)*UM(),0)+' '+u:'—'}</b></div>`+
    `<div>Maks. irtifa (AGL)<b>${S.maxAlt?fmt(S.maxAlt*UM(),0)+' '+u:'—'}</b></div>`+
    `<div>Maks. dikey hız<b>${vz?fmt(vz,1)+' m/s':'—'}</b></div>`+
    `<div>Maks. ivme<b>${acc?fmt(acc,1)+' g':'—'}</b></div>`+
    `<div>Hedef sapması<b class="${!ap?'':dev<=15?'ok-t':'bad-t'}">${!ap?'—':'%'+fmt(dev,1)}</b></div>`;
}
function skyPhases(){
  const cur=Store.get().latest.main.fields.phase??0;
  const times=[-600,Events.get('BOOST').at,Flight.tYak,Events.get('APOGEE').at,Events.get('DESCENT').at,Events.get('PAYLOAD SEPARATION').at,Events.get('RECOVERY').at,Events.get('LANDED').at];
  $$('tl').innerHTML = CFG.phases.map((p,i)=>`<div class="ph ${i<cur?'done':i===cur?'now':''}"><i></i><div class="pill">${p}<span>${i<=cur&&times[i]!=null?tS(times[i]):''}</span></div></div>`).join('') +
    `<div class="ph safe"><i></i><div class="pill">Güvenli mod<span>pasif</span></div></div>`;
}
function skyLog(){
  if (SKY.rtab==='log') $$('log').innerHTML = Log.items().slice(-16).reverse().map(l=>`<div class="le ${l.sv}"><span class="tm">${clockOf(l.t)}</span><i></i><span class="tx">${l.msg}<span>${l.src}</span></span></div>`).join('');
  else $$('chk').innerHTML = compliance(UI.T).map(([l,v,c])=>`<div class="ck">${l}<b class="${c}-t">${v}${c==='ok'?' ✓':c==='bad'?' ✗':''}</b></div>`).join('');
}
function skyDet(){
  const S=Store.get(), M=S.latest.main.fields, B=S.latest.backup.fields, P=S.latest.payload.fields, live=Store.age('main',UI.T)<1;
  const v=(x,d,u)=>x==null?'<b class="na">N/A</b>':`<b>${fmt(x,d)}${u?' '+u:''}</b>`, acc=B.az!=null?Math.hypot(B.ax||0,B.ay||0,B.az):null;
  const fix=S.track.backup.at(-1)||S.track.main.at(-1), pfix=S.track.payload.at(-1), plost=pfix&&UI.T-pfix[0]>1.5;
  const rows=[
    ['Paket',`<b>#${S.latest.main.seq??'—'}</b>`],['Basınç',v(M.p,1,'hPa')],['Sıcaklık',v(M.temp,1,'°C')],['RSSI',live?`<b>${fmt(S.stats.main.rssi,0)} dBm</b>`:'<b class="na">N/A</b>'],
    ['GNSS',fix?`<b>${toLat(fix[2]).toFixed(5)}° ${toLon(fix[1]).toFixed(5)}°</b>`:'<b class="na">N/A</b>'],['Uydu',v(B.sats,0,'')],['İvme',v(acc,2,'g')],['Yönelim',B.pitch==null?'<b class="na">N/A</b>':`<b>${fmt(B.pitch,0)}° / ${fmt(B.yaw,0)}° / ${fmt(B.roll,0)}°</b>`],
    ['GY basınç',v(P.p,1,'hPa'),'pl'],['GY sıcaklık',v(P.temp,1,'°C'),'pl'],['GY nem',v(P.hum,0,'%'),'pl'],['GY konum',pfix?(plost?'<b class="warn-t">fix yok</b>':`<b>${toLat(pfix[2]).toFixed(5)}° ${toLon(pfix[1]).toFixed(5)}°</b>`):'<b class="na">N/A</b>','pl'],
  ];
  $$('det').innerHTML = rows.map(r=>`<div class="${r[2]||''}"><label>${r[0]}</label>${r[1]}</div>`).join('');
}
function skyStatus(){
  const S=Store.get(), sum=k=>SRC.reduce((a,s)=>a+S.stats[s][k],0);
  $$('sHz').textContent = SRC.map(s=>fmt(Store.hz(s,UI.T),1)).join(' · ')+' Hz';
  $$('sCrc').textContent = fmt(sum('crc'),0);
  $$('sLost').textContent = fmt(sum('lost'),0);
  const w=Log.items().slice().reverse().find(l=>l.sv!=='info'); $$('sWarn').textContent = w ? `${clockOf(w.t)} ${w.msg}` : '—';
}
function skyRender(){ skyKpis(); skyMax(); skyPhases(); skyLog(); skyDet(); skyStatus(); }

/* ---------- uçuş profili: gömülü Open MCT grafiği ---------- */
async function skyShowPlot(){
  const tab=TABS.find(t=>t[0]===SKY.tab), host=$$('plot');
  if (SKY.plotView){ SKY.plotView.destroy(); SKY.plotView=null; }
  host.innerHTML='<div class="plot-in"></div>';
  const [obj, root] = await Promise.all([openmct.objects.get({ namespace:NS, key:tab[2] }), openmct.objects.get({ namespace:NS, key:'root' })]);
  const path=[obj, root], provider=openmct.objectViews.get(obj, path).find(p => p.key==='plot-overlay') || openmct.objectViews.get(obj, path)[0];
  const view=provider.view(obj, path);
  view.show(host.firstChild, false, { renderWhenVisible: f => { requestAnimationFrame(f); return true; } });
  SKY.plotView=view;
}
function skySetup(){
  $$('ctabs').innerHTML = TABS.map(t=>`<button data-c="${t[0]}" role="tab" class="${t[0]===SKY.tab?'on':''}">${t[1]}</button>`).join('');
  $$('ctabs').onclick = e => { const b=e.target.closest('[data-c]'); if (!b || b.dataset.c===SKY.tab) return; SKY.tab=b.dataset.c; $$('ctabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); skyShowPlot(); };
  document.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { SKY.rtab=b.dataset.rt; document.querySelectorAll('[data-rt]').forEach(x=>x.classList.toggle('on',x===b)); $$('log').hidden=SKY.rtab!=='log'; $$('chk').hidden=SKY.rtab!=='chk'; skyLog(); });
  document.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => { SKY.unit=b.dataset.unit; document.querySelectorAll('[data-unit]').forEach(x=>x.classList.toggle('on',x===b)); skyRender(); });
  $$('mapFs').onclick = () => { const c=$$('mapCard'), big=c.classList.toggle('big'); $$('mapFs').textContent = big ? '✕' : '⤢'; $$('mapFs').setAttribute('aria-label', big ? 'Küçült' : 'Büyüt'); };
  // hakem ekranı (şartname 4.6.38: ayrı ekran)
  let refApi=null;
  $$('refBtn').onclick = () => { const r=$$('ref'); r.hidden=false; refApi=mountReferee($$('refBody')); };
  $$('refClose').onclick = () => { $$('ref').hidden=true; refApi&&refApi.destroy(); refApi=null; $$('refBody').innerHTML=''; };
  // Open MCT çalışma alanı
  $$('wsBtn').onclick = () => { const open=document.body.classList.toggle('ws'); $$('wsBtn').classList.toggle('on',open);
    location.hash = open ? '#/browse/akana:root/akana:ops' : '#/browse/akana:root'; };
  // tema: Open MCT teması yükleme anında seçilir, değişim sayfayı yeniler
  $$('themeBtn').onclick = () => { try { localStorage.setItem('akana.theme', THEME==='light'?'dark':'light'); } catch(e){} location.reload(); };
  $$('restart').onclick = () => location.reload();
  addEventListener('keydown', e => { if (e.key==='Escape'){ if (!$$('ref').hidden) $$('refClose').click(); else if ($$('mapCard').classList.contains('big')) $$('mapFs').click(); } });
  mountMap($$('mapHost'));
  mountAtt($$('attHost'));
  skyShowPlot();
  skyRender(); setInterval(skyRender, 400);
}
