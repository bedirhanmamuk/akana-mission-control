/* AKANA yer istasyonu · sunucu bağlantısı (yi_core)
   Sayfa yi_core tarafından sunuluyorsa (http://127.0.0.1:8000) veriler WebSocket'ten gelir:
   sunucu simülasyonu, canlı alıcılar (E22) veya kayıt oynatma. Sunucu yoksa sayfa dahili simülasyonla çalışır.
   Kural: gerçek seri bağlantı ve son 2 s içinde paket yoksa hiçbir yerde "CANLI" yazmaz; bağlantı koparsa
   değerler sıfırlanmaz, son değerler yaşlarıyla birlikte kalır. */
"use strict";
const LIVE = { on:false, ws:null, hello:null, status:null, connected:false, clock:{ t:0, wall:0, speed:1, paused:true }, session:null, recs:[], ports:[] };

async function liveProbe(){
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 1200);
    const r = await fetch('/api/status', { cache:'no-store', signal:ctl.signal }); clearTimeout(tm);
    return r.ok && !!(await r.json()).mode;
  } catch (e) { return false; }
}
function liveNow(){ const c=LIVE.clock; return c.paused ? c.t : c.t + (performance.now()-c.wall)/1000*c.speed; }
function liveSetClock(t, speed, paused){ LIVE.clock = { t, wall:performance.now(), speed:speed ?? LIVE.clock.speed, paused:!!paused }; }

function liveApplyHello(h){
  const key = `${h.mode}|${h.label}|${h.epoch_ms}`;
  if (LIVE.session && LIVE.session !== key){ location.reload(); return; }   // kaynak değişti: temiz başlangıç
  LIVE.session = key; LIVE.hello = h;
  if (h._first){
    Store.reset(); Events.reset(); Log.clear(); for (const k in HIST) delete HIST[k]; for (const k in PHASE_T) delete PHASE_T[k];
    if (typeof AN !== 'undefined') for (const k in AN.cache) delete AN.cache[k];
  }
  EPOCH = h.epoch_ms; CFG.activationT = h.activation;
  TIME0 = h.t0 ?? 0; T0_KNOWN = h.t0 != null;
  liveSetClock(h.t, h.speed, h.paused);
  liveMode();
}

function liveConnect(){
  return new Promise(resolve => {
    let first = true;
    const ws = new WebSocket((location.protocol==='https:'?'wss':'ws') + '://' + location.host + '/ws');
    LIVE.ws = ws;
    ws.onopen = () => { LIVE.connected = true; liveMode(); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      switch (m.type){
        case 'hello': m._first = first; liveApplyHello(m); if (first){ first = false; resolve(true); } break;
        case 'reset': if (!first) { location.reload(); return; } break;   // kaynak yeniden kuruldu (kayıt başa sarma vb.)
        case 'pkts': for (const p of m.items) acceptPacket(p); break;
        case 'clock': liveSetClock(m.t, m.speed, m.paused); break;
        case 't0': TIME0 = m.t0; T0_KNOWN = true; break;
        case 'status': LIVE.status = m; liveMode(); break;
        case 'log': Log.add(m.t, m.sv, m.src, m.msg); break;
      }
    };
    ws.onclose = () => {
      LIVE.connected = false; liveMode();
      if (first) resolve(false);
      setTimeout(() => liveConnect(), 2000);
    };
  });
}
function liveTick(){ if (!LIVE.connected && !LIVE.hello) return; UI.T = liveNow(); emitHz(UI.T); }

/* ---------- mod etiketi ---------- */
const SRC_SHORT = { main:'Ana', backup:'Yedek', payload:'GY' };
function liveMode(){
  if (!LIVE.on) return;
  const h = LIVE.hello, st = LIVE.status;
  let kind, label, note, detail;
  if (!LIVE.connected){ kind='down'; label='SERVİS BAĞLANTISI YOK'; note='son değerler gösteriliyor, yeniden bağlanılıyor'; detail='Yer istasyonu servisine (yi_core) ulaşılamıyor.'; }
  else if (!h){ kind='down'; label='BAĞLANIYOR'; note=''; detail=''; }
  else if (h.mode==='sim'){ kind='sim'; label='SİMÜLASYON MODU'; note='veriler gerçek uçuş değildir'; detail='Veriler sunucu simülatöründen gelir; gerçek uçuş verisi değildir.'; }
  else if (h.mode==='replay'){ kind='replay'; label='KAYIT OYNATMA'; note=h.meta?.recording||''; detail=`${h.meta?.recording||''} · ${fmt(LIVE.clock.speed,1)}×${LIVE.clock.paused?' · duraklatıldı':''}`; }
  else {
    const fresh = st ? SRC.filter(s => st.sources[s] && st.sources[s].age != null && st.sources[s].age < 2) : [];
    kind = fresh.length ? 'live' : 'nodata';
    label = fresh.length ? 'CANLI VERİ' : 'ALICILAR AÇIK · VERİ YOK';
    note = SRC.map(s => `${SRC_SHORT[s]} ${fresh.includes(s)?'✓':'✗'}`).join('  ');
    detail = st ? SRC.map(s => { const x=st.sources[s]; return `${SRC_SHORT[s]}: ${x.port||'—'} ${x.state}`; }).join(' · ') : '';
  }
  Object.assign(MODE, { kind, label, note });
  document.documentElement.dataset.mode = kind;
  const bar = document.getElementById('simbar');
  if (bar){ bar.querySelector('b').textContent = label; bar.querySelector('span').textContent = detail; }
  const chip = { sim:'SİMÜLASYON VERİSİ', replay:'KAYIT VERİSİ', live:'CANLI VERİ', nodata:'VERİ YOK', down:'BAĞLANTI YOK' }[kind];
  document.querySelectorAll('.simt').forEach(e => e.textContent = chip);
  const cs = document.getElementById('cstate'); if (cs) cs.lastChild.textContent = ({ sim:'Sunucu simülasyonu', replay:'Kayıt oynatılıyor', live:'Veri alınıyor', nodata:'Veri bekleniyor', down:'Servis yok' })[kind];
  const sb = document.getElementById('sMode'); if (sb) sb.textContent = ({ sim:'SİMÜLASYON', replay:'KAYIT', live:'CANLI', nodata:'VERİ YOK', down:'SERVİS YOK' })[kind];
  document.querySelectorAll('.akm-wm').forEach(e => e.textContent = kind==='sim' ? 'SİMÜLASYON' : kind==='replay' ? 'KAYIT' : '');
  if (window.AK_IND) window.AK_IND.text(`${label}${note?' · '+note:''}`);
  const rc = document.getElementById('repCtl'); if (rc) rc.hidden = kind !== 'replay';
  const rp = document.getElementById('repPlay'); if (rp) rp.textContent = LIVE.clock.paused ? '▶' : '❚❚';
  const rs = document.getElementById('repSpeed'); if (rs && document.activeElement !== rs){ const v = String(LIVE.clock.speed); if ([...rs.options].some(o => o.value === v)) rs.value = v; }
}

/* ---------- kaynak seçimi ---------- */
async function liveFillSources(){
  const [r1, r2] = await Promise.all([fetch('/api/recordings').then(r=>r.json()).catch(()=>({recordings:[]})), fetch('/api/ports').then(r=>r.json()).catch(()=>({ports:[]}))]);
  LIVE.recs = r1.recordings; LIVE.ports = r2.ports;
  const sel = document.getElementById('port'), h = LIVE.hello;
  const opts = [['sim','Simülasyon (sunucu, 20 000 ft profili)'], ['serial', `Canlı alıcılar (E22) · ${LIVE.ports.length} seri port`],
    ...LIVE.recs.filter(r => r.finished || r.interrupted).map(r => [`rec:${r.name}`, `Kayıt · ${r.name}${r.mode==='sim'?' (simülasyon)':''}${r.interrupted?' (yarım kaldı)':''}`])];
  sel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = h ? (h.mode==='replay' ? `rec:${h.meta?.recording}` : h.mode) : 'sim';
}
async function livePost(url, body){
  const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  if (!r.ok){ const e = await r.json().catch(()=>({})); alert('İşlem yapılamadı: ' + (e.detail || r.status)); return null; }
  return r.json();
}
function liveSetupUI(){
  if (!LIVE.on) return;
  const btn = document.getElementById('connBtn');
  btn.classList.add('on'); btn.removeAttribute('title'); btn.setAttribute('role','button'); btn.tabIndex = 0;
  liveFillSources();
  document.getElementById('port').addEventListener('focus', liveFillSources);
  const go = async () => {
    const v = document.getElementById('port').value;
    if (v === 'serial'){ livePortDialog(); return; }
    if (v === 'sim') await livePost('/api/source', { mode:'sim' });
    else if (v.startsWith('rec:')) await livePost('/api/source', { mode:'replay', name:v.slice(4), speed:1 });
  };
  btn.onclick = go; btn.onkeydown = e => { if (e.key==='Enter' || e.key===' ') go(); };
  document.getElementById('restart').hidden = true;
  // kayıt oynatma denetimi
  document.getElementById('repPlay').onclick = () => livePost('/api/replay', { action: LIVE.clock.paused ? 'resume' : 'pause' });
  document.getElementById('repSpeed').onchange = e => livePost('/api/replay', { action:'speed', speed:+e.target.value });
  document.getElementById('repBack').onclick = () => livePost('/api/replay', { action:'seek', t:-1e9 });
  liveMode();
}
function livePortDialog(){
  const d = document.getElementById('portDlg'), ports = LIVE.ports;
  const opt = sel => `<option value="">— kullanılmıyor —</option>` + ports.map(p => `<option value="${p.device}" ${p.device===sel?'selected':''}>${p.device} · ${p.description}</option>`).join('');
  const prev = LIVE.hello?.meta?.ports || {};
  d.querySelector('.pd-body').innerHTML = (ports.length ? '' : '<p class="pd-warn">Seri port bulunamadı. Alıcıları takıp listeyi yenileyin.</p>') +
    SRC.map(s => `<label>${CFG.sources[s].label}<select data-src="${s}">${opt(prev[s])}</select></label>`).join('') +
    `<label>UART hızı<select id="pdBaud">${[9600,19200,38400,57600,115200].map(b=>`<option ${b===9600?'selected':''}>${b}</option>`).join('')}</select></label>
     <p class="pd-note">Her alıcı (E22) ayrı kanaldadır; paketteki kaynak kimliği alıcı eşlemesiyle uyuşmazsa uyarı verilir. Yer istasyonu porta hiçbir veri yazmaz.</p>`;
  d.hidden = false;
  d.querySelector('#pdRefresh').onclick = async () => { LIVE.ports = (await fetch('/api/ports').then(r=>r.json())).ports; livePortDialog(); };
  d.querySelector('#pdCancel').onclick = () => d.hidden = true;
  d.querySelector('#pdGo').onclick = async () => {
    const map = {}; d.querySelectorAll('[data-src]').forEach(s => { if (s.value) map[s.dataset.src] = s.value; });
    const vals = Object.values(map); if (new Set(vals).size !== vals.length){ alert('Aynı port iki kaynağa atanamaz.'); return; }
    if (await livePost('/api/source', { mode:'serial', ports:map, baud:+d.querySelector('#pdBaud').value })) d.hidden = true;
  };
}
