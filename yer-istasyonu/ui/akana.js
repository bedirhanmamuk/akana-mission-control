/* AKANA yer istasyonu · Open MCT eklentisi + simülasyon çekirdeği */
"use strict";
/* ==========================================================================
   1. YAPILANDIRMA — görev, şartname kuralları (TEKNOFEST 2026, A3), kaynaklar
   ========================================================================== */
const CFG = {
  mission: { id:'AKN-A3-26-001', rocket:null, category:'A3 Yüksek İrtifa', motor:'Aerotech N3300', date:'19.11.2026', session:'#0007', targetFt:20000 },
  rules:   { minAltFt:15000, targetTol:0.15, sepMaxS:2, mainMinM:400, mainMaxM:600, linkMaxS:120, payloadMinHz:5 },
  site:    { lat:38.32597, lon:33.96313, alt:900, station:{ e:-420, n:-260 }, city:{ name:'Aksaray merkez', lat:38.3726, lon:34.0283 } },
  sources: {
    main:    { label:'Ana UKB',    short:'Ana',    model:'Sky Logic V2', fw:'2.4.1', mhz:'868,1', frame:68, offset:0.00, sensors:['Barometre','IMU','GPS','İvmeölçer','Jiroskop','Manyetometre'] },
    backup:  { label:'Yedek UKB',  short:'Yedek',  model:'Özgün UKB',    fw:'1.3.0', mhz:'869,5', frame:68, offset:0.07, sensors:['Barometre','IMU','GPS','İvmeölçer','Jiroskop'], absent:['Manyetometre'] },
    payload: { label:'Görev yükü', short:'G. yükü', model:'STM32F103',   fw:'0.9.2', mhz:'867,3', frame:42, offset:0.13, sensors:['Barometre','GPS','Sıcaklık','Nem','IMU'], absent:['Manyetometre'] },
  },
  phases: ['Rampa','Kalkış','Apogee yaklaşma','Apogee','Birincil paraşüt','Görev yükü ayrılma','İkincil paraşüt','Finiş'],
  hz: 5, activationT: -610, startT: 118,
};
const SRC = Object.keys(CFG.sources);
const FT = 3.28084, G = 9.80665, D2R = Math.PI/180;

/* ==========================================================================
   2. YARDIMCILAR
   ========================================================================== */
const $ = id => document.getElementById(id);
function fmt(v, d=1){
  if (v==null || !isFinite(v)) return 'N/A';
  const r = Math.abs(v).toFixed(d), neg = v<0 && Number(r)!==0, [i,f] = r.split('.');
  return (neg?'−':'') + i.replace(/\B(?=(\d{3})+(?!\d))/g,' ') + (f?','+f:'');
}
const pad2 = n => String(n).padStart(2,'0');
/* Zaman gösterimi kalkışa (T0) göredir. Canlı modda kalkış henüz algılanmadıysa oturum zamanı (S+) gösterilir. */
let TIME0 = 0, T0_KNOWN = true;
const tPre = () => T0_KNOWN ? 'T' : 'S';
const ts = t => { t -= TIME0; return tPre() + (t<0?'−':'+') + fmt(Math.abs(t),1); };
function tplus(t){ t -= TIME0; const x=Math.abs(t), m=Math.floor(x/60), s=(x%60).toFixed(1).padStart(4,'0').replace('.',','); return `${tPre()}${t<0?'−':'+'} ${String(m).padStart(3,'0')}:${s}`; }
function hash(x){ x = Math.sin(x*12.9898)*43758.5453; return x-Math.floor(x); }
const nz = (t,k,a) => (hash(t*7.13+k*91.7)-.5)*2*a;
const MPD = 111320, CL = Math.cos(CFG.site.lat*D2R);
const toE = lon => (lon-CFG.site.lon)*MPD*CL, toN = lat => (lat-CFG.site.lat)*MPD;
const toLat = n => CFG.site.lat + n/MPD,      toLon = e => CFG.site.lon + e/(MPD*CL);
function setActive(sel, el){ document.querySelectorAll(sel).forEach(x => x.classList.toggle('on', x===el)); }

/* ==========================================================================
   3. UÇUŞ MODELİ (simülasyon kaynağının "gerçeği"). 20 000 ft hedef profili.
      Şartname: 4.1.7 ayrılma ≤ 2 s, 4.1.8 ikincil 400–600 m, 4.1.35 rampa 85°.
   ========================================================================== */
const Flight = (() => {
  const tb=4, vb=326.8, a=vb/tb, tap=tb+vb/G, tYak=tb+(vb-50)/G;
  const tDrogue=tap+1.0, tSep=tap+1.3, vD=25, vMain=6, vPl=13, mainAlt=500;
  const hD = 6096 - .5*G*1;                       // drogue anındaki irtifa
  const tMain = tDrogue + (hD-mainAlt)/vD;
  const tLand = tMain + mainAlt/vMain;
  const hSep = hD - vD*(tSep-tDrogue), tLandPl = tSep + hSep/vPl;
  const pres = h => 1013.25*Math.pow(1-2.25577e-5*(h+CFG.site.alt),5.25588);
  const tempC = h => 15-.0065*(h+CFG.site.alt);
  function rocket(t){
    let h, vz, az;
    if (t<=0){ h=0; vz=0; az=1; }
    else if (t<tb){ h=.5*a*t*t; vz=a*t; az=a/G+1; }
    else if (t<=tap){ const u=t-tb; h=.5*a*tb*tb+vb*u-.5*G*u*u; vz=vb-G*u; az=-.08; }
    else if (t<tDrogue){ const u=t-tap; h=6096-.5*G*u*u; vz=-G*u; az=0; }
    else if (t<tMain){ h=hD-vD*(t-tDrogue); vz=-vD; az=1; }
    else if (t<tLand){ h=mainAlt-vMain*(t-tMain); vz=-vMain; az=1; }
    else { h=0; vz=0; az=1; }
    const asc = Math.max(0, Math.min(t,tap));
    let e = .012*(t<=tap?h:6096), n = .006*(t<=tap?h:6096);
    if (t>tap){ const u=Math.min(t,tLand)-tap; e+=5*u; n-=1.2*u; }
    const vh = t<=0||t>=tLand ? 0 : (t<=tap ? Math.abs(vz)*.02 : 5.2);
    let phase;
    if (t<0) phase=0; else if (t<tYak) phase=1; else if (t<tap) phase=2; else if (t<tDrogue) phase=3;
    else if (t<tSep) phase=4; else if (t<tMain) phase=5; else if (t<tLand) phase=6; else phase=7;
    return { h, vz, vh, az, e, n, phase, asc };
  }
  function payload(t){
    if (t<tSep) return Object.assign(rocket(t), { sep:false });
    const r0=rocket(tSep), u=Math.min(t,tLandPl)-tSep;
    const h=Math.max(0, hSep-vPl*(t-tSep)), vz=h>0?-vPl:0;
    return { h, vz, vh:h>0?6.4:0, az:1, e:r0.e+6.2*u, n:r0.n-1.8*u, phase:rocket(t).phase, sep:true };
  }
  function attitude(t){        // NED / gövde X burun: pitch yataydan (Şekil 3.1)
    let p,y,r;
    if (t<=0){ p=85; y=231; r=0; }
    else if (t<tap){ p=85-70*Math.pow(t/tap,2.2); y=231+.15*t; r=((t*24)%360)-180; }
    else if (t<tap+1.5){ p=15-55*(t-tap)/1.5; y=236+2*(t-tap); r=-120+6*(t-tap); }
    else { p=-4+12*Math.sin(t*1.25); y=(240+4*(t-tap))%360; r=(((t-tap)*6)%360)-180; }
    return { p:p+nz(t,30,.4), y:y+nz(t,31,.6), r:r+nz(t,32,.5) };
  }
  const expected = t => t<=0 ? 0 : t<=tap ? rocket(t).h*1.03 : Math.max(0, 6279-27*(t-tap));
  const mach = (v,h) => v/(20.05*Math.sqrt(tempC(h)+273.15));
  return { tb, tap, tYak, tDrogue, tSep, tMain, tLand, tLandPl, rocket, payload, attitude, expected, pres, tempC, mach };
})();

/* ==========================================================================
   4. SİMÜLASYON ADAPTÖRÜ — her kaynak için 5 Hz paket üretir. Örnek arızalar:
      CRC hatası (ana), sıra dışı paket ve kesinti (yedek), tekrar eden paket
      ve GPS kaybı (görev yükü). Gerçek sistemde yerini seri port adaptörü alır.
   ========================================================================== */
const SimAdapter = (() => {
  const plGpsLost = t => t>126 && t<141;
  const bkDrop    = t => t>158 && t<161.5;
  const seqOf = t => Math.round((t-CFG.activationT)*CFG.hz);
  function fields(src, t){
    const r=Flight.rocket(t), at=Flight.attitude(t);
    if (src==='main') return {
      alt:r.h+nz(t,1,2), vz:r.vz+nz(t,3,.6), p:Flight.pres(r.h)+nz(t,8,.3), temp:Flight.tempC(r.h)+2.5+nz(t,9,.2),
      az:r.az+nz(t,7,.12), lat:toLat(r.n+nz(t,40,1.2)), lon:toLon(r.e+nz(t,41,1.2)), sats:13, phase:r.phase, bat:8.06-.00008*(t+900) };
    if (src==='backup') return {
      alt:r.h+nz(t,2,3), vz:r.vz+nz(t,4,.7), vh:r.vh+nz(t,5,.3),
      ax:nz(t,5,.15)+(t>0&&t<Flight.tb?.3:0), ay:nz(t,6,.15), az:r.az+nz(t,7,.12),
      pitch:at.p, yaw:((at.y%360)+360)%360, roll:at.r,
      lat:toLat(r.n+nz(t,42,.9)), lon:toLon(r.e+nz(t,43,.9)), gpsAlt:r.h+CFG.site.alt+nz(t,20,3), sats:14, hacc:2.1,
      phase:r.phase, bat:7.81-.00007*(t+900) };
    const p=Flight.payload(t), lost=plGpsLost(t);
    return { alt:p.h+nz(t,10,2), vz:p.vz+nz(t,11,.5), vh:p.vh, p:Flight.pres(p.h)+.6+nz(t,12,.3),
      temp:Flight.tempC(p.h)+4+nz(t,13,.2), hum:Math.max(5,40-.004*p.h)+nz(t,14,.5),
      lat:lost?null:toLat(p.n+nz(t,44,1.5)), lon:lost?null:toLon(p.e+nz(t,45,1.5)), sats:lost?0:11, hacc:lost?null:3.4,
      sep:p.sep?1:0, bat:7.64-.00006*(t+900) };
  }
  function rssi(src, t){
    const h = src==='payload' ? Flight.payload(t).h : Flight.rocket(t).h, k=Math.round(t);
    return ({main:-68,backup:-71,payload:-73})[src] - h/({main:900,backup:850,payload:800})[src] + nz(k,13+SRC.indexOf(src),.8);
  }
  function make(src, k){
    const t = CFG.activationT + 38 + k/CFG.hz + CFG.sources[src].offset;   // UKB aktifleştirildikten 38 s sonra ilk paket
    const seq = k;
    return { source_id:src, seq, ts:t, rx:t+.012, crc:true, rssi:rssi(src,t), snr:null, fields:fields(src,t) };
  }
  const cursor = { main:0, backup:0, payload:0 };
  function reset(){ for (const s of SRC) cursor[s]=0; }
  // [t0,t1) aralığında alınan paketler; arızalar burada uygulanır
  function pull(t1){
    const out=[];
    for (const src of SRC){
      for(;;){
        const pkt = make(src, cursor[src]);
        if (pkt.ts > t1) break;
        cursor[src]++;
        const k = pkt.seq;
        if (src==='backup' && bkDrop(pkt.ts)) continue;                       // kesinti: paket yok
        if (src==='main' && hash(k*3.1)<.006) pkt.crc=false;                  // CRC hatası
        if (src==='backup' && hash(k*5.7)<.004){                              // sıra dışı: bir sonrakiyle yer değiştir
          const nxt = make(src, cursor[src]); if (nxt.ts<=t1 && !bkDrop(nxt.ts)){ cursor[src]++; out.push(nxt); pkt.rx = nxt.rx + .01; }
        }
        out.push(pkt);
        if (src==='payload' && hash(k*2.3)<.004) out.push(Object.assign({}, pkt, { rx:pkt.rx+.03 }));  // tekrar eden paket
      }
    }
    return out.sort((a,b)=>a.rx-b.rx);
  }
  return { pull, reset, plGpsLost, bkDrop };
})();

/* ==========================================================================
   5. OLAY KAYDI
   ========================================================================== */
const Log = (() => {
  const items=[]; let filter='all'; const last={};
  function add(t, sv, src, msg, key){
    if (key){ if (last[key]!=null && t-last[key]<10) return; last[key]=t; }   // aynı türden kayıtları 10 s'de bir
    items.push({ t, sv, src, msg, fresh:true }); if (items.length>400) items.shift();
  }
  function render(){
    const lab={info:'BİLGİ',warn:'UYARI',err:'HATA',crit:'KRİTİK'};
    const rows = items.filter(l => filter==='all' || l.sv===filter).slice(-40).reverse().slice(0,26);
    $('log').innerHTML = rows.map(l => `<div class="lr ${l.fresh?'new':''}"><span class="tm">${ts(l.t)}</span><span class="sv ${l.sv}">${lab[l.sv]}</span><span class="tx">${l.msg}</span><span class="src">${l.src}</span></div>`).join('');
    items.forEach(l => l.fresh=false);
  }
  return { add, render, items:()=>items, setFilter:f=>{filter=f; render();}, clear:()=>{items.length=0; for(const k in last) delete last[k];} };
})();

/* ==========================================================================
   6. DOĞRULAMA + VERİ DEPOSU — paketler doğrulanır, kaynaklar ayrı tutulur.
      Kurallar: CRC, tekrar eden sıra no, sıra dışı paket, sıra boşluğu, değer sınırı.
   ========================================================================== */
function pushSorted(arr,item){ if (!arr.length || arr[arr.length-1][0]<=item[0]) { arr.push(item); return; } let i=arr.length-1; while (i>0 && arr[i-1][0]>item[0]) i--; arr.splice(i,0,item); }
const RANGES = { alt:[-200,30000], vz:[-400,600], p:[50,1100], temp:[-60,85], hum:[0,100], lat:[37.8,38.9], lon:[33.4,34.6], bat:[5,13] };
const Store = (() => {
  let S;
  function reset(){
    S = { latest:{}, series:{}, track:{}, stats:{}, maxAlt:0, packets:[] };
    for (const s of SRC){
      S.latest[s]={ fields:{}, ft:{}, t:null, seq:null };
      S.series[s]={}; S.track[s]=[];
      S.stats[s]={ total:0, lost:0, dup:0, crc:0, ooo:0, rejected:0, lastSeq:-1, seen:new Set(), rx:[], lastRx:null, first:null, rssi:null };
    }
  }
  function validate(pkt){
    const st=S.stats[pkt.source_id], src=CFG.sources[pkt.source_id].label;
    if (!pkt.crc){ st.crc++; Log.add(pkt.rx,'err',src,`CRC hatası, paket ${pkt.seq} atıldı.`,'crc'+pkt.source_id); return false; }
    if (st.seen.has(pkt.seq)){ st.dup++; Log.add(pkt.rx,'warn',src,`Tekrar eden paket ${pkt.seq} atıldı.`,'dup'+pkt.source_id); return false; }
    st.seen.add(pkt.seq); if (st.seen.size>3000) st.seen.delete(st.seen.values().next().value);
    if (pkt.seq < st.lastSeq){ st.ooo++; st.lost=Math.max(0,st.lost-1); Log.add(pkt.rx,'warn',src,`Sıra dışı paket ${pkt.seq}, zaman damgasıyla yerleştirildi.`,'ooo'+pkt.source_id); }
    else if (st.lastSeq>=0 && pkt.seq > st.lastSeq+1){ const gap=pkt.seq-st.lastSeq-1; st.lost+=gap; if (gap>3) Log.add(pkt.rx,'err',src,`${gap} paket kayıp (sıra ${st.lastSeq+1}–${pkt.seq-1}).`); }
    for (const k in pkt.fields){ const v=pkt.fields[k], r=RANGES[k]; if (v!=null && r && (v<r[0]||v>r[1])){ pkt.fields[k]=null; st.rejected++; Log.add(pkt.rx,'warn',src,`${k} sınır dışı, değer geçersiz sayıldı.`,'rng'+k); } }
    return true;
  }
  function ingest(pkt){
    const sid=pkt.source_id, st=S.stats[sid];
    if (!validate(pkt)) return;
    if (st.first==null){ st.first=pkt.rx; Log.add(pkt.rx,'info',CFG.sources[sid].label,`${CFG.sources[sid].label} verisi alınmaya başlandı.`); }
    st.total++; st.lastSeq=Math.max(st.lastSeq,pkt.seq); st.lastRx=pkt.rx; st.rssi=pkt.rssi; st.rx.push(pkt.rx); while (st.rx.length && st.rx[0]<pkt.rx-4) st.rx.shift();
    const L=S.latest[sid], newer = L.t==null || pkt.ts>=L.t;
    for (const k in pkt.fields){ const v=pkt.fields[k]; if (v!=null && newer){ L.fields[k]=v; L.ft[k]=pkt.ts; } }
    if (newer){ L.t=pkt.ts; L.seq=pkt.seq; L.raw=pkt; }
    if (pkt.ts>=-30){
      const ser=S.series[sid];
      for (const k of ['alt','vz','vh','p','temp','hum','ax','ay','az']) if (pkt.fields[k]!=null) pushSorted(ser[k]||(ser[k]=[]),[pkt.ts,pkt.fields[k]]);
      pushSorted(ser.rssi||(ser.rssi=[]),[pkt.ts,pkt.rssi]);
      const f=pkt.fields; if (f.lat!=null && f.lon!=null) pushSorted(S.track[sid],[pkt.ts,toE(f.lon),toN(f.lat),f.alt]);
      if (sid!=='payload' && f.alt!=null) S.maxAlt=Math.max(S.maxAlt,f.alt);
      S.packets.push([pkt.ts,sid,pkt.seq,f.alt,f.vz,f.p,f.temp,f.lat,f.lon]); if (S.packets.length>20000) S.packets.shift();
    }
  }
  const hz = (sid,now) => S.stats[sid].rx.filter(t => t>now-2 && t<=now+.05).length/2;
  const age = (sid,now) => S.stats[sid].lastRx==null ? null : Math.max(0, now-S.stats[sid].lastRx);
  function fieldAge(sid,key,now){ const t=S.latest[sid].ft[key]; return t==null?null:Math.max(0,now-t); }
  return { reset, ingest, hz, age, fieldAge, get:()=>S };
})();

/* ==========================================================================
   7. OLAY MOTORU — olaylar yapılandırılmış tanımlarla, mümkünse iki kaynakla
      doğrulanır. Tek kaynaktan gelen bildirim "tek kaynak" olarak kalır.
   ========================================================================== */
const Events = (() => {
  const DEF = [
    { code:'PRE-LAUNCH',         manual:true, t:-600, who:'Operatör' },
    { code:'BOOST',              phase:1, need:['main','backup'] },
    { code:'ASCENT',             burnout:true, need:['main','backup'] },
    { code:'APOGEE',             phase:3, need:['main','backup'] },
    { code:'DESCENT',            phase:4, need:['main','backup'] },
    { code:'PAYLOAD SEPARATION', sep:true, need:['payload'], confirm:'track' },
    { code:'RECOVERY',           phase:6, need:['main','backup'] },
    { code:'LANDED',             phase:7, need:['main','backup'] },
    { code:'RECOVERED',          manual:true, t:null, who:'Kurtarma ekibi' },
  ];
  let E;
  function reset(){ E = DEF.map(d => ({ ...d, status: d.manual && d.t!=null ? 'ok':'pend', at: d.manual ? d.t : null, by:new Set(), alt:null })); }
  function check(sid, pkt){
    const f=pkt.fields, t=pkt.ts, S=Store.get();
    for (const e of E){
      if (e.manual || e.status==='ok' || !e.need.includes(sid)) continue;
      let hit=false;
      if (e.phase!=null) hit = f.phase!=null && f.phase>=e.phase;
      if (e.burnout) hit = t>0 && f.az!=null && f.az<0.2;
      if (e.sep) hit = f.sep===1;
      if (!hit || e.by.has(sid)) continue;
      e.by.add(sid); if (e.at==null){ e.at=t; e.alt = S.latest.main.fields.alt; }
      const names=[...e.by].map(s=>CFG.sources[s].label).join(' + ');
      if (e.by.size >= e.need.length && !e.confirm){ e.status='ok'; Log.add(t, e.code==='APOGEE'||e.code==='LANDED'?'warn':'info', names, `${e.code} doğrulandı (${e.by.size}/${e.need.length} kaynak).`); }
      else if (e.status==='pend'){ e.status='one'; Log.add(t,'info',names,`${e.code} bildirildi, doğrulama bekleniyor.`); }
    }
    const sepE=E.find(e=>e.code==='PAYLOAD SEPARATION');
    if (sepE.status==='one'){
      const a=S.track.main.at(-1), b=S.track.payload.at(-1);
      if (a && b && Math.hypot(a[1]-b[1],a[2]-b[2])>50){ sepE.status='ok'; Log.add(t,'info','Konum','PAYLOAD SEPARATION doğrulandı, iki GPS izi ayrıştı.'); }
    }
  }
  function markRecovered(now){ const e=E.find(x=>x.code==='RECOVERED'); if (e.status==='ok') return; e.status='ok'; e.at=now; Log.add(now,'info','Operatör','RECOVERED elle işaretlendi.'); }
  const get = code => E.find(e=>e.code===code);
  return { reset, check, markRecovered, get, all:()=>E };
})();

/* ==========================================================================
   8. ŞARTNAME KONTROLLERİ (TEKNOFEST 2026, A3) — ekip takibi içindir;
      resmî irtifa hakem altimetresinden okunur (7.3.9).
   ========================================================================== */
function compliance(now){
  const S=Store.get(), R=CFG.rules, tgt=CFG.mission.targetFt/FT;
  const first = S.stats.main.first ?? S.stats.backup.first;
  const link = first==null ? null : first-CFG.activationT;
  const plHz = Store.hz('payload',now);
  const ap=Events.get('APOGEE'), sep=Events.get('PAYLOAD SEPARATION'), rec=Events.get('RECOVERY');
  const dev = Math.abs(S.maxAlt-tgt)/tgt;
  return [
    ['İletişim ≤ 2 dk',      link==null?'—':fmt(link,0)+' s', link==null?'na':link<=R.linkMaxS?'ok':'bad'],
    ['Görev yükü ≥ 5 Hz',    fmt(plHz,1)+' Hz', plHz>=R.payloadMinHz?'ok':'bad'],
    ['Asgari 15 000 ft',     S.maxAlt*FT>=R.minAltFt?fmt(S.maxAlt*FT,0)+' ft':'—', S.maxAlt*FT>=R.minAltFt?'ok':'na'],
    ['Hedef ±%15',           ap.at==null?'—':'%'+fmt(dev*100,1), ap.at==null?'na':dev<=R.targetTol?'ok':'bad'],
    ['Ayrılma ≤ 2 s',        sep.at==null||ap.at==null?'—':fmt(sep.at-ap.at,1)+' s', sep.at==null?'na':(sep.at-ap.at)<=R.sepMaxS?'ok':'bad'],
    ['İkincil 400–600 m',    rec.at==null?'bekleniyor':fmt(rec.alt,0)+' m', rec.at==null?'na':(rec.alt>=R.mainMinM&&rec.alt<=R.mainMaxM)?'ok':'bad'],
  ];
}



/* ---------- 3B yönelim (three.js) ---------- */
function createAtt3D(root){ const $=id=>root.querySelector('#'+id);
  let R=null;
  function init(){
    const host=$('r3d');
    try {
      if (!window.THREE) throw new Error('three.js yok');
      const W=host.clientWidth, H=host.clientHeight;
      const rd=new THREE.WebGLRenderer({ antialias:true, alpha:true }); rd.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); rd.setSize(W,H); host.prepend(rd.domElement);
      const sc=new THREE.Scene(), cam=new THREE.PerspectiveCamera(30,W/H,.1,100); cam.position.set(4.6,.9,5.4); cam.lookAt(0,-.05,0);
      sc.add(new THREE.HemisphereLight(0xd6dcff,0x101420,.85));
      const dl=new THREE.DirectionalLight(0xffffff,1); dl.position.set(2.5,4,3); sc.add(dl);
      const rim=new THREE.DirectionalLight(0x9b5cff,.45); rim.position.set(-3,1.5,-2); sc.add(rim);
      const gy=-1.25, grid=new THREE.GridHelper(4,8,0x2a4a7a,0x16305a); grid.position.y=gy; sc.add(grid);
      const ring=new THREE.Mesh(new THREE.RingGeometry(1.95,1.97,96),new THREE.MeshBasicMaterial({color:0x34405a,side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; ring.position.y=gy+.002; sc.add(ring);
      const north=new THREE.Mesh(new THREE.ConeGeometry(.06,.18,3),new THREE.MeshBasicMaterial({color:0x9b5cff})); north.rotation.x=-Math.PI/2; north.position.set(0,gy+.01,-2.1); sc.add(north);
      const vref=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,gy,0),new THREE.Vector3(0,1.25,0)]),new THREE.LineDashedMaterial({color:0x3a4866,dashSize:.06,gapSize:.05})); vref.computeLineDistances(); sc.add(vref);
      const head=new THREE.Group(), tilt=new THREE.Group(), spin=new THREE.Group(); sc.add(head); head.add(tilt); tilt.add(spin); head.scale.setScalar(.8); head.position.y=.1;
      const metal=new THREE.MeshStandardMaterial({color:0xd8dde6,metalness:.35,roughness:.42});
      spin.add(new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,1.5,40),metal));
      const pts=[]; for (let i=0;i<=16;i++){ const y=i/16*.46; pts.push(new THREE.Vector2(.105*Math.sqrt(Math.max(0,1-(y/.46)**1.6)),y)); }
      const nose=new THREE.Mesh(new THREE.LatheGeometry(pts,40),new THREE.MeshStandardMaterial({color:0x221a3a,metalness:.3,roughness:.45})); nose.position.y=.75; spin.add(nose);
      const bandMat=new THREE.MeshStandardMaterial({color:0x8a4dff,metalness:.55,roughness:.35,emissive:0x2a0f55});
      const band=new THREE.Mesh(new THREE.CylinderGeometry(.107,.107,.07,40),bandMat); band.position.y=.42; spin.add(band);
      const band2=band.clone(); band2.position.y=-.18; band2.scale.set(1,.5,1); spin.add(band2);
      const sh=new THREE.Shape(); sh.moveTo(0,0); sh.lineTo(.2,-.07); sh.lineTo(.2,-.2); sh.lineTo(0,-.32); sh.lineTo(0,0);
      const fg=new THREE.ExtrudeGeometry(sh,{depth:.014,bevelEnabled:false}), fm=new THREE.MeshStandardMaterial({color:0x2c2448,metalness:.3,roughness:.5});
      for (let i=0;i<4;i++){ const g=new THREE.Group(); g.rotation.y=i*Math.PI/2; const f=new THREE.Mesh(fg,fm); f.position.set(.1,-.4,-.007); g.add(f); spin.add(g); }
      const noz=new THREE.Mesh(new THREE.CylinderGeometry(.06,.085,.1,32),new THREE.MeshStandardMaterial({color:0x3b4250,metalness:.6,roughness:.4})); noz.position.y=-.8; spin.add(noz);
      tilt.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(0,1.2,0),.3,0x5aa9ff,.08,.05));
      const shadow=new THREE.Mesh(new THREE.CircleGeometry(.5,40),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.22})); shadow.rotation.x=-Math.PI/2; shadow.position.y=gy+.003; sc.add(shadow);
      const place=(id,v)=>{ const p=v.clone().project(cam), e=$(id); e.style.left=((p.x+1)/2*W)+'px'; e.style.top=((1-p.y)/2*H)+'px'; };
      place('cK',new THREE.Vector3(0,gy,-2.35)); place('cG',new THREE.Vector3(0,gy,2.3)); place('cD',new THREE.Vector3(2.3,gy,0)); place('cB',new THREE.Vector3(-2.3,gy,0));
      R={ rd, sc, cam, head, tilt, spin, shadow, p:85, y:231, r:0 };
    } catch(err){ $('r3dfb').hidden=false; ['cK','cD','cG','cB'].forEach(i=>$(i).hidden=true); }
  }
  function render(){
    const B=Store.get().latest.backup.fields; if (B.pitch==null) return;
    $('aP').textContent=fmt(B.pitch,1)+'°'; $('aY').textContent=fmt(B.yaw,1)+'°'; $('aR').textContent=fmt(B.roll,1)+'°'; $('aD').textContent=fmt(90-B.pitch,1)+'°';
    if (!R) return;
    const k=.25, dy=((B.yaw-R.y+540)%360)-180; R.p+=(B.pitch-R.p)*k; R.y+=dy*k; R.r+=(B.roll-R.r)*k;
    R.head.rotation.y=-R.y*D2R; R.tilt.rotation.x=-(90-R.p)*D2R; R.spin.rotation.y=R.r*D2R;
    const off=Math.cos(R.p*D2R)*.55; R.shadow.position.x=Math.sin(R.y*D2R)*off; R.shadow.position.z=-Math.cos(R.y*D2R)*off; R.shadow.scale.set(1+Math.abs(off),1,1);
    R.rd.render(R.sc,R.cam);
  }
  return { init, render };
}
/* ---------- harita (çevrimdışı karolar, Aksaray) ---------- */
function createMapView(root){ const $=id=>root.querySelector('#'+id);
  const svg=$('map'), tilesG=$('tiles'), ovG=$('ov'); let tileKey='';
  function tileLL(x,y,z){ const n=2**z; return [Math.atan(Math.sinh(Math.PI*(1-2*y/n)))/D2R, x/n*360-180]; }
  function buildTiles(z){
    const key=UI.layer+z; if (key===tileKey) return; tileKey=key;
    const base = UI.layer==='std' ? TILES.gray : TILES.sat;
    const img = (set,k)=>{ const [zz,x,y]=k.split('/').map(Number); if (zz!==z) return ''; const [la0,lo0]=tileLL(x,y,z), [la1,lo1]=tileLL(x+1,y+1,z);
      const e0=toE(lo0), n0=toN(la0), e1=toE(lo1), n1=toN(la1);
      return `<image href="${set[k]}" x="${e0.toFixed(1)}" y="${(-n0).toFixed(1)}" width="${(e1-e0+.6).toFixed(1)}" height="${(n0-n1+.6).toFixed(1)}" preserveAspectRatio="none"/>`; };
    tilesG.innerHTML = `<g filter="${UI.layer==='std'?'url(#fStd)':'url(#fSat)'}">${Object.keys(base).map(k=>img(base,k)).join('')}</g><g filter="url(#fRef)">${Object.keys(TILES.ref).map(k=>img(TILES.ref,k)).join('')}</g>`;
  }
  function lastFix(sid){ const tr=Store.get().track[sid]; return tr.length?tr[tr.length-1]:null; }
  function render(){
    const S=Store.get(), MW=svg.clientWidth||866, MH=svg.clientHeight||484; svg.setAttribute('viewBox',`0 0 ${MW} ${MH}`);
    const sepAt=Events.get('PAYLOAD SEPARATION').at, trR=S.track.main.filter(p=>p[0]>=TIME0-1), trP=sepAt==null?[]:S.track.payload.filter(p=>p[0]>=sepAt-1);
    const st=CFG.site.station, xs=[0,st.e,...trR.map(p=>p[1]),...trP.map(p=>p[1])], ys=[0,st.n,...trR.map(p=>p[2]),...trP.map(p=>p[2])];
    let minx=Math.min(...xs)-250, maxx=Math.max(...xs)+250, miny=Math.min(...ys)-200, maxy=Math.max(...ys)+200;
    if (maxx-minx<1800){ const m=(minx+maxx)/2; minx=m-900; maxx=m+900; }
    const k=Math.min((MW-70)/(maxx-minx),(MH-90)/(maxy-miny))*UI.zoom, cx=(minx+maxx)/2, cy=(miny+maxy)/2;
    const ox=MW/2, oy=MH/2-10, X=e=>ox+(e-cx)*k, Y=n=>oy-(n-cy)*k;
    buildTiles(959.6*k>=200?15:14);
    tilesG.setAttribute('transform',`translate(${(ox-cx*k).toFixed(2)} ${(oy+cy*k).toFixed(2)}) scale(${k.toFixed(5)})`);
    const path = pts => pts.map((p,i)=>`${i?'L':'M'}${X(p[1]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join('');
    let c='';
    // rampa, istasyon
    c+=`<rect x="${X(0)-5}" y="${Y(0)-5}" width="10" height="10" fill="none" stroke="#e3e8ef" stroke-width="1.5"/><text x="${X(0)+10}" y="${Y(0)+16}" fill="#c3ccd8" font-size="11" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">Rampa</text>`;
    c+=`<path d="M${X(st.e)} ${Y(st.n)-7} l6 11 h-12z" fill="none" stroke="#e3e8ef" stroke-width="1.5"/><text x="${X(st.e)-10}" y="${Y(st.n)+18}" fill="#c3ccd8" font-size="11" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" text-anchor="end">Yer istasyonu</text>`;
    // rotalar: roket düz mavi, görev yükü kesikli turuncu, GPS boşlukları kesik
    c+=`<path d="${path(trR)}" fill="none" stroke="#5aa9ff" stroke-width="2.2" stroke-linejoin="round"/>`;
    let seg=[], segs=[]; trP.forEach((p,i)=>{ if (i && p[0]-trP[i-1][0]>1.2){ segs.push(seg); seg=[]; } seg.push(p); }); if (seg.length) segs.push(seg);
    segs.forEach(sg=>c+=`<path d="${path(sg)}" fill="none" stroke="#ff9b3d" stroke-width="2" stroke-dasharray="6 4"/>`);
    const r=lastFix('main'), p=lastFix('payload'), sep=Events.get('PAYLOAD SEPARATION').at!=null;
    if (r) c+=`<line x1="${X(st.e)}" y1="${Y(st.n)}" x2="${X(r[1])}" y2="${Y(r[2])}" stroke="#62a4ff" stroke-opacity=".55" stroke-dasharray="2 4"/>`;
    if (r && p && sep){
      const d=Math.hypot(r[1]-p[1],r[2]-p[2],(S.latest.main.fields.alt||0)-(S.latest.payload.fields.alt||0)), mx=X(p[1])+(X(r[1])-X(p[1]))*.4, my=Y(p[2])+(Y(r[2])-Y(p[2]))*.4+26;
      c+=`<line x1="${X(r[1])}" y1="${Y(r[2])}" x2="${X(p[1])}" y2="${Y(p[2])}" stroke="#e3e8ef" stroke-opacity=".35" stroke-dasharray="3 3"/>`;
      UI.dist=d;
    } else UI.dist=null;
    if (r){ c+=`<circle cx="${X(r[1])}" cy="${Y(r[2])}" r="13" fill="#4c9dff" fill-opacity=".13"/><circle cx="${X(r[1])}" cy="${Y(r[2])}" r="6" fill="#4c9dff" stroke="#090d14" stroke-width="2"/><g transform="translate(${X(r[1])-64} ${Y(r[2])+4})"><rect y="-10" width="50" height="20" rx="5" fill="rgba(6,14,30,.88)" stroke="#4c9dff" stroke-opacity=".6"/><text x="25.0" y="4" fill="#e8eefb" font-size="11.5" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">Roket</text></g>`; }
    if (p && sep){ const age=UI.T-p[0], stale=age>1.5, px=X(p[1]), py=Y(p[2]);
      c+= stale ? `<path d="M${px} ${py-8} L${px+8} ${py+6} L${px-8} ${py+6}Z" fill="none" stroke="#ff9b3d" stroke-width="1.6" stroke-dasharray="3 2"/><text x="${px+14}" y="${py+46}" fill="#f2b84b" font-size="11" font-family="Menlo,Consolas,monospace">son bilinen · ${fmt(age,1)} s önce</text>`
                : `<path d="M${px} ${py-9} L${px+9} ${py+7} L${px-9} ${py+7}Z" fill="#ff9b3d" stroke="#081226" stroke-width="1.5"/>`;
      c+=`<g transform="translate(${px+14} ${py+20})"><rect y="-10" width="80" height="20" rx="5" fill="rgba(6,14,30,.88)" stroke="#ff9b3d" stroke-opacity=".6"/><text x="40.0" y="4" fill="#e8eefb" font-size="11.5" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">Görev yükü</text></g>`; }
    { const sel = UI.sel==='main' ? r : (sep ? p : null);
      if (sel && MW>520){ const F=S.latest[UI.sel].fields, vh=UI.sel==='main'?S.latest.backup.fields.vh:F.vh, v=vh!=null&&F.vz!=null?Math.hypot(vh,F.vz):null, bx=Math.min(X(sel[1])+16,MW-162), by=Math.max(8,Y(sel[2])-78);
        c+=`<g transform="translate(${bx} ${by})"><rect width="150" height="62" rx="7" fill="rgba(6,14,30,.94)" stroke="#2b4a7a"/><text x="12" y="20" fill="#e8eefb" font-size="12.5" font-weight="600" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${UI.sel==='main'?'Roket':'Görev yükü'}</text><text x="12" y="38" fill="#9db0cf" font-size="11.5" font-family="Menlo,Consolas,monospace">İrtifa: ${fmt(F.alt,0)} m</text><text x="12" y="54" fill="#9db0cf" font-size="11.5" font-family="Menlo,Consolas,monospace">Hız: ${v==null?'N/A':fmt(v,1)+' m/s'}</text></g>`; } }
    // şehir yönü
    const ce=toE(CFG.site.city.lon), cn=toN(CFG.site.city.lat), sx=X(ce), sy=Y(cn);
    if (sx>20 && sx<MW-60 && sy>20 && sy<MH-30) c+=`<circle cx="${sx}" cy="${sy}" r="4" fill="#9b5cff"/><text x="${sx+8}" y="${sy+4}" fill="#cdb4ff" font-size="11.5" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-weight="600">${CFG.site.city.name}</text>`;
    else { const ang=Math.atan2(-(cn-cy),ce-cx), ex=Math.min(MW-60,Math.max(30,ox+Math.cos(ang)*600)), ey=Math.min(MH-40,Math.max(70,oy+Math.sin(ang)*600));
      c+=`<g transform="translate(${ex} ${ey})"><path d="M0 0 l-12 -5 l3 5 l-3 5z" transform="rotate(${ang/D2R})" fill="#9b5cff"/><text x="-16" y="-10" text-anchor="end" fill="#cdb4ff" font-size="11.5" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-weight="600">${CFG.site.city.name}</text><text x="-16" y="5" text-anchor="end" fill="#93a0b2" font-size="11" font-family="Menlo,Consolas,monospace">${fmt(Math.hypot(ce,cn)/1000,1)} km</text></g>`; }
    c+=`<g transform="translate(${MW-30} 76)"><path d="M0 -12 L6 6 L0 2 L-6 6Z" fill="#e3e8ef"/><text y="20" fill="#93a0b2" font-size="10" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">K</text></g>`;
    ovG.innerHTML=c;
    const sm=[100,200,500,1000,2000].find(m=>m*k>70)||2000;
    $('scale').innerHTML=`<svg width="${(sm*k).toFixed(0)}" height="8" style="vertical-align:middle;margin-right:6px"><path d="M0 0v8M${sm*k} 0v8M0 4h${sm*k}" stroke="#93a0b2"/></svg>${fmt(sm,0)} m`;
    $('attrib').textContent=`© Esri`;
  }
  function renderInfo(){
    const S=Store.get(), tr=S.track[UI.sel], fix=tr.length?tr[tr.length-1]:null, age=fix?UI.T-fix[0]:null, stale=age!=null&&age>1.5;
    $('mDist').textContent = UI.dist==null ? '—' : (UI.dist>=1000 ? fmt(UI.dist/1000,2)+' km' : fmt(UI.dist,0)+' m');
    const lu=S.track.main.at(-1); $('mUpd').textContent = lu ? clockOf(lu[0]) : '—';
    $('mPos').textContent = fix ? `${toLat(fix[2]).toFixed(5)}° K  ${toLon(fix[1]).toFixed(5)}° D` : 'N/A';
    const s=$('mStale'); s.hidden=!stale; if (stale) s.textContent=`${UI.sel==='main'?'Roket':'Görev yükü'} GPS fix yok · son bilinen konum ${fmt(age,1)} s önce`;
  }
  return { render, renderInfo, resetTiles:()=>tileKey='' };
}

/* ==========================================================================
   AKANA ↔ OPEN MCT KÖPRÜSÜ
   Simülasyon motoru (yukarıdaki çekirdek) Open MCT'ye telemetri sağlayıcısı olarak bağlanır.
   Gerçek sistemde aynı sağlayıcı, yi-core'un WebSocket akışını dinler; arayüz değişmez.
   ========================================================================== */
const NS = 'akana';
/* Veri kaynağı etiketi: gerçek bağlantı ve veri yokken asla CANLI yazmaz (akana-live.js günceller). */
const MODE = { kind:'sim', label:'SİMÜLASYON MODU', note:'veriler gerçek uçuş değildir' };
const UI = { T: CFG.startT, sel: 'main', layer: 'sat', zoom: 1, dist: null };
let EPOCH = Date.now() - CFG.startT * 1000;            // T=0 anının UTC karşılığı
const utcOf = t => EPOCH + t * 1000;

/* ---------- telemetri noktaları ---------- */
const P = (key, name, unit, opt = {}) => ({ key, name, unit, ...opt });
const POINTS = {
  main:    [P('alt','İrtifa (baro)','m'), P('vz','Dikey hız','m/s'), P('p','Basınç','hPa'), P('temp','Sıcaklık','°C'), P('az','Eksenel ivme','g'),
            P('phase','Uçuş fazı','',{ enum:true }), P('lat','Enlem','°',{ dec:6 }), P('lon','Boylam','°',{ dec:6 }), P('sats','Uydu sayısı',''), P('bat','Batarya','V')],
  backup:  [P('alt','İrtifa (Kalman)','m'), P('vz','Dikey hız','m/s'), P('vh','Yatay hız (GNSS)','m/s'), P('ax','İvme X','g'), P('ay','İvme Y','g'), P('az','İvme Z','g'),
            P('pitch','Pitch θ','°'), P('yaw','Yaw ψ','°'), P('roll','Roll φ','°'), P('lat','Enlem','°',{ dec:6 }), P('lon','Boylam','°',{ dec:6 }),
            P('gpsAlt','GPS yüksekliği (MSL)','m'), P('sats','Uydu sayısı',''), P('bat','Batarya','V')],
  payload: [P('alt','İrtifa (baro)','m'), P('vz','Dikey hız','m/s'), P('p','Basınç','hPa'), P('temp','Sıcaklık','°C'), P('hum','Nem','%'),
            P('lat','Enlem','°',{ dec:6 }), P('lon','Boylam','°',{ dec:6 }), P('sats','Uydu sayısı',''), P('sep','Ayrıldı','',{ bool:true }), P('bat','Batarya','V')],
  link:    SRC.flatMap(s => [P(s+'.rssi', CFG.sources[s].label+' RSSI','dBm'), P(s+'.hz', CFG.sources[s].label+' veri hızı','Hz')]),
  calc:    [P('v','Toplam hız','m/s'), P('mach','Mach',''), P('acc','Toplam ivme','g')],
};
const FOLDERS = { main:'Ana UKB · Sky Logic V2', backup:'Yedek UKB · Özgün', payload:'Görev yükü', link:'Haberleşme', calc:'Hesaplanan' };
const PREFIX = { main:'Ana', backup:'Yedek', payload:'GY' };
const pointKey = (grp, k) => `${grp}.${k}`;
const POINT_INDEX = {};
for (const g in POINTS) for (const p of POINTS[g]) POINT_INDEX[pointKey(g, p.key)] = { ...p, grp: g };

/* ---------- geçmiş + abonelikler ---------- */
const HIST = {}, SUBS = {};
function emit(key, t, value){
  if (value == null || !POINT_INDEX[key]) return;
  const d = { id: key, utc: utcOf(t), value };
  const h = HIST[key] || (HIST[key] = []); h.push(d); if (h.length > 40000) h.splice(0, 5000);
  (SUBS[key] || []).forEach(cb => cb(d));
}
function publish(pkt){
  const sid = pkt.source_id;
  for (const k in pkt.fields) emit(pointKey(sid, k), pkt.ts, pkt.fields[k]);
  emit(pointKey('link', sid + '.rssi'), pkt.ts, pkt.rssi);
  if (sid !== 'payload'){
    const S = Store.get(), M = S.latest.main.fields, B = S.latest.backup.fields;
    if (B.vh != null && M.vz != null){ const v = Math.hypot(B.vh, M.vz); emit('calc.v', pkt.ts, v); if (M.alt != null) emit('calc.mach', pkt.ts, Flight.mach(v, M.alt)); }
    if (sid === 'backup' && B.az != null) emit('calc.acc', pkt.ts, Math.hypot(B.ax || 0, B.ay || 0, B.az));
  }
}
let lastHz = -1e9;
const PHASE_T = {};                                   // her fazın ilk görüldüğü an (ana/yedek UKB)
/* Tüm kaynaklar (yerel simülasyon, sunucu: sim / canlı / kayıt) aynı yoldan geçer. */
function acceptPacket(pkt){
  const st = Store.get().stats[pkt.source_id]; if (!st) return;
  const before = st.total;
  Store.ingest(pkt);
  if (st.total > before){
    Events.check(pkt.source_id, pkt); publish(pkt);
    const ph = pkt.fields.phase;
    if (pkt.source_id !== 'payload' && ph != null) for (let i=0;i<=ph;i++) if (PHASE_T[i]==null) PHASE_T[i] = pkt.ts;
  }
}
function emitHz(t1){ if (t1 - lastHz >= 1){ lastHz = t1; for (const s of SRC) emit(pointKey('link', s + '.hz'), t1, Store.hz(s, t1)); } }
function step(t1){
  for (const pkt of SimAdapter.pull(t1)) acceptPacket(pkt);
  emitHz(t1);
}
function boot(){
  Store.reset(); Events.reset(); Log.clear(); SimAdapter.reset(); for (const k in HIST) delete HIST[k]; for (const k in PHASE_T) delete PHASE_T[k];
  Log.add(-900,'info','Yer istasyonu',`Oturum başlatıldı (${CFG.mission.session}).`);
  Log.add(-890,'info','Alıcılar','Üç alıcı açıldı, kaynak: simülasyon.');
  Log.add(CFG.activationT,'info','Operatör','UKB\'ler rampada aktifleştirildi.');
  Log.add(-600,'info','Operatör','PRE-LAUNCH: rampa hazır.');
  lastHz = -1e9; step(UI.T);
}

/* ---------- nesne sözlüğü ---------- */
const id = key => ({ namespace: NS, key });
const OBJ = {};
function metaFor(p){
  const dec = p.dec ?? (['sats'].includes(p.key) ? 0 : p.key === 'mach' ? 2 : p.unit === 'V' ? 2 : 1);
  const value = { key:'value', name:p.name, unit:p.unit || undefined, format:'float', formatString:`%.${dec}f`, hints:{ range:1 } };
  if (p.enum){ value.format = 'enum'; delete value.formatString; value.enumerations = CFG.phases.map((s,i) => ({ value:i, string:s })); delete value.unit; }
  if (p.bool){ value.format = 'enum'; delete value.formatString; value.enumerations = [{ value:0, string:'Hayır' }, { value:1, string:'Evet' }]; }
  return { values: [ value, { key:'utc', source:'utc', name:'Zaman (UTC)', format:'utc', hints:{ domain:1 } } ] };
}
function buildObjects(){
  const folder = (key, name, comp) => (OBJ[key] = { identifier:id(key), name, type:'folder', composition:comp.map(id), location:`${NS}:root` });
  const groups = [];
  for (const g in POINTS){
    const keys = POINTS[g].map(p => pointKey(g, p.key));
    keys.forEach(k => { const p = POINT_INDEX[k]; OBJ[k] = { identifier:id(k), name:(PREFIX[g] ? PREFIX[g] + ' · ' : '') + p.name, type:'akana.telemetry', telemetry:metaFor(p), location:`${NS}:f.${g}` }; });
    folder('f.' + g, FOLDERS[g], keys); groups.push('f.' + g);
  }
  // Seri renkleri anlam taşır: mavi roket (ana), mor yedek/hesaplanan, turuncu görev yükü
  const plot = (key, name, comp, colors) => (OBJ[key] = { identifier:id(key), name, type:'telemetry.plot.overlay', composition:comp.map(id), location:`${NS}:f.plots`,
    configuration:{ series: comp.map((k,i) => ({ identifier:id(k), color:colors[i], markers:false, interpolate:'linear' })) } });
  plot('plot.alt', 'İrtifa', ['main.alt','payload.alt','backup.alt'], ['#1f6feb','#e07a12','#8a5cf6']);
  plot('plot.vel', 'Hız', ['calc.v','main.vz'], ['#8a5cf6','#1f6feb']);
  plot('plot.acc', 'İvme', ['backup.ax','backup.ay','backup.az','calc.acc'], ['#e5484d','#14915a','#1f6feb','#5b6b82']);
  plot('plot.p',   'Basınç', ['main.p','payload.p'], ['#1f6feb','#e07a12']);
  plot('plot.tmp', 'Sıcaklık', ['main.temp','payload.temp'], ['#1f6feb','#e07a12']);
  plot('plot.hum', 'Nem', ['payload.hum'], ['#e07a12']);
  plot('plot.env', 'Görev yükü ortamı', ['payload.temp','payload.hum'], ['#e07a12','#14915a']);
  plot('plot.rf',  'Sinyal (RSSI)', SRC.map(s => `link.${s}.rssi`), ['#1f6feb','#8a5cf6','#e07a12']);
  OBJ['lad.main'] = { identifier:id('lad.main'), name:'Ana telemetri', type:'LadTable', location:`${NS}:f.plots`,
    configuration:{ hiddenColumns:{ timestamp:true, type:true }, isFixedLayout:false, objectStyles:{} },
    composition:['main.phase','main.alt','main.vz','calc.v','calc.mach','calc.acc','main.p','main.temp','backup.gpsAlt','backup.lat','backup.lon','backup.bat','payload.alt','payload.temp','payload.hum','link.main.rssi'].map(id) };
  OBJ['table.pkt'] = { identifier:id('table.pkt'), name:'Telemetri tablosu', type:'table', location:`${NS}:f.plots`,
    composition:['main.alt','main.vz','main.p','payload.alt','payload.temp'].map(id), configuration:{} };
  folder('f.plots', 'Grafikler ve tablolar', ['lad.main','table.pkt','plot.alt','plot.vel','plot.acc','plot.p','plot.tmp','plot.hum','plot.env','plot.rf']);
  const panel = (key, name, type) => (OBJ[key] = { identifier:id(key), name, type, location:`${NS}:f.views` });
  panel('v.phases', 'Uçuş durumu', 'akana.phases');
  panel('v.map', 'Konum takibi', 'akana.map');
  panel('v.att', 'Yönelim (3B)', 'akana.attitude');
  panel('v.log', 'Uçuş olay kaydı', 'akana.log');
  panel('v.links', 'Kaynaklar', 'akana.links');
  folder('f.views', 'AKANA panelleri', ['v.phases','v.map','v.att','v.log','v.links']);
  OBJ['hakem'] = { identifier:id('hakem'), name:'Hakem ekranı', type:'akana.referee', location:`${NS}:root` };
  const fr = (k, size) => ({ id:'fr-' + k, domainObjectIdentifier:id(k), size, noFrame:false });
  const C = [
    { id:'c1', size:21, frames:[fr('v.phases',56), fr('lad.main',44)] },
    { id:'c2', size:39, frames:[fr('v.map',58), fr('plot.alt',42)] },
    { id:'c3', size:19, frames:[fr('v.att',38), fr('plot.vel',31), fr('plot.acc',31)] },
    { id:'c4', size:21, frames:[fr('v.log',46), fr('v.links',26), fr('plot.p',28)] },
  ];
  OBJ['ops'] = { identifier:id('ops'), name:'Operasyon ekranı', type:'flexible-layout', location:`${NS}:root`,
    configuration:{ containers:C, rowsLayout:false, objectStyles:{} }, composition:C.flatMap(c => c.frames.map(f => f.domainObjectIdentifier)) };
  OBJ['root'] = { identifier:id('root'), name:'AKANA · AKN-A3-26-001 (SİMÜLASYON)', type:'folder', location:'ROOT',
    composition:['ops','hakem','f.views','f.plots',...groups].map(id) };
}

/* ---------- görünümler ---------- */
function view(key, name, cssClass, type, mount){
  return { key, name, cssClass, canView: o => o.type === type, priority: () => 1000,
    view: (domainObject) => { let api = null; return { show(el){ api = mount(el, domainObject); }, destroy(){ api && api.destroy && api.destroy(); } }; } };
}
function ticker(fn, ms){ fn(); const h = setInterval(fn, ms); return () => clearInterval(h); }
function tShortU(t){ t -= TIME0; const x=Math.abs(t), m=Math.floor(x/60), s=Math.floor(x%60); return `${tPre()}${t<0?'−':'+'}${pad2(m)}:${pad2(s)}`; }
function clockOf(t){ const d=new Date(utcOf(t)); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; }

function mountPhases(el){
  el.innerHTML = `<div class="akv akv-ph"><div class="akv-sub">Faz çizelgesi</div><div class="akv-tl"></div><div class="akv-sub">Şartname (TEKNOFEST 2026 · A3)</div><div class="akv-chk"></div></div>`;
  const tl = el.querySelector('.akv-tl'), chk = el.querySelector('.akv-chk');
  return { destroy: ticker(() => {
    const L = Store.get().latest.main.fields, cur = L.phase ?? 0;
    const times = CFG.phases.map((_,i) => PHASE_T[i]);
    tl.innerHTML = CFG.phases.map((p,i) => `<div class="akv-step ${i<cur?'done':i===cur?'now':''}"><i></i><b>${p}</b><span>${i<=cur&&times[i]!=null?tShortU(times[i]):''}</span></div>`).join('') +
      `<div class="akv-step safe"><i></i><b>Güvenli mod</b><span>pasif</span></div>`;
    chk.innerHTML = compliance(UI.T).map(([l,v,c]) => `<div class="akv-ck"><span>${l}</span><b class="akv-${c}">${v}${c==='ok'?' ✓':c==='bad'?' ✗':''}</b></div>`).join('');
  }, 400) };
}
function mountLog(el){
  el.innerHTML = `<div class="akv akv-log"></div>`; const box = el.firstChild;
  return { destroy: ticker(() => {
    box.innerHTML = [...Log.items()].sort((a,b)=>b.t-a.t).slice(0,40).map(l => `<div class="akv-le akv-${l.sv}"><span>${clockOf(l.t)}</span><i></i><div>${l.msg}<em>${l.src}</em></div></div>`).join('');
  }, 500) };
}
function mountLinks(el){
  el.innerHTML = `<div class="akv"><table class="akv-tbl"></table></div>`; const tb = el.querySelector('table');
  return { destroy: ticker(() => {
    const S = Store.get();
    const rows = [['Durum', s => { const a=Store.age(s,UI.T); return a==null||a>1?['veri yok','bad']:['SIM veri','ok']; }],
      ['Veri hızı', s => [fmt(Store.hz(s,UI.T),1)+' Hz', Store.hz(s,UI.T) < (s==='payload'?CFG.rules.payloadMinHz:4.5) ? 'bad' : '']],
      ['Son veri', s => { const a=Store.age(s,UI.T); return [a==null?'—':fmt(a,1)+' s','']; }],
      ['RSSI', s => { const a=Store.age(s,UI.T); return a!=null&&a<1?[fmt(S.stats[s].rssi,0)+' dBm','']:['N/A','na']; }],
      ['Paket', s => [fmt(S.stats[s].total,0),'']],
      ['Kayıp', s => [fmt(S.stats[s].lost,0), S.stats[s].lost?'warn':'']],
      ['CRC/tekrar/sıra', s => [`${S.stats[s].crc}/${S.stats[s].dup}/${S.stats[s].ooo}`, S.stats[s].crc||S.stats[s].dup||S.stats[s].ooo?'warn':'']],
      ['Batarya', s => { const b=S.latest[s].fields.bat; return [b==null?'N/A':fmt(b,2)+' V','']; }]];
    tb.innerHTML = `<tr><th></th>${SRC.map(s=>`<th>${CFG.sources[s].short}</th>`).join('')}</tr>` + rows.map(([l,f]) => `<tr><td>${l}</td>${SRC.map(s=>{ const [v,c]=f(s); return `<td class="akv-${c}">${v}</td>`; }).join('')}</tr>`).join('');
  }, 500) };
}
function mountMap(el){
  el.innerHTML = `<div class="akv akv-map">
    <svg class="akm-svg" id="map"><defs>
      <filter id="fStd" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1.15 0 0 0 -0.26  0 1.25 0 0 -0.27  0 0 1.4 0 -0.28  0 0 0 1 0"/></filter>
      <filter id="fSat" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.85"/></filter>
      <filter id="fRef" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.9 0 0 0 0  0 0.95 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>
    </defs><rect width="100%" height="100%" fill="#222"/><g id="tiles"></g><g id="ov"></g></svg>
    <div class="akm-wm">SİMÜLASYON</div>
    <div class="akm-leg"><button data-sel="main" class="on">● Roket</button><button data-sel="payload">▲ Görev yükü</button></div>
    <div class="akm-lay"><button data-layer="sat" class="on">Uydu</button><button data-layer="std">Harita</button></div>
    <div class="akm-zoom"><button data-z="in">+</button><button data-z="out">−</button><button data-z="fit">⌖</button></div>
    <span class="akm-scale" id="scale"></span>
    <div class="akm-foot">Roket ↔ görev yükü <b id="mDist">—</b><span id="mStale" class="akv-warn" hidden></span><span id="mUpd" hidden></span><span id="mPos" hidden></span><span class="akm-attr" id="attrib"></span></div></div>`;
  const mv = createMapView(el);
  el.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { UI.sel = b.dataset.sel; el.querySelectorAll('[data-sel]').forEach(x => x.classList.toggle('on', x===b)); mv.render(); });
  el.querySelectorAll('[data-layer]').forEach(b => b.onclick = () => { UI.layer = b.dataset.layer; mv.resetTiles(); el.querySelectorAll('[data-layer]').forEach(x => x.classList.toggle('on', x===b)); mv.render(); });
  el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const z=b.dataset.z; UI.zoom = z==='in'?UI.zoom*1.3:z==='out'?UI.zoom/1.3:1; mv.render(); });
  const stop1 = ticker(() => mv.renderInfo(), 300), stop2 = ticker(() => mv.render(), 700);
  return { destroy(){ stop1(); stop2(); } };
}
function mountAtt(el){
  el.innerHTML = `<div class="akv akv-att"><div class="r3d" id="r3d"><span class="cmp" id="cK">K</span><span class="cmp" id="cD">D</span><span class="cmp" id="cG">G</span><span class="cmp" id="cB">B</span>
    <div class="fb" id="r3dfb" hidden>3B görünüm bu cihazda kullanılamıyor</div></div>
    <div class="akv-attv"><div><label>Dikeyden</label><b id="aD">—</b></div><div><label>Pitch θ</label><b id="aP">—</b></div><div><label>Yaw ψ</label><b id="aY">—</b></div><div><label>Roll φ</label><b id="aR">—</b></div></div></div>`;
  const a = createAtt3D(el); let raf = 0, alive = true;
  const start = () => { if (!alive) return; if (el.querySelector('#r3d').clientWidth < 20) { setTimeout(start, 120); return; } a.init(); const loop = () => { if (!alive) return; a.render(); raf = requestAnimationFrame(loop); }; loop(); };
  setTimeout(start, 60);
  return { destroy(){ alive = false; cancelAnimationFrame(raf); } };
}
function mountReferee(el){
  el.innerHTML = `<div class="akv akv-ref"><div class="akv-refh akv-mode-${MODE.kind}">${MODE.label} · ${CFG.mission.id} · ${CFG.mission.category} · ${CFG.mission.motor}</div><div class="akv-rgrid"></div></div>`;
  const g = el.querySelector('.akv-rgrid');
  return { destroy: ticker(() => {
    const S=Store.get(), M=S.latest.main.fields, Pl=S.latest.payload.fields, r=S.track.main.at(-1), p=S.track.payload.at(-1);
    const pos=f=>f?`${toLat(f[2]).toFixed(6)}° K<br>${toLon(f[1]).toFixed(6)}° D`:'N/A';
    const cells=[['Uçuş fazı',CFG.phases[M.phase??0],tplus(UI.T)],['Roket irtifası',fmt(M.alt,0)+' m',fmt((M.alt||0)*FT,0)+' ft'],['En yüksek irtifa',fmt(S.maxAlt,0)+' m',fmt(S.maxAlt*FT,0)+' ft'],
      ['Roket dikey hız',fmt(M.vz,1)+' m/s',''],['Görev yükü irtifası',fmt(Pl.alt,0)+' m',''],['Görev yükü veri hızı',fmt(Store.hz('payload',UI.T),1)+' Hz','asgari 5 Hz'],
      ['Roket konumu',pos(r),r?`son konum ${fmt(UI.T-r[0],1)} s önce`:''],['Görev yükü konumu',pos(p),p?`son konum ${fmt(UI.T-p[0],1)} s önce`:''],['Bağlantı (ana / yedek)',fmt(Store.hz('main',UI.T),1)+' / '+fmt(Store.hz('backup',UI.T),1)+' Hz','']];
    g.innerHTML = cells.map(c=>`<div class="akv-rc"><label>${c[0]}</label><b class="${c[0]==='Roket konumu'||c[0]==='Görev yükü konumu'?'sm':''}">${c[1]}</b><span>${c[2]}</span></div>`).join('');
  }, 400) };
}

/* ---------- eklenti ---------- */
function AkanaPlugin(){
  return function install(openmct){
    buildObjects();
    const T = (key, name, cssClass) => openmct.types.addType(key, { name, cssClass, creatable:false });
    T('akana.telemetry','AKANA telemetri noktası','icon-telemetry'); T('akana.phases','Uçuş durumu','icon-timeline'); T('akana.map','Konum takibi','icon-image');
    T('akana.attitude','Yönelim (3B)','icon-object'); T('akana.log','Olay kaydı','icon-list-view'); T('akana.links','Kaynaklar','icon-gauge'); T('akana.referee','Hakem ekranı','icon-layout');
    openmct.objects.addRoot(id('root'), openmct.priority.HIGH);
    openmct.objects.addProvider(NS, {
      get: identifier => Promise.resolve(OBJ[identifier.key] ? structuredClone(OBJ[identifier.key]) : undefined),
      // Görünüm ayarları (seri renkleri, düzen boyutları) oturum içinde tutulur; telemetri değiştirilemez.
      create: o => { OBJ[o.identifier.key] = structuredClone(o); return Promise.resolve(true); },
      update: o => { OBJ[o.identifier.key] = structuredClone(o); return Promise.resolve(true); },
    });
    openmct.telemetry.addProvider({
      supportsRequest: o => o.type === 'akana.telemetry',
      request: (o, opts) => { const h = HIST[o.identifier.key] || []; return Promise.resolve(h.filter(d => d.utc >= opts.start && d.utc <= opts.end)); },
      supportsSubscribe: o => o.type === 'akana.telemetry',
      subscribe: (o, cb) => { const k = o.identifier.key; (SUBS[k] || (SUBS[k] = [])).push(cb); return () => { SUBS[k] = SUBS[k].filter(f => f !== cb); }; },
    });
    openmct.objectViews.addProvider(view('akana.phases.view','Uçuş durumu','icon-timeline','akana.phases',mountPhases));
    openmct.objectViews.addProvider(view('akana.map.view','Konum takibi','icon-image','akana.map',mountMap));
    openmct.objectViews.addProvider(view('akana.att.view','Yönelim (3B)','icon-object','akana.attitude',mountAtt));
    openmct.objectViews.addProvider(view('akana.log.view','Olay kaydı','icon-list-view','akana.log',mountLog));
    openmct.objectViews.addProvider(view('akana.links.view','Kaynaklar','icon-gauge','akana.links',mountLinks));
    openmct.objectViews.addProvider(view('akana.ref.view','Hakem ekranı','icon-layout','akana.referee',mountReferee));
    const ind = openmct.indicators.simpleIndicator();
    ind.text(`${MODE.label} · ${MODE.note}`); ind.iconClass('icon-alert-triangle'); ind.statusClass('s-status-warning');
    window.AK_IND = ind;
    openmct.indicators.add(ind);
  };
}
