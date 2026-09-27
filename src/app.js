const DATA = JSON.parse(document.getElementById('appdata').textContent);
const BAND_COLORS = {L1800:'#3b82f6', L2600:'#a855f7', L2100:'#10b981', L900:'#f59e0b', L850:'#ef4444', Indoor:'#94a3b8'};

// ---- tabs ----
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); document.getElementById(t.dataset.tab).classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
    if(t.dataset.tab === 'datamgmt') loadDataManagement();
    if(t.dataset.tab === 'geo' && typeof geoOnTabShown === 'function') geoOnTabShown();
    if(t.dataset.tab === 'geovideo' && typeof gvOnTabShown === 'function') gvOnTabShown();
    // Leaving Geo Video Analysis while it's holding the live map (Road
    // Analysis mode) sends the map back to its home in the Geo Analysis
    // tab -- otherwise switching to Geo Analysis would show an empty
    // slot where the map used to be. gvMoveMapHome() no-ops safely if the
    // map isn't actually parked there (e.g. mode is Whole Network, or
    // it's off in the fullscreen modal instead).
    if(t.dataset.tab !== 'geovideo' && typeof gvMoveMapHome === 'function') gvMoveMapHome();
  });
});
function togglePanel(h){h.classList.toggle('collapsed'); h.nextElementSibling.classList.toggle('hidden');}

function fmt(v, d=1){ return (v===null||v===undefined||isNaN(v)) ? '&mdash;' : Number(v).toFixed(d); }
function esc(s){ return (s===null||s===undefined) ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

// =====================================================================
// MAJOR KPIs
// =====================================================================
function donutSVG(segments, totalLabel){
  // segments: [{label,value,color}]
  const total = segments.reduce((a,s)=>a+s.value,0) || 1;
  let offset = 25, circles = '';
  segments.forEach(s=>{
    const pct = 100*s.value/total;
    circles += `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${s.color}" stroke-width="7" stroke-dasharray="${pct.toFixed(2)} ${(100-pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 21 21)"></circle>`;
    offset -= pct;
  });
  const legend = segments.map(s=>`<div><span class="dot" style="background:${s.color}"></span>${s.label} <b style="color:var(--ink);float:right;margin-left:18px">${(100*s.value/total).toFixed(0)}%</b></div>`).join('');
  return `<div style="display:flex;align-items:center;gap:26px">
    <svg class="donut" viewBox="0 0 42 42" width="190" height="190" style="flex-shrink:0">
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--panel2)" stroke-width="7"></circle>${circles}
    </svg>
    <div class="donut-legend" style="font-family:var(--mono);font-size:13px;line-height:2.1">${legend}</div></div>`;
}

// =====================================================================
// Data & Voice Utilization by Band -- grouped/stacked bars for the last N
// hours of the latest ingested day. Fixed to that window (not tied to the
// pies' From/To selector above it), same "recent snapshot" philosophy as
// LayerWise's Rejections -- Last 4 Hours.
// =====================================================================
const BAND_ORDER = ['L1800','L2100','L900','L850','L2600'];
const BAND_UTIL_HOURS = 8;

function getLastNHoursOfMaxDay(n){
  const dates = DATA.major.lines.dl_volume_gb.dates, hours = DATA.major.lines.dl_volume_gb.hours;
  const bh = DATA.major.band_hourly;
  const maxDate = DATA.meta.latest_date;
  const idxs = [];
  for(let i=0;i<dates.length;i++){ if(dates[i]===maxDate) idxs.push(i); }
  return idxs.slice(-n).map(i=>({hour: hours[i], bands: bh[i]||[]}));
}

// SVG path for a rect with only its TOP corners rounded (native <rect rx>
// rounds all four, which looks wrong on a stacked segment sitting on top
// of others below it).
function roundedTopRectPath(x, y, w, h, r){
  if(h<=0 || w<=0) return '';
  r = Math.max(0, Math.min(r, w/2, h));
  if(r<=0) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${(y+r).toFixed(1)} a${r},${r} 0 0 1 ${r},${-r} h${(w-2*r).toFixed(1)} a${r},${r} 0 0 1 ${r},${r} v${(h-r).toFixed(1)} h${-w} Z`;
}

function stackedBandBarChart(title, unit, metricKey, points){
  const W=600, H=340, pl=52, pr=14, pt=36, pb=54;
  // Every present band gets AT LEAST this many px of segment height,
  // regardless of its true share -- a strictly-proportional stack makes a
  // genuinely small-but-real contributor (L2600 is typically only ~3-4%
  // of the total) render as a sliver too thin to see or label. This
  // trades a little visual accuracy on the smallest band for actually
  // being able to see and read it, which is the point of the chart.
  const MIN_SEG_H = 15;
  const n = Math.max(points.length, 1);
  const totals = points.map(p=>(p.bands||[]).reduce((a,b)=>a+(b[metricKey]||0),0));
  const maxTotal = Math.max(...totals, 1) * 1.2;
  const plotW = W-pl-pr, plotH = H-pt-pb;
  const groupW = plotW/n;
  const barW = Math.min(52, groupW*0.62);
  const fmtV = v => v>=1000 ? (v/1000).toFixed(v>=10000?0:1)+'k' : v.toFixed(v>=100?0:1);

  let grid='';
  for(let k=0;k<=4;k++){
    const gy = pt + plotH*k/4;
    const gv = maxTotal*(1-k/4);
    grid += `<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="0.7"/><text x="${pl-8}" y="${(gy+4).toFixed(1)}" fill="var(--chart-ink)" font-size="9.5" font-weight="700" text-anchor="end" font-family="monospace">${fmtV(gv)}</text>`;
  }

  const legendTotals = {};
  let bars='';
  points.forEach((p,i)=>{
    const x = pl + i*groupW + (groupW-barW)/2;
    const present = BAND_ORDER.filter(b=>{
      const bd = (p.bands||[]).find(x=>x.band===b);
      return bd && (bd[metricKey]||0) > 0;
    });
    const segs = present.map(bandName=>{
      const val = (p.bands||[]).find(x=>x.band===bandName)[metricKey]||0;
      legendTotals[bandName] = (legendTotals[bandName]||0) + val;
      return {bandName, val, segH: Math.max(plotH*(val/maxTotal), MIN_SEG_H)};
    });
    let yCursor = H-pb;
    segs.forEach((s, bi)=>{
      const y = yCursor - s.segH;
      const gid = 'bug'+(_gid++);
      bars += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BAND_COLORS[s.bandName]}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${BAND_COLORS[s.bandName]}" stop-opacity="0.72"/></linearGradient></defs>`;
      bars += `<path d="${roundedTopRectPath(x,y,barW,s.segH,bi===segs.length-1?6:0)}" fill="url(#${gid})"/>`;
      // White text with a black outline (paint-order stroke-then-fill)
      // reads clearly on every band color. Every present band gets a
      // label now -- not just the ones tall enough by chance -- shrinking
      // the font slightly for the thinnest (floored) segments so it fits.
      const fs = s.segH >= 20 ? 9.5 : 7.5;
      bars += `<text x="${(x+barW/2).toFixed(1)}" y="${(y+s.segH/2+fs*0.35).toFixed(1)}" fill="#fff" stroke="#000" stroke-width="2.2" stroke-opacity="0.55" paint-order="stroke" font-size="${fs}" font-weight="800" text-anchor="middle" font-family="monospace">${fmtV(s.val)}</text>`;
      yCursor = y;
    });
    // Total-above-bar callout: a filled pill behind bold, bright text so
    // it's unmistakably the headline number, not just another label.
    // Capped to the group's own width so neighboring pills never overlap.
    const totalW = Math.min(groupW-4, Math.max(30, fmtV(totals[i]).length*7+10));
    bars += `<rect x="${(x+barW/2-totalW/2).toFixed(1)}" y="${(yCursor-24).toFixed(1)}" width="${totalW}" height="16" rx="8" fill="var(--panel2)" stroke="var(--accent)" stroke-width="1"/>`;
    bars += `<text x="${(x+barW/2).toFixed(1)}" y="${(yCursor-12.5).toFixed(1)}" fill="var(--accent)" font-size="9.5" font-weight="800" text-anchor="middle" font-family="monospace">${fmtV(totals[i])}</text>`;
    bars += `<text x="${(x+barW/2).toFixed(1)}" y="${H-pb+22}" fill="var(--chart-ink2)" font-size="9" font-weight="700" text-anchor="middle" font-family="monospace">${fmtHourAMPM(p.hour)}</text>`;
  });

  const grandTotal = Object.values(legendTotals).reduce((a,b)=>a+b,0) || 1;
  const legendHtml = BAND_ORDER.filter(b=>legendTotals[b]!==undefined).map(b=>{
    const pct = 100*legendTotals[b]/grandTotal;
    return `<div class="bl-chip"><span class="dot" style="background:${BAND_COLORS[b]}"></span><span class="bl-name">${b}</span><span class="bl-pct" style="color:${BAND_COLORS[b]}">${pct.toFixed(0)}%</span></div>`;
  }).join('');

  return `<div class="bigchart-card enl-card" data-enl-title="Data &amp; Voice Utilization by Band &mdash; ${escAttr(title)}">
    <div class="bigchart-head"><span class="bigchart-title">${esc(title)}</span><span class="bigchart-unit">${esc(unit)}</span>${enlargeBtn()}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${grid}${bars}</svg>
    <div class="bl-legend">${legendHtml}</div>
  </div>`;
}

function renderBandUtilCharts(){
  const points = getLastNHoursOfMaxDay(BAND_UTIL_HOURS);
  const scope = document.getElementById('bandUtilScope');
  const container = document.getElementById('bandUtilCharts');
  if(!points.length){ scope.textContent = 'No data'; container.innerHTML = ''; return; }
  scope.textContent = `Last ${points.length} hour${points.length>1?'s':''} of ${fmtDateDMY(DATA.meta.latest_date)}`;
  container.innerHTML =
    stackedBandBarChart('Data Volume by Band', 'GB', 'dl_vol', points) +
    stackedBandBarChart('Voice (VoLTE) Traffic by Band', 'Erl', 'volte', points);
}

// Sum the raw per-hour, per-band components (DATA.major.band_hourly) over
// hour indices [fromI, toI] and divide out the same traffic-weighted ratios
// band_summary() uses for a single hour -- this is what makes the pies/table
// track whatever From/To range is selected instead of always showing one
// hour's numbers.
function computeBandSummary(fromI, toI){
  const hourly = DATA.major.band_hourly.slice(fromI, toI+1);
  const acc = {}; // band -> accumulator
  const order = [];
  hourly.forEach(hourRows=>{
    hourRows.forEach(b=>{
      if(!acc[b.band]){ acc[b.band] = {band:b.band, dl_vol:0, ul_vol:0, volte:0,
        cssr_num:0, cssr_den:0, drop_num:0, dlthrp_num:0, dlthrp_den:0, ulthrp_num:0, ulthrp_den:0,
        rrc_num:0, erab_num:0, intra_num:0, inter_num:0,
        prb_sum:0, n_cells:0, latest_n_cells:0}; order.push(b.band); }
      const a = acc[b.band];
      a.dl_vol += b.dl_vol||0; a.ul_vol += b.ul_vol||0; a.volte += b.volte||0;
      a.cssr_num += b.cssr_num||0; a.cssr_den += b.cssr_den||0;
      a.drop_num += b.drop_num||0;
      a.dlthrp_num += b.dlthrp_num||0; a.dlthrp_den += b.dlthrp_den||0;
      a.ulthrp_num += b.ulthrp_num||0; a.ulthrp_den += b.ulthrp_den||0;
      a.rrc_num += b.rrc_num||0; a.erab_num += b.erab_num||0;
      a.intra_num += b.intra_num||0; a.inter_num += b.inter_num||0;
      a.prb_sum += b.prb_sum||0; a.n_cells += b.n_cells||0;
      a.latest_n_cells = b.n_cells||0; // last hour in range wins -- "Cells" is a snapshot, not a range total
    });
  });
  const div = (n,d)=> d ? n/d : null;
  return order.map(band=>{
    const a = acc[band];
    return {
      band: a.band, dl_vol: a.dl_vol, ul_vol: a.ul_vol, volte: a.volte,
      cssr: div(a.cssr_num, a.cssr_den), drop_rate: div(a.drop_num, a.cssr_den),
      dl_thrp: div(a.dlthrp_num, a.dlthrp_den), ul_thrp: div(a.ulthrp_num, a.ulthrp_den),
      rrc_sr: div(a.rrc_num, a.cssr_den), erab_sr: div(a.erab_num, a.cssr_den),
      intra_hosr: div(a.intra_num, a.cssr_den), inter_hosr: div(a.inter_num, a.cssr_den),
      prb_util: div(a.prb_sum, a.n_cells), n_cells: a.latest_n_cells,
    };
  }).sort((x,y)=> (y.dl_vol||0)-(x.dl_vol||0));
}

function renderBandSplit(fromI, toI){
  const bs = computeBandSummary(fromI, toI);
  const volSegs = bs.map(b=>({label:b.band, value:b.dl_vol||0, color:BAND_COLORS[b.band]||'#888'}));
  const volteSegs = bs.map(b=>({label:b.band, value:b.volte||0, color:BAND_COLORS[b.band]||'#888'}));
  const totVol = volSegs.reduce((a,s)=>a+s.value,0);
  const totVolte = volteSegs.reduce((a,s)=>a+s.value,0);
  document.getElementById('pieVol').innerHTML = `<div class="k-lbl" style="margin-bottom:6px">Total <b style="color:var(--ink);font-family:var(--mono)">${(totVol/1000).toFixed(2)} TB</b></div>` + donutSVG(volSegs);
  document.getElementById('pieVolte').innerHTML = `<div class="k-lbl" style="margin-bottom:6px">Total <b style="color:var(--ink);font-family:var(--mono)">${totVolte.toFixed(0)} Erl</b></div>` + donutSVG(volteSegs);

  let th = '<thead><tr><th>Band</th><th>Data Vol (TB)</th><th>VoLTE (Erl)</th><th>CSSR</th><th>Drop%</th><th>DL Thrp</th><th>UL Thrp</th><th>RRC SR</th><th>E-RAB SR</th><th>Intra HOSR</th><th>Inter HOSR</th><th>PRB%</th><th>Cells</th></tr></thead><tbody>';
  bs.forEach(b=>{
    const prbClass = b.prb_util>=85?'vb':b.prb_util>=70?'vw':'';
    th += `<tr><td class="cid">${b.band}</td><td>${(b.dl_vol/1000).toFixed(2)}</td><td>${fmt(b.volte,0)}</td><td>${fmt(b.cssr,2)}%</td><td>${fmt(b.drop_rate,2)}</td><td>${fmt(b.dl_thrp,1)}</td><td>${fmt(b.ul_thrp,1)}</td><td>${fmt(b.rrc_sr,2)}%</td><td>${fmt(b.erab_sr,2)}%</td><td>${fmt(b.intra_hosr,2)}%</td><td>${fmt(b.inter_hosr,2)}%</td><td class="${prbClass}">${fmt(b.prb_util,0)}%</td><td>${b.n_cells}</td></tr>`;
  });
  th += '</tbody>';
  document.getElementById('bandTable').innerHTML = th;
}

// The Pies/Table and the KPI line charts each get their own independent
// From/To control now -- they used to share one, which meant narrowing
// one always narrowed the other.
function renderMajor(){
  // -- Pies & Carrier Summary Table: hour-index From/To (own state) --
  const hourLabels = DATA.major.lines.dl_volume_gb.times;
  const pieFromSel = document.getElementById('pieFrom'), pieToSel = document.getElementById('pieTo');
  pieFromSel.innerHTML = hourLabels.map((h,i)=>`<option value="${i}">${h}</option>`).join('');
  pieToSel.innerHTML = hourLabels.map((h,i)=>`<option value="${i}" ${i===hourLabels.length-1?'selected':''}>${h}</option>`).join('');
  function renderPies(){
    const fromI = parseInt(pieFromSel.value||0), toI = parseInt(pieToSel.value||(hourLabels.length-1));
    document.getElementById('majorScope').textContent = `Pies & table: ${hourLabels[fromI]} \u2192 ${hourLabels[toI]}`;
    renderBandSplit(fromI, toI);
  }
  pieFromSel.onchange = pieToSel.onchange = renderPies;
  renderPies();

  renderBandUtilCharts();

  // -- KPI Line Charts: From-date/To-date dropdowns + hour-of-day slider,
  // defaulting to the last 3 available days, full 0-23 hours --
  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromDateSel = document.getElementById('kpiFromDate'), toDateSel = document.getElementById('kpiToDate');
  fillDateSelect(fromDateSel, dates, dates[Math.max(0, dates.length-3)]);
  fillDateSelect(toDateSel, dates, dates[dates.length-1]);
  function renderKpiLines(lo, hi){
    const fromDate = fromDateSel.value, toDate = toDateSel.value;
    document.getElementById('majorRangeLabel').textContent =
      `${fmtDateDMY(fromDate)} \u2192 ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00\u2013${String(hi).padStart(2,'0')}:00 each day`;
    const C = document.getElementById('majorLineCharts');
    let html='';
    for(const col in DATA.major.lines){
      const s = DATA.major.lines[col];
      const f = filterByDateAndHourOfDay(s.dates, s.hours, s.values, fromDate, toDate, lo, hi);
      html += (f.dates.length===0)
        ? majorLine(s.label, s.unit, pickColor(col), [], [], [])
        : zMajorLine(s.label, s.unit, pickColor(col), f.dates, f.hours, f.values);
    }
    C.innerHTML = html;
  }
  const slider = buildHourSlider(document.getElementById('kpiHourSlider'), 0, 23, renderKpiLines);
  fromDateSel.onchange = toDateSel.onchange = ()=>renderKpiLines(slider.lo, slider.hi);
  renderKpiLines(slider.lo, slider.hi);
}
function pickColor(col){
  const palette = ['#3b82f6','#10b981','#f59e0b','#a855f7','#ef4444'];
  let h=0; for(const c of col) h += c.charCodeAt(0);
  return palette[h % palette.length];
}

// =====================================================================
// MLB / SRVCC / CA tab -- 25 KPIs, each with its OWN time axis (group-
// sourced and level-weighted columns can have different hour coverage,
// so charts are never index-sliced against a shared reference series).
// =====================================================================
function sparkSVG(values, color){
  const present = values.filter(v=>v!==null&&v!==undefined);
  if(present.length<2) return '<svg viewBox="0 0 180 34" width="100%" height="34"></svg>';
  const W=180,H=34,pad=3;
  const maxv=Math.max(...present), minv=Math.min(...present);
  const rng=(maxv-minv)||1;
  const n=values.length;
  const pts=[];
  values.forEach((v,i)=>{ if(v===null||v===undefined) return;
    const x=pad+(W-2*pad)*i/Math.max(n-1,1);
    const y=pad+(H-2*pad)*(1-(v-minv)/rng);
    pts.push([x,y]);
  });
  const poly=pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="34"><polyline fill="none" stroke="${color}" stroke-width="1.8" points="${poly}"/></svg>`;
}
function renderMlbSrvccCa(){
  const lines = DATA.mlbsrvccca.lines;
  const cardCols = DATA.mlbsrvccca.card_cols;

  // 5 headline cards -- ALWAYS the latest (max) available hour for each
  // KPI's own series, independent of whatever range the line charts below
  // are narrowed to.
  let cardHtml = '';
  cardCols.forEach(col=>{
    const s = lines[col];
    const color = pickColor(col);
    const present = s.values.filter(v=>v!==null&&v!==undefined);
    const last = present.length ? present[present.length-1] : null;
    const unit = s.unit === 'count' ? '' : (' '+s.unit);
    cardHtml += `<div class="msc-card">
      <div class="k-lbl">${s.label}</div>
      <div class="k-val">${last===null?'&mdash;':Number(last).toFixed(unit.trim()==='%'||unit.trim()==='Mbps'?1:0)}<small>${unit}</small></div>
      <div class="spark-wrap">${sparkSVG(s.values, color)}</div>
      <div class="hint">hover for full trend</div>
      <div class="expand-chart">${zMajorLine(s.label, s.unit, color, s.dates, s.hours, s.values)}</div>
    </div>`;
  });
  document.getElementById('mscCards').innerHTML = cardHtml;

  // 25 full line charts, driven by their own From-date/To-date + hour
  // slider (defaults to full available duration, same as before).
  const dates = uniqueDates(Object.values(lines)[0].dates);
  const fromDateSel = document.getElementById('mscFromDate'), toDateSel = document.getElementById('mscToDate');
  fillDateSelect(fromDateSel, dates, dates[0]);
  fillDateSelect(toDateSel, dates, dates[dates.length-1]);
  function renderMscLines(lo, hi){
    const fromDate = fromDateSel.value, toDate = toDateSel.value;
    document.getElementById('mscRangeLabel').textContent =
      `${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day`;
    let lineHtml = '';
    for(const col in lines){
      const s = lines[col];
      const f = filterByDateAndHourOfDay(s.dates, s.hours, s.values, fromDate, toDate, lo, hi);
      lineHtml += (f.dates.length===0)
        ? majorLine(s.label, s.unit, pickColor(col), [], [], [])
        : zMajorLine(s.label, s.unit, pickColor(col), f.dates, f.hours, f.values);
    }
    document.getElementById('mscLineCharts').innerHTML = lineHtml;
  }
  const slider = buildHourSlider(document.getElementById('mscHourSlider'), 0, 23, renderMscLines);
  fromDateSel.onchange = toDateSel.onchange = ()=>renderMscLines(slider.lo, slider.hi);
  renderMscLines(slider.lo, slider.hi);

  renderNoCaSites();
}

// Sites that had zero CA (Carrier Aggregation) users for the entire span
// of the latest ingested date (00:00 through its last available hour) --
// see queries.no_ca_sites(). Fixed to that date, independent of the
// From/To range above, same as the headline cards.
function renderNoCaSites(){
  const d = DATA.mlbsrvccca.no_ca_sites;
  const scope = document.getElementById('noCaScope');
  const table = document.getElementById('noCaTable');
  if(!d || !d.date || !d.sites.length){
    scope.textContent = d && d.date ? `${fmtDateDMY(d.date)} ${d.from_hour}–${d.to_hour} — every site had CA users` : 'No data';
    table.innerHTML = '';
    return;
  }
  scope.textContent = `${fmtDateDMY(d.date)}, ${d.from_hour}–${d.to_hour} — ${d.sites.length} of the network's sites had zero CA users the entire time`;
  let t = '<thead><tr><th>#</th><th>Site</th><th>Cells</th><th>Bands present</th></tr></thead><tbody>';
  d.sites.forEach((s,i)=>{
    t += `<tr class="clickable-row" onclick="loadNoCaSiteDrilldown('${escAttr(s.site)}',this)" title="Click for this site's CA Users Avg trend"><td>${i+1}</td><td class="cid">${esc(s.site)}</td><td>${s.n_cells}</td><td>${esc((s.bands||'').split(',').join(', '))}</td></tr>`;
  });
  t += '</tbody>';
  table.innerHTML = t;
  // a fresh table means any previously-open drill-down no longer matches a
  // visible row
  document.getElementById('noCaSiteDrill').classList.add('hidden');
  _noCaSelectedRow = null;
}

let _noCaSelectedRow = null;
function loadNoCaSiteDrilldown(site, trEl){
  const host = document.getElementById('noCaSiteDrill');
  const head = document.getElementById('noCaSiteDrillH');
  const body = document.getElementById('noCaSiteDrillCharts');
  if(_noCaSelectedRow) _noCaSelectedRow.classList.remove('sel-row');
  if(trEl){ trEl.classList.add('sel-row'); _noCaSelectedRow = trEl; }
  host.classList.remove('hidden');
  head.textContent = `${site} — CA Users Avg, last 4 days hourly`;
  body.innerHTML = '<div class="foot">Loading…</div>';
  host.scrollIntoView({behavior:'smooth', block:'nearest'});

  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromDate = dates[Math.max(0, dates.length-4)];
  const toDate = dates[dates.length-1];
  const qs = new URLSearchParams({site, from_date: fromDate, to_date: toDate, from_hour: 0, to_hour: 23});
  fetch('/api/site_kpis?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(!data.dates || !data.dates.length){
        body.innerHTML = '<div class="foot">No data for this site in range.</div>';
        return;
      }
      const panel = (data.panels||[]).find(p=>p.panel.startsWith('CA'));
      const chart = panel && panel.charts.find(c=>c.col === 'ca_user_avg_pct');
      if(!chart){
        body.innerHTML = '<div class="foot">CA Users Avg not available for this site.</div>';
        return;
      }
      const colorMap={}, labelMap={};
      data.cells.forEach((c,i)=>{
        colorMap[c.cell_name] = mcColor(i);
        labelMap[c.cell_name] = `${abbrBand(c.band)}${c.sector?' '+c.sector:''} (id ${c.local_cell_id})`;
      });
      const cellNames = Object.keys(chart.by_cell);
      // Rendered alone at full section width (no grid), unlike the other
      // multi-cell drill-downs -- a wide, short banner ratio instead of
      // the grid default, which would balloon to an enormous height here.
      const {html} = multiCellChart(chart.label, chart.unit, data.dates, data.hours, cellNames, chart.by_cell, colorMap, labelMap, data.site, 1150, 340);
      body.innerHTML = html;
      document.querySelectorAll('#noCaSiteDrillCharts .zchart[data-zid]').forEach(h=>_mcWireLegend(h.dataset.zid, h));
    })
    .catch(err=>{
      body.innerHTML = `<div class="foot">Failed to load: ${err.message} — requires the server (uv run src/server.py).</div>`;
    });
}

function smoothPath(pts){
  if(pts.length<2) return pts.length===1 ? '' : '';
  let d='M'+pts[0][0].toFixed(1)+','+pts[0][1].toFixed(1);
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=' C'+c1x.toFixed(1)+','+c1y.toFixed(1)+' '+c2x.toFixed(1)+','+c2y.toFixed(1)+' '+p2[0].toFixed(1)+','+p2[1].toFixed(1);
  }
  return d;
}
// ---- day/hour axis helpers (Excel-style two-row axis, matching
// datamis/sample.jpg: "12:00:00 am" hour ticks on top, DD/MM/YYYY date
// centered under each day's span below, with a divider line at day
// boundaries) shared by every line chart in the app ----
function fmtHourAMPM(hstr){
  if(!hstr) return '';
  const h = parseInt(hstr.split(':')[0], 10);
  const mm = (hstr.split(':')[1]||'00').padStart(2,'0');
  const ampm = h < 12 ? 'am' : 'pm';
  let h12 = h % 12; if(h12===0) h12 = 12;
  return `${h12}:${mm}:00 ${ampm}`;
}
function fmtDateDMY(dstr){
  if(!dstr) return '';
  const [y,m,d] = dstr.split('-');
  return `${d}/${m}/${y}`;
}
function niceHourStep(n){
  // pick the coarsest divisor-of-24 hour step that still gives ~6 ticks
  // total across the chart, so labels never overlap regardless of how
  // many days are in the selected range
  const nice=[1,2,3,4,6,8,12,24];
  const raw = n/6;
  for(const s of nice){ if(s>=raw) return s; }
  return 24;
}
// Renders the shared dual-row X axis (hour ticks + day labels + day
// dividers) into an existing chart's coordinate space. X(i) maps a data
// index to a pixel x; ticksY/rulesY/dateY/dividerTop/dividerBottom are the
// y-coordinates for each element, sized differently by the two chart
// styles that use this (majorLine vs lineChartReal).
function dayHourAxis(dates, hours, n, X, opts){
  const {ticksY, ruleY, dateY, dividerTop, dividerBottom, tickSize, dateSize, tickColor, dateColor, ruleColor} = opts;
  let xl = '', dividers = '';
  const step = niceHourStep(n);
  for(let i=0;i<n;i++){
    const hh = hours[i] ? parseInt(hours[i].split(':')[0],10) : null;
    if(hh===null || hh % step !== 0) continue;
    xl += `<text x="${X(i).toFixed(1)}" y="${ticksY}" fill="${tickColor}" font-size="${tickSize}" font-weight="700" text-anchor="middle" font-family="monospace">${fmtHourAMPM(hours[i])}</text>`;
  }
  xl += `<line x1="${X(0).toFixed(1)}" y1="${ruleY}" x2="${X(n-1).toFixed(1)}" y2="${ruleY}" stroke="${ruleColor}" stroke-width="0.6"/>`;
  let groupStart = 0;
  for(let i=1;i<=n;i++){
    if(i===n || dates[i]!==dates[groupStart]){
      const xMid = (X(groupStart)+X(i-1))/2;
      xl += `<text x="${xMid.toFixed(1)}" y="${dateY}" fill="${dateColor}" font-size="${dateSize}" font-weight="700" text-anchor="middle" font-family="monospace">${fmtDateDMY(dates[groupStart])}</text>`;
      if(i<n){
        const xB = (X(i-1)+X(i))/2;
        dividers += `<line x1="${xB.toFixed(1)}" y1="${dividerTop}" x2="${xB.toFixed(1)}" y2="${dividerBottom}" stroke="var(--chart-rule)" stroke-width="0.8"/>`;
      }
      groupStart = i;
    }
  }
  return {labels: xl, dividers};
}

// =====================================================================
// Shared range-control utilities: date dropdowns + dual-handle hour-of-day
// slider, used by Major KPIs (KPI charts), MLB_SRVCC_CA (line charts) and
// LayerWise Analysis (Pre/Post range) alike.
// =====================================================================
function uniqueDates(datesArr){
  const seen = new Set(), out = [];
  datesArr.forEach(d=>{ if(d && !seen.has(d)){ seen.add(d); out.push(d); } });
  return out; // already chronological -- source arrays are ORDER BY date,time
}
function fillDateSelect(sel, dates, selected){
  sel.innerHTML = dates.map(d=>`<option value="${d}" ${d===selected?'selected':''}>${fmtDateDMY(d)}</option>`).join('');
}
// Builds a dual-handle 0-23 hour-of-day slider inside `container`.
// onChange(lo,hi) fires on every drag tick (but NOT during setup -- the
// caller does one explicit initial render after wiring everything up, so
// the callback never fires before the caller's own state, e.g. a `slider`
// variable it closes over, is actually assigned).
function buildHourSlider(container, lo, hi, onChange){
  container.classList.add('range-slider-wrap');
  container.innerHTML = `<div class="range-slider">
      <div class="rs-track"></div><div class="rs-fill"></div>
      <input type="range" min="0" max="23" step="1" class="rs-lo">
      <input type="range" min="0" max="23" step="1" class="rs-hi">
    </div><span class="rs-label"></span>`;
  const loEl = container.querySelector('.rs-lo'), hiEl = container.querySelector('.rs-hi');
  const fill = container.querySelector('.rs-fill'), label = container.querySelector('.rs-label');
  loEl.value = lo; hiEl.value = hi;
  const pad = v => String(v).padStart(2,'0');
  function paint(){
    const a = parseInt(loEl.value,10), b = parseInt(hiEl.value,10);
    const pct = v => 100*v/23;
    fill.style.left = pct(a)+'%'; fill.style.width = Math.max(0,pct(b)-pct(a))+'%';
    label.textContent = `${pad(a)}:00–${pad(b)}:00`;
  }
  function onInput(fromLo){
    let a = parseInt(loEl.value,10), b = parseInt(hiEl.value,10);
    if(a>b){ if(fromLo) b=a; else a=b; loEl.value=a; hiEl.value=b; }
    paint();
    onChange(a,b);
  }
  loEl.addEventListener('input', ()=>onInput(true));
  hiEl.addEventListener('input', ()=>onInput(false));
  paint();
  return {get lo(){return parseInt(loEl.value,10);}, get hi(){return parseInt(hiEl.value,10);}};
}
// Given parallel dates/hours/values arrays (chronological), a date range,
// and an hour-of-day range, returns the filtered {dates,hours,values} for
// only the hours-of-day in [fromHour,toHour] on EVERY date in
// [fromDate,toDate] -- e.g. From/To = 23/08-25/08 with hours 08:00-20:00
// keeps just 08:00-20:00 on the 23rd, the 24th, AND the 25th, not a single
// span trimmed at the two ends. This is not necessarily contiguous in the
// source arrays, so it returns the actual filtered values (not slice
// bounds) -- the day/hour axis still groups correctly since it just looks
// at consecutive equal dates in whatever it's given.
function filterByDateAndHourOfDay(dates, hours, vals, fromDate, toDate, fromHour, toHour){
  const fd=[], fh=[], fv=[];
  for(let i=0;i<dates.length;i++){
    const d = dates[i];
    if(d < fromDate || d > toDate) continue;
    const h = hours[i] ? parseInt(hours[i].split(':')[0],10) : 0;
    if(h < fromHour || h > toHour) continue;
    fd.push(d); fh.push(hours[i]); fv.push(vals[i]);
  }
  return {dates: fd, hours: fh, values: fv};
}

// =====================================================================
// Drag-to-zoom for line charts. Wraps a chart-drawing function so any
// majorLine/lineChartReal instance can be dragged over to zoom into a
// time slice, with a "Reset zoom" button to return to the full range.
// =====================================================================
const _zoomState = {};
let _zoomSeq = 0;
function zoomable(renderer, dates, hours, vals, geom){
  const id = 'z'+(_zoomSeq++);
  _zoomState[id] = {renderer, fullDates:dates, fullHours:hours, fullVals:vals, from:0, to:Math.max(0,vals.length-1), geom};
  return `<div class="zchart" data-zid="${id}">${renderer(dates,hours,vals)}</div>`;
}
function _zoomRerender(id){
  const st = _zoomState[id];
  const host = document.querySelector(`.zchart[data-zid="${id}"]`);
  if(!st || !host) return;
  const d = st.fullDates.slice(st.from, st.to+1);
  const h = st.fullHours.slice(st.from, st.to+1);
  let html, fullLen;
  if(st.kind === 'multi'){
    const cellNames = Object.keys(st.fullSeriesMap);
    const sliced = {}; cellNames.forEach(cn=>{ sliced[cn] = st.fullSeriesMap[cn].slice(st.from, st.to+1); });
    html = drawMultiCellSVG(st.title, st.unit, d, h, cellNames, sliced, st.colorMap, st.labelMap, st.W, st.H, st.hidden, st.siteName);
    fullLen = st.fullDates.length;
  } else {
    const v = st.fullVals.slice(st.from, st.to+1);
    html = st.renderer(d,h,v);
    fullLen = st.fullVals.length;
  }
  if(st.from>0 || st.to<fullLen-1){
    html += `<button class="zoom-reset" onclick="_zoomReset('${id}')">&#8634; Reset zoom</button>`;
  }
  host.innerHTML = html;
  if(st.kind === 'multi') _mcWireLegend(id, host);
}
function _zoomReset(id){
  const st = _zoomState[id];
  if(!st) return;
  st.from = 0;
  st.to = (st.kind === 'multi' ? st.fullDates.length : st.fullVals.length) - 1;
  _zoomRerender(id);
}
function zMajorLine(title, unit, color, dates, hours, vals){
  return zoomable((d,h,v)=>majorLine(title,unit,color,d,h,v), dates, hours, vals, {W:380,pl:48,pr:16});
}
function zLineChartReal(title, cellId, unit, color, dates, hours, vals){
  return zoomable((d,h,v)=>lineChartReal(title,cellId,unit,color,d,h,v), dates, hours, vals, {W:380,pl:44,pr:14});
}
(function initZoomDrag(){
  let drag = null;
  document.addEventListener('mousedown', e=>{
    const svg = e.target.closest('.zchart svg');
    if(!svg) return;
    const host = e.target.closest('.zchart');
    const st = _zoomState[host.dataset.zid];
    if(!st || (st.to - st.from + 1) < 3) return; // nothing meaningful to zoom into
    const rect = svg.getBoundingClientRect();
    drag = {id: host.dataset.zid, rect, x0: e.clientX};
    const band = document.createElement('div');
    band.className = 'zoom-band';
    band.style.top = '0'; band.style.height = rect.height+'px';
    band.style.left = (e.clientX-rect.left)+'px'; band.style.width = '0px';
    host.appendChild(band);
    drag.band = band;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(drag){
      const x1 = Math.min(drag.x0, e.clientX), x2 = Math.max(drag.x0, e.clientX);
      drag.band.style.left = (x1-drag.rect.left)+'px';
      drag.band.style.width = (x2-x1)+'px';
      return;
    }
    _mcTooltipMove(e);
  });
  document.addEventListener('mouseup', e=>{
    if(!drag) return;
    const st = _zoomState[drag.id];
    const x1 = Math.min(drag.x0, e.clientX), x2 = Math.max(drag.x0, e.clientX);
    drag.band.remove();
    if(st && x2-x1 > 6){
      const n = st.to - st.from + 1;
      const {W,pl,pr} = st.geom;
      const plotW = W-pl-pr;
      const scale = drag.rect.width / W; // css px per viewBox unit
      const toIdx = clientX => ((clientX-drag.rect.left)/scale - pl) / plotW * Math.max(n-1,1);
      let i1 = Math.round(toIdx(x1)), i2 = Math.round(toIdx(x2));
      i1 = Math.max(0, Math.min(n-1, i1));
      i2 = Math.max(0, Math.min(n-1, i2));
      if(i2 > i1){
        const newFrom = st.from + i1, newTo = st.from + i2;
        st.from = newFrom; st.to = newTo;
        _zoomRerender(drag.id);
      }
    }
    drag = null;
  });
})();

// =====================================================================
// SITE KPIs -- one site's cells, every KPI grouped into panels, one
// line per LocalCellId. Data is fetched live from /api/site_kpis (see
// server.py) since baking full cell-level history for 900+ sites into
// the static bundle doesn't scale -- this tab needs the server running.
// =====================================================================
const MC_PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#22d3ee','#f472b6','#84cc16','#fb923c','#818cf8','#2dd4bf','#facc15','#fb7185','#4ade80','#60a5fa','#c084fc'];
function mcColor(i){ return MC_PALETTE[i % MC_PALETTE.length]; }
function escAttr(s){ return esc(s).replace(/"/g,'&quot;'); }
// Short band label for legend rows, per customer example -- L850->L8,
// L900->L9, L1800->L18, L2100->L21, L2600->L26 (every band here ends in
// two trailing zeros except L850, whose "50" also drops cleanly the same
// way: strip the last 2 characters).
function abbrBand(band){
  if(!band) return '?';
  if(band==='Indoor' || band==='Unknown') return band;
  return band.length>2 ? band.slice(0,-2) : band;
}

// Draws the inner content (header + svg + legend) for one multi-cell
// chart. Pure function of its inputs -- called for the normal-size card,
// after a zoom, and for the enlarged modal, all the same way.
function drawMultiCellSVG(title, unit, dates, hours, cellNames, seriesMap, colorMap, labelMap, W, H, hiddenSet, siteName){
  const siteLine = siteName ? `<div class="mc-site" title="${escAttr(siteName)}">${esc(siteName)}</div>` : '';
  // Tighter margins than the original (pt 34->20, pb 56->40) -- the old
  // bottom margin left ~23px of dead SVG canvas below the date labels
  // before the legend even started, which combined with the legend's own
  // margin-top read as a large, unintentional-looking gap. This also
  // hands the plot area itself ~20% more vertical room to draw in.
  const pl=48, pr=14, pt=20, pb=40;
  let allVals = [];
  cellNames.forEach(cn=>(seriesMap[cn]||[]).forEach(v=>{ if(v!==null&&v!==undefined) allVals.push(v); }));
  const maxBtn = `<button class="mc-max-btn" title="Enlarge" onclick="event.stopPropagation()">&#10021;</button>`;
  if(allVals.length===0){
    return `${siteLine}<div class="mc-head"><span class="mc-title">${esc(title)}</span><span class="mc-unit">${esc(unit)}</span>${maxBtn}</div><div class="foot">no data in range</div>`;
  }
  let maxv=Math.max(...allVals), minv=Math.min(...allVals);
  const pad=(maxv-minv)*0.12||Math.abs(maxv)*0.1||1;
  maxv+=pad;
  // Only let the padded floor go negative if the real data actually does
  // (e.g. a dBm metric) -- KPIs like %, GB, users, Mbps never go below 0,
  // so padding them below 0 just to give the line breathing room produced
  // a confusing negative axis label for metrics that can never be negative.
  minv = minv>=0 ? Math.max(0, minv-pad) : minv-pad;
  const rng=(maxv-minv)||1, n=dates.length;
  const X=i=>pl+(W-pl-pr)*i/Math.max(n-1,1);
  const Y=v=>pt+(H-pt-pb)*(1-(v-minv)/rng);

  let grid='';
  for(let k=0;k<=4;k++){ const gy=pt+(H-pt-pb)*k/4; const gv=maxv-(rng*k/4);
    grid+=`<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="0.6"/><text x="${pl-7}" y="${(gy+3).toFixed(1)}" fill="var(--chart-ink)" font-size="8.5" font-weight="700" text-anchor="end" font-family="monospace">${gv.toFixed(gv<10?1:0)}</text>`; }

  const axis = dates.some(d=>d) ? dayHourAxis(dates, hours, n, X, {
    ticksY:H-pb+8, ruleY:H-pb+13, dateY:H-pb+25, dividerTop:pt, dividerBottom:H-pb,
    tickSize:8, dateSize:8.5, tickColor:'var(--chart-ink)', dateColor:'var(--chart-ink2)', ruleColor:'var(--chart-grid)',
  }) : {labels:'', dividers:''};

  let linesSvg='', defs='';
  cellNames.forEach(cn=>{
    const vals = seriesMap[cn] || [];
    const pts = vals.map((v,i)=> v===null||v===undefined?null:[X(i),Y(v)]).filter(p=>p!==null);
    if(pts.length===0) return;
    const color = colorMap[cn] || '#888';
    const gid = 'mcg'+(_gid++);
    const hiddenCls = hiddenSet.has(cn) ? ' hidden-line' : '';
    defs += `<filter id="${gid}" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="${color}" flood-opacity="0.6"/></filter>`;
    linesSvg += `<path class="mc-line${hiddenCls}" data-cell="${escAttr(cn)}" d="${smoothPath(pts)}" stroke="${color}" filter="url(#${gid})"/>`;
    const last = pts[pts.length-1];
    linesSvg += `<circle class="mc-dot${hiddenCls}" data-cell="${escAttr(cn)}" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.2" fill="${color}"/>`;
  });

  // Legend lives to the right of the chart, one plain row per line -- no
  // pill/box around each entry (per direct customer feedback), just a
  // short line-segment swatch (matching the actual chart line) and text.
  // "Show All" / "Deselect All" are plain text controls, not buttons.
  const legend = `<div class="mc-legend-col">
    <div class="mc-legend-ctl">
      <span class="mc-lctl" data-act="all">Show All</span><span class="mc-lctl-sep">&middot;</span><span class="mc-lctl" data-act="none">Deselect All</span>
    </div>
    <div class="mc-legend-list">
      ${cellNames.map(cn=>{
        const color = colorMap[cn] || '#888';
        return `<div class="mc-lrow${hiddenSet.has(cn)?' off':''}" data-cell="${escAttr(cn)}"><svg class="mc-lineswatch" width="14" height="8" viewBox="0 0 14 8"><line x1="1" y1="4" x2="13" y2="4" stroke="${color}" stroke-width="3" stroke-linecap="round"/></svg><span>${esc(labelMap[cn]||cn)}</span></div>`;
      }).join('')}
    </div>
  </div>`;

  return `${siteLine}<div class="mc-head"><span class="mc-title">${esc(title)}</span><span class="mc-unit">${esc(unit)}</span>${maxBtn}</div>
    <div class="mc-body">
      <div class="mc-chart-col"><svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><defs>${defs}</defs>
      ${grid}${axis.dividers}${linesSvg}${axis.labels}</svg></div>
      ${legend}
    </div>`;
}

// Registers a new multi-cell chart's zoom/toggle state and returns its
// {id, html} for the normal (grid) size. Toggling a legend chip mutates
// state.hidden and flips DOM classes directly (no re-render needed);
// zooming re-renders through drawMultiCellSVG via _zoomRerender, which
// re-applies the current hidden set so toggles survive a zoom.
function multiCellChart(title, unit, dates, hours, cellNames, seriesMap, colorMap, labelMap, siteName, W, H){
  // Taller aspect ratio (was 380x230, ~1.65:1) -- with up to a dozen-plus
  // overlapping series, a short chart compresses every line into too few
  // vertical pixels to tell apart. 400x340 (~1.18:1) renders noticeably
  // taller at the same container width, since the SVG is width:100% and
  // scales by this ratio. This is the right ratio inside a 2-column grid
  // (Site KPIs, Traffic Balancing, L2600), where the container itself is
  // only ~half page width -- but a chart rendered ALONE at full page
  // width (no grid) would balloon to an enormous height at that same
  // ratio, so callers doing that should pass a wider W/H explicitly.
  W = W || 400; H = H || 340;
  const id = 'z'+(_zoomSeq++);
  _zoomState[id] = {kind:'multi', title, unit, colorMap, labelMap, siteName, W, H, hidden:new Set(),
    fullDates:dates, fullHours:hours, fullSeriesMap:seriesMap,
    from:0, to:Math.max(0,dates.length-1), geom:{W,pl:48,pr:14}};
  const inner = drawMultiCellSVG(title, unit, dates, hours, cellNames, seriesMap, colorMap, labelMap, W, H, new Set(), siteName);
  return {id, html: `<div class="zchart mc-card" data-zid="${id}">${inner}</div>`};
}

function _mcWireLegend(id, hostEl){
  const st = _zoomState[id];
  if(!st) return;
  hostEl.querySelectorAll('.mc-lrow[data-cell]').forEach(row=>{
    const cn = row.dataset.cell;
    row.onclick = ()=>{
      if(st.hidden.has(cn)) st.hidden.delete(cn); else st.hidden.add(cn);
      row.classList.toggle('off');
      hostEl.querySelectorAll(`.mc-line[data-cell="${CSS.escape(cn)}"], .mc-dot[data-cell="${CSS.escape(cn)}"]`)
        .forEach(el=>el.classList.toggle('hidden-line'));
    };
    // Hovering a row highlights just that line (dims every other one)
    // without touching the persistent show/hide state -- picking out "a
    // particular" series is now a hover, not a series of clicks.
    row.addEventListener('mouseenter', ()=>{
      if(st.hidden.has(cn)) return;
      hostEl.querySelectorAll('.mc-line[data-cell], .mc-dot[data-cell]').forEach(el=>{
        if(el.dataset.cell !== cn) el.classList.add('mc-dimmed');
      });
      hostEl.querySelectorAll(`.mc-line[data-cell="${CSS.escape(cn)}"]`).forEach(el=>el.classList.add('mc-solo'));
    });
    row.addEventListener('mouseleave', ()=>{
      hostEl.querySelectorAll('.mc-dimmed').forEach(el=>el.classList.remove('mc-dimmed'));
      hostEl.querySelectorAll('.mc-solo').forEach(el=>el.classList.remove('mc-solo'));
    });
  });
  const allCtl = hostEl.querySelector('.mc-lctl[data-act="all"]');
  if(allCtl) allCtl.onclick = ()=>{
    st.hidden.clear();
    hostEl.querySelectorAll('.mc-lrow[data-cell]').forEach(r=>r.classList.remove('off'));
    hostEl.querySelectorAll('.mc-line, .mc-dot').forEach(el=>el.classList.remove('hidden-line'));
  };
  const noneCtl = hostEl.querySelector('.mc-lctl[data-act="none"]');
  if(noneCtl) noneCtl.onclick = ()=>{
    hostEl.querySelectorAll('.mc-lrow[data-cell]').forEach(r=>{ st.hidden.add(r.dataset.cell); r.classList.add('off'); });
    hostEl.querySelectorAll('.mc-line, .mc-dot').forEach(el=>el.classList.add('hidden-line'));
  };
  const maxBtn = hostEl.querySelector('.mc-max-btn');
  if(maxBtn) maxBtn.onclick = e=>{ e.stopPropagation(); openChartModal(id); };
}

// Hovering anywhere over the plot finds the nearest visible line/point to
// the cursor and shows its exact value in a floating tooltip, highlighting
// that one line the same way a legend-row hover does. Wired into the
// existing drag-zoom mousemove listener below so it's skipped mid-drag.
let _mcTipEl = null;
function _mcTip(){
  if(!_mcTipEl){ _mcTipEl = document.createElement('div'); _mcTipEl.className = 'mc-tooltip hidden'; document.body.appendChild(_mcTipEl); }
  return _mcTipEl;
}
function _mcTooltipHide(){
  _mcTip().classList.add('hidden');
  document.querySelectorAll('.mc-dimmed').forEach(el=>el.classList.remove('mc-dimmed'));
  document.querySelectorAll('.mc-solo').forEach(el=>el.classList.remove('mc-solo'));
}
function _mcTooltipMove(e){
  const svg = e.target.closest('svg');
  const card = svg && svg.closest('.zchart.mc-card');
  if(!svg || !card){ _mcTooltipHide(); return; }
  const st = _zoomState[card.dataset.zid];
  if(!st || st.kind !== 'multi'){ _mcTooltipHide(); return; }

  const rect = svg.getBoundingClientRect();
  if(rect.width <= 0){ _mcTooltipHide(); return; }
  const scale = rect.width / st.W;
  const mx = (e.clientX - rect.left) / scale, my = (e.clientY - rect.top) / scale;

  const pl=48, pr=14, pt=20, pb=40; // must match drawMultiCellSVG's own margins
  if(mx < pl-6 || mx > st.W-pr+6 || my < pt-6 || my > st.H-pb+6){ _mcTooltipHide(); return; }

  const d = st.fullDates.slice(st.from, st.to+1);
  const hh = st.fullHours.slice(st.from, st.to+1);
  const cellNames = Object.keys(st.fullSeriesMap);
  const n = d.length;
  if(n < 1){ _mcTooltipHide(); return; }
  const sliced = {}; cellNames.forEach(cn=>{ sliced[cn] = st.fullSeriesMap[cn].slice(st.from, st.to+1); });
  let allVals = []; cellNames.forEach(cn=>(sliced[cn]||[]).forEach(v=>{ if(v!==null&&v!==undefined) allVals.push(v); }));
  if(!allVals.length){ _mcTooltipHide(); return; }
  let maxv=Math.max(...allVals), minv=Math.min(...allVals);
  const pad=(maxv-minv)*0.12||Math.abs(maxv)*0.1||1;
  maxv+=pad;
  minv = minv>=0 ? Math.max(0, minv-pad) : minv-pad; // must match drawMultiCellSVG exactly
  const rng=(maxv-minv)||1;
  const plotW = st.W-pl-pr;
  const Yf = v=>pt+(st.H-pt-pb)*(1-(v-minv)/rng);

  let idx = Math.round((mx-pl)/plotW*(n-1));
  idx = Math.max(0, Math.min(n-1, idx));

  let best=null, bestDist=Infinity;
  cellNames.forEach(cn=>{
    if(st.hidden.has(cn)) return;
    const v = sliced[cn][idx];
    if(v===null || v===undefined) return;
    const dist = Math.abs(Yf(v)-my);
    if(dist < bestDist){ bestDist = dist; best = {cn, v}; }
  });
  if(!best || bestDist > 36){ _mcTooltipHide(); return; }

  document.querySelectorAll('.mc-dimmed').forEach(el=>el.classList.remove('mc-dimmed'));
  document.querySelectorAll('.mc-solo').forEach(el=>el.classList.remove('mc-solo'));
  card.querySelectorAll('.mc-line[data-cell], .mc-dot[data-cell]').forEach(el=>{
    if(el.dataset.cell !== best.cn) el.classList.add('mc-dimmed');
  });
  card.querySelectorAll(`.mc-line[data-cell="${CSS.escape(best.cn)}"]`).forEach(el=>el.classList.add('mc-solo'));

  const tip = _mcTip();
  const label = st.labelMap[best.cn] || best.cn;
  const color = st.colorMap[best.cn] || '#888';
  tip.innerHTML = `<div class="mc-tip-label" style="color:${color}">${esc(label)}</div><div class="mc-tip-val">${fmt(best.v,2)} <span class="mc-tip-unit">${esc(st.unit)}</span></div><div class="mc-tip-time">${fmtDateDMY(d[idx])} ${fmtHourAMPM(hh[idx])}</div>`;
  tip.classList.remove('hidden');
  const vw = window.innerWidth, vh = window.innerHeight, off = 14;
  let left = e.clientX + off, top = e.clientY + off;
  if(left + 170 > vw) left = e.clientX - 170 - off;
  if(top + 74 > vh) top = e.clientY - 74 - off;
  tip.style.left = left+'px';
  tip.style.top = top+'px';
}

function openChartModal(id){
  const st = _zoomState[id];
  if(!st) return;
  const bigW=860, bigH=440;
  const modalId = id+'-modal';
  const d = st.fullDates.slice(st.from, st.to+1);
  const h = st.fullHours.slice(st.from, st.to+1);
  const cellNames = Object.keys(st.fullSeriesMap);
  const sliced = {}; cellNames.forEach(cn=>{ sliced[cn] = st.fullSeriesMap[cn].slice(st.from, st.to+1); });
  _zoomState[modalId] = {kind:'multi', title:st.title, unit:st.unit, colorMap:st.colorMap, labelMap:st.labelMap, siteName:st.siteName,
    W:bigW, H:bigH, hidden:st.hidden, // shared Set -- toggling in the modal keeps the small card in sync
    fullDates:st.fullDates, fullHours:st.fullHours, fullSeriesMap:st.fullSeriesMap,
    from:st.from, to:st.to, geom:{W:bigW,pl:48,pr:14}};
  const body = document.getElementById('chartModalBody');
  body.innerHTML = `<div class="zchart mc-card" data-zid="${modalId}">${drawMultiCellSVG(st.title, st.unit, d, h, cellNames, sliced, st.colorMap, st.labelMap, bigW, bigH, st.hidden, st.siteName)}</div>`;
  _mcWireLegend(modalId, body);
  document.getElementById('chartModal').classList.remove('hidden');
}
function closeChartModal(){
  document.getElementById('chartModal').classList.add('hidden');
  document.getElementById('chartModalBody').innerHTML = '';
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeChartModal(); closeDeleteDataModal(); } });

// Enlarge button on a static chart card (.enl-card): Traffic Split pies,
// Data & Voice Utilization bars, Group KPI Trends lines, LayerWise
// Rejections. Copies the card as currently drawn (so a zoomed-in Group
// KPI chart opens zoomed) into the shared #chartModal; .enlarge-view CSS
// scales it up. The copy sits outside any .zchart, so drag-zoom inside
// the modal is inert rather than acting on the original card.
function enlargeBtn(){
  return `<button class="enlarge-btn" title="Enlarge" onclick="openEnlarge(this)">&#10021;</button>`;
}
// Charts whose enlarged view is re-drawn at a different size instead of
// copied (a straight copy of an already full-width chart wouldn't get
// any bigger).
const ENLARGE_RENDERERS = {
  l2600Hourly: ()=>l2600DualBarChart(DATA.l2600.hourly_bands || [], 'large'),
};
function openEnlarge(btn){
  const card = btn.closest('.enl-card');
  if(!card) return;
  const render = ENLARGE_RENDERERS[card.dataset.enlRender];
  let copy;
  if(render){
    const tmp = document.createElement('div');
    tmp.innerHTML = render();
    copy = tmp.firstElementChild;
  } else {
    copy = card.cloneNode(true);
  }
  copy.querySelectorAll('.enlarge-btn, .zoom-reset').forEach(el=>el.remove());
  copy.classList.remove('enl-card');
  const title = card.dataset.enlTitle;
  const body = document.getElementById('chartModalBody');
  body.innerHTML = (title ? `<div class="enlarge-title">${title}</div>` : '') + `<div class="enlarge-view"></div>`;
  body.querySelector('.enlarge-view').appendChild(copy);
  document.getElementById('chartModal').classList.remove('hidden');
}

function buildSiteCharts(data, containerId){
  containerId = containerId || 'sitePanels';
  const container = document.getElementById(containerId);
  if(!data || !data.panels || !data.panels.length){ container.innerHTML=''; return; }
  const colorMap={}, labelMap={};
  data.cells.forEach((c,i)=>{
    colorMap[c.cell_name] = mcColor(i);
    labelMap[c.cell_name] = `${abbrBand(c.band)}${c.sector?' '+c.sector:''} (id ${c.local_cell_id})`;
  });

  let html='';
  data.panels.forEach(panel=>{
    let chartsHtml='';
    panel.charts.forEach(ch=>{
      const cellNames = Object.keys(ch.by_cell);
      const {html: cardHtml} = multiCellChart(ch.label, ch.unit, data.dates, data.hours, cellNames, ch.by_cell, colorMap, labelMap, data.site);
      chartsHtml += cardHtml;
    });
    html += `<div class="cpanel">
      <div class="cphead" onclick="togglePanel(this)"><h3>${esc(panel.panel)}</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody"><div class="grid c2">${chartsHtml}</div></div>
    </div>`;
  });
  container.innerHTML = html;
  document.querySelectorAll(`#${containerId} .zchart[data-zid]`).forEach(host=>_mcWireLegend(host.dataset.zid, host));
}

let _siteSlider = null;
function renderSiteKpiTab(){
  const sites = (DATA.sitekpi && DATA.sitekpi.sites) || [];
  document.getElementById('siteList').innerHTML =
    sites.map(s=>`<option value="${escAttr(s.site)}">${s.n_cells} cell(s)</option>`).join('');

  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  fillDateSelect(document.getElementById('siteFromDate'), dates, dates[0]);
  fillDateSelect(document.getElementById('siteToDate'), dates, dates[dates.length-1]);
  _siteSlider = buildHourSlider(document.getElementById('siteHourSlider'), 0, 23, ()=>{});
}

function loadSiteKpis(){
  const site = document.getElementById('siteInput').value.trim();
  const status = document.getElementById('siteStatus');
  if(!site){ status.textContent = 'Pick a site first.'; return; }
  const fromDate = document.getElementById('siteFromDate').value;
  const toDate = document.getElementById('siteToDate').value;
  const lo = _siteSlider.lo, hi = _siteSlider.hi;
  status.textContent = `Loading ${site}…`;
  const qs = new URLSearchParams({site, from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/site_kpis?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(!data.dates || !data.dates.length){
        status.textContent = `No data for "${site}" in that range.`;
        document.getElementById('sitePanels').innerHTML = '';
        return;
      }
      status.textContent = `${site} — ${data.cells.length} cell(s), ${data.dates.length} hourly point(s). Click a legend chip to hide/show a cell, ✡ to enlarge, drag a chart to zoom.`;
      buildSiteCharts(data);
    })
    .catch(err=>{
      status.textContent = 'Failed to load: ' + err.message + ' — this tab requires the server (uv run src/server.py).';
    });
}

// Note: the MLB_SRVCC_CA hover flyout (card -> full chart to the right)
// is handled entirely in CSS now (.msc-card:hover .expand-chart) -- see
// style.css. No JS wiring needed; nothing here to break.

let _gid=0;
function majorLine(title, unit, color, dates, hours, vals){
  const clean = vals.map(v=>v===null||v===undefined?null:v);
  const present = clean.filter(v=>v!==null);
  if(present.length===0){
    return `<div class="card lc"><div class="lc-head"><span class="lc-title">${title}</span><span class="lc-unit">${unit}</span></div><div class="foot">no data in range</div></div>`;
  }
  const W=380,H=210,pl=48,pr=16,pt=34,pb=56;
  let maxv=Math.max(...present), minv=Math.min(...present);
  const pad=(maxv-minv)*0.15||Math.abs(maxv)*0.1||1;
  maxv+=pad;
  // See drawMultiCellSVG's identical comment -- don't pad a non-negative
  // metric below 0, that's what was showing confusing negative axis labels.
  minv = minv>=0 ? Math.max(0, minv-pad) : minv-pad;
  const rng=(maxv-minv)||1, n=clean.length;
  const X=i=>pl+(W-pl-pr)*i/(Math.max(n-1,1));
  const Y=v=>pt+(H-pt-pb)*(1-(v-minv)/rng);
  const pts = clean.map((v,i)=>v===null?null:[X(i),Y(v)]).filter(p=>p!==null);
  const line = smoothPath(pts);
  const area = pts.length>1 ? line+' L'+pts[pts.length-1][0].toFixed(1)+','+(H-pb)+' L'+pts[0][0].toFixed(1)+','+(H-pb)+' Z' : '';
  const gid='grad'+(_gid++);
  let grid='';
  for(let k=0;k<=4;k++){ const gy=pt+(H-pt-pb)*k/4; const gv=maxv-(rng*k/4);
    grid+=`<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="0.6"/><text x="${pl-7}" y="${(gy+3).toFixed(1)}" fill="var(--chart-ink)" font-size="8.5" font-weight="700" text-anchor="end" font-family="monospace">${gv.toFixed(gv<10?1:0)}</text>`; }
  const axis = dayHourAxis(dates, hours, n, X, {
    ticksY: H-pb+14, ruleY: H-pb+20, dateY: H-pb+33, dividerTop: pt, dividerBottom: H-pb,
    tickSize: 8, dateSize: 8.5, tickColor: 'var(--chart-ink)', dateColor: 'var(--chart-ink2)', ruleColor: 'var(--chart-grid)',
  });
  const last = pts[pts.length-1];
  const dot = last ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="${color}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6" fill="${color}" opacity="0.25"/>` : '';
  return `<div class="card lc enl-card" data-enl-title="Group KPI Trends &mdash; ${escAttr(title)}"><div class="lc-head"><span class="lc-title">${title}</span><span class="lc-unit">${unit}</span>${enlargeBtn()}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.35"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}${axis.dividers}<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${dot}${axis.labels}
    <text x="${pl}" y="18" fill="var(--faint)" font-size="8.5" font-family="monospace">Y: ${unit}</text></svg></div>`;
}

// =====================================================================
// LAYERWISE -- aggregated over the selected From-date/To-date + hour
// range (no more Pre/Post snapshot comparison: the customer only wants
// one aggregated value per band/layer, e.g. an average, over the whole
// range). Reuses DATA.major.band_hourly -- the same raw per-hour,
// per-band dataset Major KPIs' Traffic Split per Carrier already sums
// over a range -- instead of a second, much heavier per-hour structure.
// This also fixes the old complaint that some ranges didn't render
// properly: that was two single-hour lookups that could silently miss
// or fall back to the wrong hour; summing over the whole range has no
// such failure mode.
// =====================================================================
const G='var(--good)', W_='var(--warn)', B='var(--bad)';

function computeLayerwiseAgg(fromDate, toDate, fromHour, toHour){
  const bh = DATA.major.band_hourly;
  const dates = DATA.major.lines.dl_volume_gb.dates, hours = DATA.major.lines.dl_volume_gb.hours;
  const acc = {}; const order = [];
  for(let i=0;i<bh.length;i++){
    const d = dates[i];
    if(d < fromDate || d > toDate) continue;
    const hr = hours[i] ? parseInt(hours[i].split(':')[0],10) : 0;
    if(hr < fromHour || hr > toHour) continue;
    (bh[i]||[]).forEach(b=>{
      if(!acc[b.band]){
        acc[b.band] = {band:b.band, dl_vol:0, volte:0,
          cqi_low_num:0, cqi_mid_num:0, cqi_high_num:0, cqi_den:0,
          prb_healthy:0, prb_elevated:0, prb_congested:0, prb_total:0,
          ul_dbm_sum:0, ul_dbm_n:0, mod_qpsk:0, mod_q16:0, mod_q64:0};
        order.push(b.band);
      }
      const a = acc[b.band];
      a.dl_vol += b.dl_vol||0; a.volte += b.volte||0;
      a.cqi_low_num += b.cqi_low_num||0; a.cqi_mid_num += b.cqi_mid_num||0; a.cqi_high_num += b.cqi_high_num||0; a.cqi_den += b.cssr_den||0;
      a.prb_healthy += b.prb_healthy||0; a.prb_elevated += b.prb_elevated||0; a.prb_congested += b.prb_congested||0; a.prb_total += b.n_cells||0;
      a.ul_dbm_sum += b.ul_dbm_sum||0; a.ul_dbm_n += b.ul_dbm_n||0;
      a.mod_qpsk += b.mod_qpsk||0; a.mod_q16 += b.mod_q16||0; a.mod_q64 += b.mod_q64||0;
    });
  }
  const div = (n,d)=> d ? n/d : null;
  return order.map(band=>{
    const a = acc[band];
    const modTot = a.mod_qpsk + a.mod_q16 + a.mod_q64;
    return {
      band: a.band, dl_vol: a.dl_vol, volte: a.volte,
      cqi_low: div(a.cqi_low_num,a.cqi_den), cqi_mid: div(a.cqi_mid_num,a.cqi_den), cqi_high: div(a.cqi_high_num,a.cqi_den),
      prb_healthy_pct: div(100*a.prb_healthy,a.prb_total), prb_elevated_pct: div(100*a.prb_elevated,a.prb_total), prb_congested_pct: div(100*a.prb_congested,a.prb_total),
      ul_dbm: div(a.ul_dbm_sum,a.ul_dbm_n),
      mod_qpsk_pct: modTot ? 100*a.mod_qpsk/modTot : 0, mod_q16_pct: modTot ? 100*a.mod_q16/modTot : 0, mod_q64_pct: modTot ? 100*a.mod_q64/modTot : 0,
    };
  }).sort((x,y)=>(y.dl_vol||0)-(x.dl_vol||0));
}

// One polished, glossy horizontal stacked bar per band (title column +
// track). Segments below a readability threshold drop their inline label
// (still visible as a sliver of color) so tiny slices don't get crowded
// illegible text crammed into a few pixels.
function pbarRow(label, segments){
  const segsHtml = segments.map(s=>{
    const w = Math.max(0, s.pct||0);
    const showLabel = w >= 9;
    return `<div class="pbar-seg" style="width:${w.toFixed(1)}%;background:${s.color}">${showLabel?`<span>${s.text}</span>`:''}</div>`;
  }).join('');
  return `<div class="pbar-row"><div class="pbar-lbl">${esc(label)}</div><div class="pbar-track">${segsHtml}</div></div>`;
}
function pbarGaugeRow(label, dbm){
  const pct = Math.max(0, Math.min(100, (dbm!==null&&dbm!==undefined) ? (dbm+125)/45*100 : 0));
  return `<div class="pbar-gauge-row"><div class="pbar-lbl">${esc(label)}</div>
    <div class="pbar-gauge-track"><div class="pbar-gauge-marker" style="left:${pct}%"></div></div>
    <div class="pbar-gauge-val">${fmt(dbm,1)} dBm</div></div>`;
}

function renderLayerwise(){
  const dates = DATA.layerwise.available_dates;
  const fromDateSel = document.getElementById('layerFromDate'), toDateSel = document.getElementById('layerToDate');
  fillDateSelect(fromDateSel, dates, dates[0]);
  fillDateSelect(toDateSel, dates, dates[dates.length-1]);
  const slider = buildHourSlider(document.getElementById('layerHourSlider'), 0, 23, renderLayerwiseAgg);
  fromDateSel.onchange = toDateSel.onchange = ()=>renderLayerwiseAgg(slider.lo, slider.hi);
  renderLayerwiseAgg(slider.lo, slider.hi);

  // Rejections: fixed to the most recent 4 hours, independent of the
  // From/To range above.
  const rej = DATA.layerwise.rejections_last4;
  const maxV = Math.max(...rej.map(r=>Math.max(r.rab_lic||0,r.rrc_reest_rej||0,r.erab_tnl||0)),1);
  let rh='<div class="rejwrap5">';
  rej.forEach(r=>{
    function bar(v,c){const h=100*(v||0)/maxV; return `<div class="rb"><span class="rbv">${fmt(v,0)}</span><div class="rbfill" style="height:${h}%;background:${c}"></div></div>`;}
    rh += `<div class="rejhour5"><div class="rbars">${bar(r.rab_lic,'var(--bad)')}${bar(r.rrc_reest_rej,'var(--warn)')}${bar(r.erab_tnl,'var(--purple)')}</div><div class="rhlab">${r.time}</div></div>`;
  });
  rh += '</div>';
  document.getElementById('rejHourly').innerHTML = rh;
}

function renderLayerwiseAgg(lo, hi){
  const fromDateSel = document.getElementById('layerFromDate'), toDateSel = document.getElementById('layerToDate');
  const fromDate = fromDateSel.value, toDate = toDateSel.value;
  const agg = computeLayerwiseAgg(fromDate, toDate, lo, hi);
  document.getElementById('layerRangeNote').textContent =
    `Aggregated over ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day`;

  if(!agg.length){
    ['cqiPaired','prbPaired','ulPaired','modPaired'].forEach(id=>{
      document.getElementById(id).innerHTML = '<div class="foot">no data in range</div>';
    });
    return;
  }

  document.getElementById('cqiPaired').innerHTML = agg.map(b=>pbarRow(b.band, [
    {pct:b.cqi_low, color:B, text:fmt(b.cqi_low,0)+'%'},
    {pct:b.cqi_mid, color:W_, text:fmt(b.cqi_mid,0)+'%'},
    {pct:b.cqi_high, color:G, text:fmt(b.cqi_high,0)+'%'},
  ])).join('');

  document.getElementById('prbPaired').innerHTML = agg.map(b=>pbarRow(b.band, [
    {pct:b.prb_healthy_pct, color:G, text:fmt(b.prb_healthy_pct,0)+'%'},
    {pct:b.prb_elevated_pct, color:W_, text:fmt(b.prb_elevated_pct,0)+'%'},
    {pct:b.prb_congested_pct, color:B, text:fmt(b.prb_congested_pct,0)+'%'},
  ])).join('');

  document.getElementById('modPaired').innerHTML = agg.map(b=>pbarRow(b.band, [
    {pct:b.mod_qpsk_pct, color:B, text:fmt(b.mod_qpsk_pct,0)+'%'},
    {pct:b.mod_q16_pct, color:W_, text:fmt(b.mod_q16_pct,0)+'%'},
    {pct:b.mod_q64_pct, color:G, text:fmt(b.mod_q64_pct,0)+'%'},
  ])).join('');

  document.getElementById('ulPaired').innerHTML = agg.map(b=>pbarGaugeRow(b.band, b.ul_dbm)).join('');
}

// =====================================================================
// CELL LEVEL
// =====================================================================
function renderCell(){
  document.getElementById('cellScope').textContent = 'Tables: latest hour (' + DATA.meta.latest_time.slice(0,5) + ')';
  document.getElementById('cellTrendNote').textContent = `Row-click charts: ${DATA.cell.n_hours_available_for_trend} hour(s) of history available so far — grows to 3 days as more hourly files are ingested`;

  const zc = DATA.cell.zero_traffic;
  document.getElementById('zeroCount').textContent = zc.length + ' cells';
  let zt = '<table><thead><tr><th>Cell</th><th>Site</th><th>Sector</th><th>Band</th><th>Data Vol series</th><th>VoLTE series</th><th>Zero since</th><th>Avail%</th></tr></thead><tbody>';
  zc.forEach(c=>{
    zt += `<tr onclick="showCellCharts('${esc(c.cell)}')"><td class="cid">${esc(c.cell)}</td><td>${esc(c.site)}</td><td>${c.sector}</td><td>${c.band}</td><td class="vb">${c.vol_series.join(' / ')}</td><td class="vb">${c.volte_series.join(' / ')}</td><td class="vb">${c.zero_since}</td><td>${fmt(c.avail,1)}%</td></tr>`;
  });
  zt += '</tbody></table>';
  document.getElementById('zeroTable').innerHTML = zt;

  loadDegThresholds();
  renderDegThresholdInputs();
  renderDegraded();
}

// ---- Degraded Cells with user-adjustable thresholds ----
// DATA.cell.degraded_raw holds every cell's values over the lookback
// window (rules[i] <-> vals[i]); breaches are recomputed here whenever a
// threshold box changes. A cell is listed when it breaches in EVERY hour
// of the window, same rule as before. Edited thresholds are remembered
// in this browser (localStorage) until "Defaults" is clicked.
const DEG_STORE_KEY = 'networkInsight.degThresholds';
const DEG_ROW_CAP = 300;
let _degThr = {};
let _degActiveCol = null;
function _degRaw(){ return DATA.cell.degraded_raw || {rules:[], cells:[]}; }
function loadDegThresholds(){
  _degThr = {};
  _degRaw().rules.forEach(r=>{ _degThr[r.col] = r.default; });
  try{
    const saved = JSON.parse(localStorage.getItem(DEG_STORE_KEY) || '{}');
    for(const col in saved){ if(col in _degThr && typeof saved[col]==='number' && isFinite(saved[col])) _degThr[col] = saved[col]; }
  }catch(e){ /* storage unavailable -- defaults are fine */ }
}
function saveDegThresholds(){
  try{ localStorage.setItem(DEG_STORE_KEY, JSON.stringify(_degThr)); }catch(e){}
}
function renderDegThresholdInputs(){
  document.getElementById('degThresholds').innerHTML = _degRaw().rules.map(r=>{
    const changed = _degThr[r.col] !== r.default;
    return `<label class="thr ${changed?'changed':''}" title="Default: ${r.op} ${r.default}"><span class="thr-name">${esc(r.name)} ${r.op === '<' ? '&lt;' : '&gt;'}</span><input type="number" step="any" value="${_degThr[r.col]}" data-col="${r.col}" oninput="onDegThresholdInput(this)"><span class="thr-unit">${esc(r.unit)}</span></label>`;
  }).join('');
}
const _degRerender = debounce(()=>{ saveDegThresholds(); renderDegraded(); }, 250);
function onDegThresholdInput(input){
  const v = parseFloat(input.value);
  if(!isFinite(v)) return; // mid-typing ("", "-", ".") -- wait for a number
  const col = input.dataset.col;
  _degThr[col] = v;
  const rule = _degRaw().rules.find(r=>r.col===col);
  input.closest('.thr').classList.toggle('changed', rule && v !== rule.default);
  _degRerender();
}
function resetDegThresholds(){
  try{ localStorage.removeItem(DEG_STORE_KEY); }catch(e){}
  loadDegThresholds();
  renderDegThresholdInputs();
  renderDegraded();
}
function computeDegraded(){
  const raw = _degRaw();
  return raw.rules.map((r, ri)=>{
    const t = _degThr[r.col];
    const items = [];
    raw.cells.forEach(([cell, site, band, sector, vals])=>{
      const v = vals[ri];
      if(!v.length || v.some(x=>x===null)) return;
      const breach = r.op==='<' ? v.every(x=>x<t) : v.every(x=>x>t);
      if(!breach) return;
      const latest = v[v.length-1];
      items.push({cell, site, band, sector, value: Math.round(latest*100)/100,
        trend: v.map(x=>x.toFixed(1)).join(' -> '), sev: r.op==='<' ? t-latest : latest-t});
    });
    items.sort((a,b)=>b.sev-a.sev);
    return {col:r.col, label:`${r.name} ${r.op} ${t}`, threshold:t, items};
  });
}
function renderDegraded(){
  const cats = computeDegraded();
  const firstCell = _degRaw().cells[0];
  const nHours = firstCell ? firstCell[4][0].length : 0;
  document.getElementById('degRuleNote').textContent = nHours
    ? `A cell is listed when it breaches the threshold in every one of the last ${nHours} hour(s). Edit a box to re-check instantly.`
    : 'Not enough hourly data yet.';
  document.getElementById('degCount').textContent = cats.reduce((a,c)=>a+c.items.length,0) + ' breaches';
  if(!cats.some(c=>c.col===_degActiveCol)) _degActiveCol = cats.length ? cats[0].col : null;
  document.getElementById('degChips').innerHTML = cats.map(c=>
    `<div class="chip ${c.col===_degActiveCol?'active':''}" data-col="${c.col}" onclick="selectDegCat(this)">${esc(c.label)}<span class="n">${c.items.length}</span></div>`).join('');
  const cat = cats.find(c=>c.col===_degActiveCol);
  if(!cat){ document.getElementById('degTable').innerHTML = ''; return; }
  const shown = cat.items.slice(0, DEG_ROW_CAP);
  let t = `<table><thead><tr><th>Cell</th><th>Site</th><th>Sector</th><th>Band</th><th>Value</th><th>Threshold</th><th>Trend (last ${nHours}h)</th></tr></thead><tbody>`;
  shown.forEach(c=>{
    t += `<tr onclick="showCellCharts('${esc(c.cell)}')"><td class="cid">${esc(c.cell)}</td><td>${esc(c.site)}</td><td>${c.sector}</td><td>${c.band}</td><td class="vb">${c.value}</td><td>${cat.threshold}</td><td>${c.trend}</td></tr>`;
  });
  if(!shown.length) t += `<tr><td colspan="7" class="foot" style="text-align:center;cursor:default">No cells breach ${esc(cat.label)}</td></tr>`;
  t += `</tbody></table>`;
  document.getElementById('degTable').innerHTML = t;
  if(cat.items.length > shown.length)
    document.getElementById('degTable').insertAdjacentHTML('beforeend', `<div class="foot">Showing worst ${shown.length} of ${cat.items.length} &mdash; tighten the threshold to narrow the list.</div>`);
}
function selectDegCat(chipEl){
  _degActiveCol = chipEl.dataset.col;
  renderDegraded();
}
function lineChartReal(title, cellId, unit, color, dates, hours, vals){
  const W=380,H=200,pl=44,pr=14,pt=30,pb=54;
  const present = vals.filter(v=>v!==null&&v!==undefined);
  if(present.length===0) return `<div class="card"><div style="font-weight:650;font-size:13px">${title}</div><div class="foot">no data</div></div>`;
  let maxv=Math.max(...present), minv=Math.min(...present);
  const rng=(maxv-minv)||Math.abs(maxv)*0.1||1;
  const n=vals.length;
  const px=i=>pl+(W-pl-pr)*i/Math.max(n-1,1);
  const py=v=>pt+(H-pt-pb)*(1-(v-minv)/rng);
  let grid='';
  for(let k=0;k<=3;k++){const gy=pt+(H-pt-pb)*k/3; const gv=maxv-(rng*k/3);
    grid+=`<line x1="${pl}" y1="${gy}" x2="${W-pr}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="0.5"/><text x="${pl-6}" y="${gy+3}" fill="var(--chart-ink)" font-size="9" font-weight="700" text-anchor="end" font-family="monospace">${gv.toFixed(1)}</text>`;}
  const axis = dayHourAxis(dates, hours, n, px, {
    ticksY: H-pb+13, ruleY: H-pb+19, dateY: H-pb+32, dividerTop: pt, dividerBottom: H-pb,
    tickSize: 7.5, dateSize: 8, tickColor: 'var(--chart-ink)', dateColor: 'var(--chart-ink2)', ruleColor: 'var(--chart-grid)',
  });
  const pts = vals.map((v,i)=> v===null?null:[px(i),py(v)]).filter(p=>p!==null);
  const poly = pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const dots = pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.6" fill="${color}"/>`).join('');
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px"><span style="font-weight:650;font-size:13px">${title}</span><span style="font-family:var(--mono);font-size:9px;color:var(--accent)">${esc(cellId)}</span></div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--faint);margin-bottom:4px">Y: ${unit}  &middot;  X: hour</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${grid}${axis.dividers}<polyline fill="none" stroke="${color}" stroke-width="1.6" points="${poly}"/>${dots}${axis.labels}</svg></div>`;
}
function showCellCharts(cellName){
  const series = DATA.cell.series[cellName];
  if(series){ drawCellCharts(cellName, series); return; }
  // Not pre-bundled (flagged only under an adjusted threshold) -- fetch it.
  document.getElementById('cellCharts').style.display='block';
  document.getElementById('cellChartsH').textContent = cellName + ' — loading…';
  document.getElementById('cellLineCharts').innerHTML = '';
  fetch('/api/cell_series?cell=' + encodeURIComponent(cellName))
    .then(r=>r.ok ? r.json() : Promise.reject(new Error('HTTP '+r.status)))
    .then(rows=>{ DATA.cell.series[cellName] = rows; drawCellCharts(cellName, rows); })
    .catch(()=>{ document.getElementById('cellChartsH').textContent = cellName + ' — charts need the server (uv run src/server.py)'; });
}
function drawCellCharts(cellName, series){
  const dates = series.map(r=>r.date);
  const hours = series.map(r=>r.time);
  document.getElementById('cellCharts').style.display='block';
  document.getElementById('cellChartsH').textContent = cellName + ' \u2014 Hourly KPI Trends';
  const C = document.getElementById('cellLineCharts');
  C.innerHTML =
    zLineChartReal('Data Volume', cellName, 'GB', '#3b82f6', dates, hours, series.map(r=>r.dl_volume_gb)) +
    zLineChartReal('PRB Utilization', cellName, '%', '#f59e0b', dates, hours, series.map(r=>r.dl_prb_util)) +
    zLineChartReal('Service Drop Rate', cellName, '%', '#ef4444', dates, hours, series.map(r=>r.service_drop_rate)) +
    zLineChartReal('CSSR', cellName, '%', '#10b981', dates, hours, series.map(r=>r.call_setup_sr)) +
    zLineChartReal('DL User Throughput', cellName, 'Mbps', '#a855f7', dates, hours, series.map(r=>r.dl_user_thrp_mbps));
  document.getElementById('cellCharts').scrollIntoView({behavior:'smooth', block:'center'});
}

// =====================================================================
// TRAFFIC BALANCING -- From-date/To-date + hour-of-day range, same
// control pattern as every other tab. (site,sector,band) granularity
// across 900+ sites and every hour doesn't scale to baking into the
// static bundle, so this is fetched live from /api/traffic_balance (like
// Site KPIs) and re-averaged over dl_prb_util for whatever range is
// selected, instead of showing one fixed latest-hour snapshot.
// =====================================================================
function debounce(fn, ms){
  let t;
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}
const BALANCE_BANDS = ['L2600','L1800','L2100','L900','L850'];
let _balanceSelectedRow = null;
function renderBalanceTable(rows){
  let t = '<table class="matrix"><thead><tr><th>Site</th><th>Sector</th>' + BALANCE_BANDS.map(b=>`<th>${b}</th>`).join('') + '<th>Description</th></tr></thead><tbody>';
  rows.forEach((r,i)=>{
    let cells = BALANCE_BANDS.map(b=>{
      const v = r.bands[b];
      if(v===undefined) return '<td class="pc" style="color:var(--faint)">&mdash;</td>';
      const cls = v>85?'vb':v>=70?'vw':'vg';
      return `<td class="pc ${cls}">${v.toFixed(0)}</td>`;
    }).join('');
    t += `<tr class="clickable-row" data-row-i="${i}" onclick="loadSectorDrilldown('${escAttr(r.site)}','${escAttr(r.sector)}',this)" title="Click for 3-day hourly trend on this sector"><td class="site">${esc(r.site)}</td><td class="sec">${r.sector}</td>${cells}<td style="white-space:normal;font-family:var(--sans);color:var(--warn)">${r.hot} hot (${r.hot_prb}%) &middot; room on ${r.target} (${r.target_prb}%) &rarr; steer ${r.hot}&rarr;${r.target}</td></tr>`;
  });
  t += '</tbody></table>';
  document.getElementById('balanceTable').innerHTML = t;
  // a fresh table means any previously-open drill-down no longer matches a
  // visible row -- close it rather than leave a stale/orphaned chart set
  document.getElementById('sectorDrill').classList.add('hidden');
  _balanceSelectedRow = null;
}

function loadSectorDrilldown(site, sector, trEl){
  const host = document.getElementById('sectorDrill');
  const head = document.getElementById('sectorDrillH');
  const body = document.getElementById('sectorDrillCharts');
  if(_balanceSelectedRow) _balanceSelectedRow.classList.remove('sel-row');
  if(trEl){ trEl.classList.add('sel-row'); _balanceSelectedRow = trEl; }
  host.classList.remove('hidden');
  head.textContent = `${site} — Sector ${sector} — last 3 days, hourly, one line per cell`;
  body.innerHTML = '<div class="foot">Loading…</div>';
  host.scrollIntoView({behavior:'smooth', block:'nearest'});
  const qs = new URLSearchParams({site, sector});
  fetch('/api/sector_kpis?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(!data.dates || !data.dates.length){
        body.innerHTML = '<div class="foot">No cell-level data for this sector.</div>';
        return;
      }
      buildSiteCharts(data, 'sectorDrillCharts');
    })
    .catch(err=>{
      body.innerHTML = `<div class="foot">Failed to load: ${err.message} — requires the server (uv run src/server.py).</div>`;
    });
}
function loadTrafficBalance(lo, hi){
  const fromDate = document.getElementById('balanceFromDate').value;
  const toDate = document.getElementById('balanceToDate').value;
  const status = document.getElementById('balanceStatus');
  status.textContent = `Loading ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day…`;
  const qs = new URLSearchParams({from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/traffic_balance?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      status.textContent = `Averaged over ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day — ${data.rows.length} site/sector(s) with actionable imbalance.`;
      renderBalanceTable(data.rows);
    })
    .catch(err=>{
      status.textContent = 'Failed to load: ' + err.message + ' — requires the server (uv run src/server.py).';
      document.getElementById('balanceTable').innerHTML = '';
    });
}
function renderBalance(){
  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromDateSel = document.getElementById('balanceFromDate'), toDateSel = document.getElementById('balanceToDate');
  fillDateSelect(fromDateSel, dates, dates[0]);
  fillDateSelect(toDateSel, dates, dates[dates.length-1]);
  const debouncedLoad = debounce(loadTrafficBalance, 350);
  const slider = buildHourSlider(document.getElementById('balanceHourSlider'), 0, 23, debouncedLoad);
  fromDateSel.onchange = toDateSel.onchange = ()=>loadTrafficBalance(slider.lo, slider.hi);
  loadTrafficBalance(slider.lo, slider.hi);
}

// =====================================================================
// TRAFFIC DIP SUMMARY
// =====================================================================
function dipTable(rows, unit){
  let t = `<table><thead><tr><th>#</th><th>Cell</th><th>Now</th><th>Base</th><th>&Delta; ${unit}</th><th>Contrib%</th><th>Avail OK?</th><th>TNL OK?</th><th>Interf OK?</th></tr></thead><tbody>`;
  rows.forEach((r,i)=>{
    t += `<tr><td>${i+1}</td><td class="cid">${esc(r.cell)}</td><td>${r.now}</td><td>${r.base}</td><td class="vb">${r.delta}</td><td>${r.contrib_pct}%</td>
      <td class="${r.avail_ok?'vg':'vb'}">${r.avail_ok?'yes':'NO ('+fmt(r.avail_now,0)+'%)'}</td>
      <td class="${r.tnl_ok?'vg':'vb'}">${r.tnl_ok?'yes':'NO ('+fmt(r.tnl_now,0)+')'}</td>
      <td class="${r.interf_ok?'vg':'vb'}">${r.interf_ok?'yes':'NO ('+fmt(r.interf_now,0)+')'}</td></tr>`;
  });
  t += '</tbody></table>';
  return t;
}
function renderDip(){
  document.getElementById('dipScope').textContent = `Post (${DATA.dip.post_time.slice(0,5)}) vs Pre (${DATA.dip.pre_time.slice(0,5)})`;
  document.getElementById('dipCards').innerHTML = `
    <div class="card"><div class="k-lbl">Data Vol dip</div><div class="k-val" style="color:var(--bad)">${DATA.dip.data_volume_total_dip} GB</div><div class="k-sub">total across contributing cells</div></div>
    <div class="card"><div class="k-lbl">Cells contributing</div><div class="k-val">${DATA.dip.data_volume.length}</div></div>
    <div class="card"><div class="k-lbl">VoLTE dip</div><div class="k-val" style="color:var(--warn)">${DATA.dip.volte_total_dip} Erl</div><div class="k-sub">total across contributing cells</div></div>
    <div class="card"><div class="k-lbl">Cells contributing</div><div class="k-val">${DATA.dip.volte.length}</div></div>`;
  document.getElementById('dipVolTable').innerHTML = dipTable(DATA.dip.data_volume, 'GB');
  document.getElementById('dipVolteTable').innerHTML = dipTable(DATA.dip.volte, 'Erl');
  document.getElementById('dipMapPlaceholder').innerHTML = `<div class="placeholder"><div class="big">&#128506;</div><div style="font-weight:650;color:var(--ink)">Map needs cell geometry</div><div>Once lat/long is uploaded, dip-contributing cells render here sized by contribution.</div></div>`;
}

// =====================================================================
// L2600
// =====================================================================
// Per-hour PRB-utilization distribution across L2600 cells -- 3 fixed
// buckets (<=50% green / 50-75% yellow / >75% red), one bucket-count label
// per segment, reusing the same rounded-top gradient-stack visual style as
// the Major KPIs band-utilization chart. L2600 is TDD -- DL and UL share
// the same carrier via time-slots, so every hour gets TWO grouped bars
// (DL, UL), same bucket colors, with UL segments carrying a diagonal
// hatch overlay so direction reads independent of hue (colorblind-safe)
// without doubling the legend's color vocabulary.
const L2600_BUCKET_COLORS = {le50:'#10b981', '50_75':'#f59e0b', gt75:'#ef4444'};
const L2600_BUCKET_LABELS = {le50:'&lt;50%', '50_75':'50-75%', gt75:'&gt;75%'};
const L2600_BUCKET_ORDER = ['le50','50_75','gt75'];

function l2600DualBarChart(points, size){
  // Rendered at width:100% of a full-width card with only 7 points --
  // keep the viewBox short so it reads as a compact strip, not a tall
  // block dominating the tab. size:'large' is the enlarge pop-up: a
  // narrower, taller viewBox, so the same labels render ~1.7x bigger.
  const large = size === 'large';
  const W = large ? 680 : 880, H = large ? 320 : 215, pl=52, pr=14, pt=26, pb=56;
  const MIN_SEG_H = 10;
  const n = Math.max(points.length, 1);
  const maxTotal = Math.max(...points.map(p=>Math.max(p.dl.total||0, p.ul.total||0)), 1) * 1.2;
  const plotW = W-pl-pr, plotH = H-pt-pb;
  const groupW = plotW/n;
  const barW = Math.min(30, groupW*0.24);
  const barGap = Math.max(4, barW*0.22);

  let grid='';
  for(let k=0;k<=4;k++){
    const gy = pt + plotH*k/4;
    const gv = maxTotal*(1-k/4);
    grid += `<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${W-pr}" y2="${gy.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="0.7"/><text x="${pl-8}" y="${(gy+3.5).toFixed(1)}" fill="var(--chart-ink)" font-size="8.5" font-weight="700" text-anchor="end" font-family="monospace">${gv.toFixed(0)}</text>`;
  }

  function drawOneBar(x, dirData, isUL){
    const present = L2600_BUCKET_ORDER.filter(k=>(dirData[k]||0)>0);
    const segs = present.map(k=>({k, val: dirData[k]||0, segH: Math.max(plotH*((dirData[k]||0)/maxTotal), MIN_SEG_H)}));
    let yCursor = H-pb, svg='';
    segs.forEach((s,bi)=>{
      const y = yCursor - s.segH;
      const gid = 'l26g'+(_gid++);
      const path = roundedTopRectPath(x,y,barW,s.segH,bi===segs.length-1?5:0);
      svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${L2600_BUCKET_COLORS[s.k]}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${L2600_BUCKET_COLORS[s.k]}" stop-opacity="0.72"/></linearGradient></defs>`;
      svg += `<path d="${path}" fill="url(#${gid})"/>`;
      if(isUL) svg += `<path d="${path}" fill="url(#ulHatch)"/>`;
      const fs = s.segH>=16 ? 8.5 : 7;
      svg += `<text x="${(x+barW/2).toFixed(1)}" y="${(y+s.segH/2+fs*0.35).toFixed(1)}" fill="#fff" stroke="#000" stroke-width="1.8" stroke-opacity="0.55" paint-order="stroke" font-size="${fs}" font-weight="800" text-anchor="middle" font-family="monospace">${s.val}</text>`;
      yCursor = y;
    });
    return {svg, top: yCursor};
  }

  let prevDate = null, bars='';
  const legendTotals = {dl:{le50:0,'50_75':0,gt75:0}, ul:{le50:0,'50_75':0,gt75:0}};
  points.forEach((p,i)=>{
    const groupX = pl + i*groupW + groupW/2;
    const dlX = groupX - barGap/2 - barW;
    const ulX = groupX + barGap/2;
    L2600_BUCKET_ORDER.forEach(k=>{ legendTotals.dl[k]+=p.dl[k]||0; legendTotals.ul[k]+=p.ul[k]||0; });
    const dlBar = drawOneBar(dlX, p.dl, false);
    const ulBar = drawOneBar(ulX, p.ul, true);
    bars += dlBar.svg + ulBar.svg;
    const topY = Math.min(dlBar.top, ulBar.top);
    // Shared total pill above the pair -- DL/UL cell counts are normally
    // identical (same L2600 cell set reports both), so one callout avoids
    // showing the same number twice.
    const totalTxt = String(p.dl.total||0);
    const totalW = Math.max(22, totalTxt.length*7+10);
    bars += `<rect x="${(groupX-totalW/2).toFixed(1)}" y="${(topY-18).toFixed(1)}" width="${totalW}" height="13" rx="6.5" fill="var(--panel2)" stroke="var(--accent)" stroke-width="1"/>`;
    bars += `<text x="${groupX.toFixed(1)}" y="${(topY-9).toFixed(1)}" fill="var(--accent)" font-size="8.5" font-weight="800" text-anchor="middle" font-family="monospace">${totalTxt}</text>`;
    bars += `<text x="${(dlX+barW/2).toFixed(1)}" y="${H-pb+11}" fill="var(--dim)" font-size="7" text-anchor="middle" font-family="monospace" font-weight="700">DL</text>`;
    bars += `<text x="${(ulX+barW/2).toFixed(1)}" y="${H-pb+11}" fill="var(--dim)" font-size="7" text-anchor="middle" font-family="monospace" font-weight="700">UL</text>`;
    const dateChanged = p.date !== prevDate;
    prevDate = p.date;
    bars += `<text x="${groupX.toFixed(1)}" y="${H-pb+24}" fill="var(--chart-ink2)" font-size="8.5" font-weight="700" text-anchor="middle" font-family="monospace">${fmtHourAMPM(p.time)}</text>`;
    if(dateChanged){
      bars += `<text x="${groupX.toFixed(1)}" y="${H-pb+37}" fill="var(--chart-ink2)" font-size="7.5" font-weight="700" text-anchor="middle" font-family="monospace">${fmtDateDMY(p.date)}</text>`;
    }
  });

  const grandDl = Object.values(legendTotals.dl).reduce((a,b)=>a+b,0) || 1;
  const grandUl = Object.values(legendTotals.ul).reduce((a,b)=>a+b,0) || 1;
  const bucketLegend = L2600_BUCKET_ORDER.map(k=>{
    const pctDl = 100*legendTotals.dl[k]/grandDl, pctUl = 100*legendTotals.ul[k]/grandUl;
    return `<div class="bl-chip"><span class="dot" style="background:${L2600_BUCKET_COLORS[k]}"></span><span class="bl-name">${L2600_BUCKET_LABELS[k]}</span><span class="bl-pct dual" style="color:${L2600_BUCKET_COLORS[k]}">DL ${pctDl.toFixed(0)}% &middot; UL ${pctUl.toFixed(0)}%</span></div>`;
  }).join('');
  const dirLegend = `<div class="bl-chip" style="flex:0 0 auto;min-width:auto"><span class="dirswatch"></span><span class="bl-name">DL &mdash; solid</span></div>
    <div class="bl-chip" style="flex:0 0 auto;min-width:auto"><span class="dirswatch dirhatch"></span><span class="bl-name">UL &mdash; hatched</span></div>`;

  return `<div class="bigchart-card enl-card" style="max-width:100%" data-enl-title="L2600 PRB Utilization &mdash; Last 7 Hours, DL vs UL" data-enl-render="l2600Hourly">
    <div class="bigchart-head"><span class="bigchart-title">L2600 PRB Utilization by Range &mdash; DL vs UL</span><span class="bigchart-unit">cell count</span>${large ? '' : enlargeBtn()}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
      <defs><pattern id="ulHatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="#0e1117" stroke-width="2" stroke-opacity="0.4"/></pattern></defs>
      ${grid}${bars}
    </svg>
    <div class="bl-legend">${bucketLegend}${dirLegend}</div>
  </div>`;
}

function renderL2600HourlyBands(){
  const points = DATA.l2600.hourly_bands || [];
  const scope = document.getElementById('l2600HourlyScope');
  const container = document.getElementById('l2600HourlyBands');
  if(!points.length){ scope.textContent = 'No data'; container.innerHTML = ''; return; }
  scope.textContent = `${fmtDateDMY(points[0].date)} ${fmtHourAMPM(points[0].time)} → ${fmtDateDMY(points[points.length-1].date)} ${fmtHourAMPM(points[points.length-1].time)}`;
  container.innerHTML = l2600DualBarChart(points);
}

function renderL2600(){
  const cells = DATA.l2600.cells;
  const r = DATA.l2600.ranges; // {dl:{le50,50_75,gt75}, ul:{...}}
  const total = cells.length || 1;
  const avgDl = cells.reduce((a,c)=>a+(c.dl_prb_util||0),0)/total;
  const avgUl = cells.reduce((a,c)=>a+(c.ul_prb_util||0),0)/total;
  const hotSectors = DATA.l2600.hot_sectors || [];
  document.getElementById('l2600Cards').innerHTML = `
    <div class="card"><div class="k-lbl">L2600 cells on air</div><div class="k-val">${cells.length}</div><div class="k-sub" style="color:var(--faint)">of ${DATA.meta.n_cells} total cells</div></div>
    <div class="card"><div class="k-lbl">Avg L2600 DL PRB</div><div class="k-val" style="color:var(--warn)">${fmt(avgDl,0)}%</div></div>
    <div class="card"><div class="k-lbl">Avg L2600 UL PRB</div><div class="k-val" style="color:var(--warn)">${fmt(avgUl,0)}%</div></div>
    <div class="card"><div class="k-lbl">DL &gt;75% PRB</div><div class="k-val" style="color:var(--bad)">${r.dl.gt75}</div></div>
    <div class="card"><div class="k-lbl">UL &gt;75% PRB</div><div class="k-val" style="color:var(--bad)">${r.ul.gt75}</div></div>
    <div class="card"><div class="k-lbl">Hot sectors (DL or UL)</div><div class="k-val" style="color:var(--bad)">${hotSectors.length}</div></div>`;
  const pct = cells.length ? (100*cells.length/DATA.meta.n_cells).toFixed(2) : 0;
  document.getElementById('l2600Insight').innerHTML = `<div class="insight bad"><span class="lead">Finding</span>Only <b>${cells.length} L2600 cells</b> exist across the whole ${DATA.meta.n_cells}-cell network (${pct}%) &mdash; L2600 is effectively undeployed here, not just under-utilized. The capacity headroom this band could offer is not available at all in most of the network. This is a deployment/expansion finding, not a load-balancing one.</div>`;
  renderL2600HourlyBands();
  renderL2600OvershootTab();
  renderL2600HotSectorsTab();
}

// L2600 Hot Sectors table -- own Filters (From/To date + hour-of-day
// range, live-fetched like Traffic Balancing) plus a client-side search
// box filtering the already-fetched rows by site name, per direct
// customer request ("customer needs to scroll through to find the site").
let _l2600HotSlider = null;
let _l2600HotRows = [];
function renderL2600HotTable(){
  const q = (document.getElementById('l2600HotSearch').value || '').trim().toLowerCase();
  const rows = q ? _l2600HotRows.filter(s=>(s.site_id||'').toLowerCase().includes(q)) : _l2600HotRows;
  let t = '<table><thead><tr><th>Site</th><th>Sector</th><th>DL PRB%</th><th>UL PRB%</th><th>DL Thrp (Mbps)</th><th>UL Thrp (Mbps)</th></tr></thead><tbody>';
  if(rows.length){
    rows.forEach(s=>{
      t += `<tr class="clickable-row" onclick="loadL2600SectorDrilldown('${escAttr(s.site_id)}','${escAttr(s.sector)}',this)" title="Click for this sector's hourly trend across all carriers">
        <td>${esc(s.site_id)}</td><td class="sec">${s.sector}</td>
        <td class="pc ${s.dl_prb>75?'vb':'vg'}">${fmt(s.dl_prb,0)}%</td>
        <td class="pc ${s.ul_prb>75?'vb':'vg'}">${fmt(s.ul_prb,0)}%</td>
        <td>${fmt(s.dl_thrp,1)}</td><td>${fmt(s.ul_thrp,1)}</td></tr>`;
    });
  } else if(_l2600HotRows.length){
    t += '<tr><td colspan="6" style="text-align:center;color:var(--faint)">No site matches &ldquo;'+esc(q)+'&rdquo;.</td></tr>';
  } else {
    t += '<tr><td colspan="6" style="text-align:center;color:var(--faint)">No L2600 sectors above 75% PRB utilization (DL or UL) in this range.</td></tr>';
  }
  t += '</tbody></table>';
  document.getElementById('l2600Table').innerHTML = t;
  // a fresh table means any previously-open drill-down no longer matches a
  // visible row
  document.getElementById('l2600SectorDrill').classList.add('hidden');
  _l2600SelectedRow = null;
}
function loadL2600HotSectors(lo, hi){
  const fromDate = document.getElementById('l2600HotFromDate').value;
  const toDate = document.getElementById('l2600HotToDate').value;
  const status = document.getElementById('l2600HotStatus');
  const scope = document.getElementById('l2600HotScope');
  status.textContent = `Loading ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day…`;
  const qs = new URLSearchParams({from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/l2600_hot_sectors?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      _l2600HotRows = data.rows || [];
      const rangeTxt = `Averaged over ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day — ${_l2600HotRows.length} site/sector(s).`;
      status.textContent = rangeTxt;
      scope.textContent = rangeTxt;
      renderL2600HotTable();
    })
    .catch(err=>{
      status.textContent = 'Failed to load: ' + err.message + ' — requires the server (uv run src/server.py).';
      _l2600HotRows = [];
      document.getElementById('l2600Table').innerHTML = '';
    });
}
function renderL2600HotSectorsTab(){
  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromSel = document.getElementById('l2600HotFromDate'), toSel = document.getElementById('l2600HotToDate');
  fillDateSelect(fromSel, dates, dates[0]);
  fillDateSelect(toSel, dates, dates[dates.length-1]);
  const debouncedLoad = debounce(loadL2600HotSectors, 350);
  _l2600HotSlider = buildHourSlider(document.getElementById('l2600HotHourSlider'), 0, 23, debouncedLoad);
  fromSel.onchange = toSel.onchange = ()=>loadL2600HotSectors(_l2600HotSlider.lo, _l2600HotSlider.hi);
  document.getElementById('l2600HotSearch').oninput = ()=>renderL2600HotTable();
  loadL2600HotSectors(_l2600HotSlider.lo, _l2600HotSlider.hi);
}

let _l2600SelectedRow = null;
function loadL2600SectorDrilldown(site, sector, trEl){
  const host = document.getElementById('l2600SectorDrill');
  const head = document.getElementById('l2600SectorDrillH');
  const body = document.getElementById('l2600SectorDrillCharts');
  if(_l2600SelectedRow) _l2600SelectedRow.classList.remove('sel-row');
  if(trEl){ trEl.classList.add('sel-row'); _l2600SelectedRow = trEl; }
  host.classList.remove('hidden');
  head.textContent = `${site} — Sector ${sector} — all carriers, last 3 days hourly`;
  body.innerHTML = '<div class="foot">Loading…</div>';
  host.scrollIntoView({behavior:'smooth', block:'nearest'});
  // Every carrier/band sharing this sector, not just L2600 -- so
  // management can see how the other bands are behaving alongside the
  // L2600 congestion that put this sector in the table in the first place.
  const qs = new URLSearchParams({site, sector});
  fetch('/api/sector_kpis?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(!data.dates || !data.dates.length){
        body.innerHTML = '<div class="foot">No cell-level data for this sector.</div>';
        return;
      }
      buildSiteCharts(data, 'l2600SectorDrillCharts');
    })
    .catch(err=>{
      body.innerHTML = `<div class="foot">Failed to load: ${err.message} — requires the server (uv run src/server.py).</div>`;
    });
  loadL2600SectorTa(site, sector);
}

// TA Distribution Analysis for the ONE sector currently drilled into --
// ONE combined chart, one ROW per carrier actually present in that sector
// (TA/distance is a raw per-cell counter, not L2600-specific, so every
// band the line-chart drill-down above shows gets its own row here too).
// Reuses pbarRow() -- the same "band label + percentage-labeled stacked
// bar" component LayerWise already uses for its PRB/CQI/modulation rows
// -- instead of one separate card per band, so all carriers read as a
// single glanceable chart with the band as its y-axis. Uses the SAME
// date/hour range currently selected in the Hot Sectors table's own
// Filters, not a fixed window.
function loadL2600SectorTa(site, sector){
  const container = document.getElementById('l2600SectorDrillTa');
  container.innerHTML = '<div class="foot">Loading…</div>';
  const fromDate = document.getElementById('l2600HotFromDate').value;
  const toDate = document.getElementById('l2600HotToDate').value;
  const lo = _l2600HotSlider ? _l2600HotSlider.lo : 0, hi = _l2600HotSlider ? _l2600HotSlider.hi : 23;
  const qs = new URLSearchParams({site, sector, from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/ta_by_sector?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      const bands = (data.rows || [])
        .map(row=>({ band: row.band, t: [0,1,2,3,4,5,6,7,8,9,10,11].map(i=>row['ta_idx'+i]||0) }))
        .filter(b=>b.band && b.t.some(v=>v>0))
        .sort((a,b)=>BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band));
      if(!bands.length){
        container.innerHTML = '<div class="foot">No TA (distance) samples for this sector in range.</div>';
        return;
      }
      const rangeTxt = `Sector ${esc(sector)}, ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day`;
      const legend = OVERSHOOT_RANGES.map(r=>`<div class="bl-chip" style="flex:0 0 auto;min-width:auto"><span class="dot" style="background:${r.color}"></span><span class="bl-name">${r.label}</span></div>`).join('');
      const rows = bands.map(b=>{
        const counts = overshootBuckets(b.t);
        const total = counts.reduce((a,c)=>a+c,0) || 1;
        const segs = OVERSHOOT_RANGES.map((r,i)=>({pct: 100*counts[i]/total, color: r.color, text: fmt(100*counts[i]/total,1)+'%'}));
        return pbarRow(abbrBand(b.band), segs);
      }).join('');
      container.innerHTML = `<div class="sec-sub" style="margin-bottom:10px">${esc(rangeTxt)}</div>
        <div class="bigchart-card" style="max-width:100%">
          <div class="mc-site" title="${escAttr(site)}">${esc(site)}</div>
          <div class="bigchart-head"><span class="bigchart-title">TA Distribution Analysis</span><span class="bigchart-unit">% of TA samples</span></div>
          <div class="bl-legend" style="margin-bottom:14px">${legend}</div>
          <div>${rows}</div>
        </div>`;
    })
    .catch(err=>{
      container.innerHTML = `<div class="foot">Failed to load TA distribution: ${err.message}</div>`;
    });
}

// ---------------------------------------------------------------------
// L2600 Overshoot Analysis -- horizontal 100%-stacked distance bar.
// Distance comes from the vendor's own L.RA.TA.UE.Index0-11 counter
// description (Timing-Advance-derived UE distance from site), NOT an
// assumption -- per-index boundaries in meters:
//   idx0 0-156   idx1 156-234   idx2 234-546   idx3 546-1014
//   idx4 1014-1950  idx5 1950-3510  idx6 3510-6630  idx7 6630-14430
//   idx8 14430-30030  idx9 30030-53430  idx10 53430-76830  idx11 >76830
// The 4 UI ranges (0-700 / 700-1500 / 1500-2000 / >2000m) don't land on
// these bucket edges: idx0-2 fall fully under 700m and idx6-11 fall fully
// over 2000m, but idx3, idx4 and idx5 each straddle exactly one boundary.
// Each straddling bucket is split proportionally by the width of its
// overlap on each side of the boundary -- the standard way to re-bucket
// grouped/binned counter data, assuming samples are spread evenly within
// a bucket (there is no finer-grained sample data to do better than this).
// =====================================================================
const OVERSHOOT_RANGES = [
  {label:'0 &ndash; 0.7 km', color:'#10b981'},
  {label:'0.7 &ndash; 1.5 km', color:'#f59e0b'},
  {label:'1.5 &ndash; 2.0 km', color:'#f472b6'},
  {label:'&gt; 2.0 km', color:'#ef4444'},
];
const F_IDX3_R1 = (700-546)/(1014-546);     // idx3 [546,1014)m -> share landing in R1 (<700m)
const F_IDX4_R2 = (1500-1014)/(1950-1014);  // idx4 [1014,1950)m -> share landing in R2 (700-1500m)
const F_IDX5_R3 = (2000-1950)/(3510-1950);  // idx5 [1950,3510)m -> share landing in R3 (1500-2000m)

function overshootBuckets(t){ // t = [c0..c11] raw ta_idx0..11 sums
  const r1 = t[0]+t[1]+t[2] + t[3]*F_IDX3_R1;
  const r2 = t[3]*(1-F_IDX3_R1) + t[4]*F_IDX4_R2;
  const r3 = t[4]*(1-F_IDX4_R2) + t[5]*F_IDX5_R3;
  const r4 = t[5]*(1-F_IDX5_R3) + t[6]+t[7]+t[8]+t[9]+t[10]+t[11];
  return [r1,r2,r3,r4];
}

function overshootBarChart(counts, title, badge){
  const total = counts.reduce((a,b)=>a+b,0) || 1;
  const raw = counts.map(c=>100*c/total);
  // Every non-zero range gets at least this much width so its % label
  // always fits and is always visible, taking the difference
  // proportionally from the others (same visibility-over-strict-accuracy
  // tradeoff already used for the vertical stacked-bar charts elsewhere).
  const MIN_PCT = 5;
  let widths = raw.map(p=>p>0 ? Math.max(p, MIN_PCT) : 0);
  const wsum = widths.reduce((a,b)=>a+b,0) || 1;
  widths = widths.map(w=>100*w/wsum);

  const segs = OVERSHOOT_RANGES.map((r,i)=>{
    if(widths[i]<=0) return '';
    const fs = widths[i] >= 9 ? 15 : 11.5;
    return `<div class="ov-seg" style="width:${widths[i].toFixed(2)}%;background:linear-gradient(180deg, ${r.color}, ${r.color}cc)" title="${r.label.replace(/&ndash;/g,'-').replace(/&gt;/g,'>')}: ${raw[i].toFixed(1)}%">
      <span style="font-size:${fs}px">${raw[i].toFixed(1)}%</span>
    </div>`;
  }).join('');

  const legend = OVERSHOOT_RANGES.map((r,i)=>
    `<div class="bl-chip"><span class="dot" style="background:${r.color}"></span><span class="bl-name">${r.label}</span><span class="bl-pct" style="color:${r.color}">${raw[i].toFixed(1)}%</span></div>`
  ).join('');

  const badgeHtml = badge ? `<div class="mc-site" style="background:linear-gradient(135deg,${badge.color}48,${badge.color}18);border-color:${badge.color}88;color:#fff">${esc(badge.text)}</div>` : '';
  return `<div class="bigchart-card" style="max-width:100%">
    ${badgeHtml}
    <div class="bigchart-head"><span class="bigchart-title">${esc(title || 'UE Distance Distribution')}</span><span class="bigchart-unit">% of TA samples</span></div>
    <div class="ov-bar">${segs}</div>
    <div class="bl-legend">${legend}</div>
  </div>`;
}

let _l2600OvSlider = null;
function renderL2600Overshoot(lo, hi){
  const rows = DATA.l2600.ta_hourly || [];
  const scope = document.getElementById('l2600OvershootScope');
  const container = document.getElementById('l2600OvershootChart');
  const fromDate = document.getElementById('l2600OvFromDate').value;
  const toDate = document.getElementById('l2600OvToDate').value;
  if(!rows.length){ scope.textContent = 'No data'; container.innerHTML = ''; return; }
  const filtered = filterByDateAndHourOfDay(
    rows.map(r=>r.date), rows.map(r=>r.time), rows, fromDate, toDate, lo, hi
  );
  if(!filtered.values.length){ scope.textContent = 'No data in range'; container.innerHTML = ''; return; }
  const sums = new Array(12).fill(0);
  filtered.values.forEach(r=>{ for(let i=0;i<12;i++) sums[i] += r['ta_idx'+i] || 0; });
  const counts = overshootBuckets(sums);
  scope.textContent = `${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day`;
  container.innerHTML = overshootBarChart(counts, 'UE Distance Distribution — L2600');
}

function renderL2600OvershootTab(){
  const rows = DATA.l2600.ta_hourly || [];
  const dates = uniqueDates(rows.map(r=>r.date));
  const fromSel = document.getElementById('l2600OvFromDate'), toSel = document.getElementById('l2600OvToDate');
  fillDateSelect(fromSel, dates, dates[0]);
  fillDateSelect(toSel, dates, dates[dates.length-1]);
  const debouncedLoad = debounce(renderL2600Overshoot, 200);
  _l2600OvSlider = buildHourSlider(document.getElementById('l2600OvHourSlider'), 0, 23, debouncedLoad);
  fromSel.onchange = toSel.onchange = ()=>renderL2600Overshoot(_l2600OvSlider.lo, _l2600OvSlider.hi);
  renderL2600Overshoot(_l2600OvSlider.lo, _l2600OvSlider.hi);
}

// =====================================================================
// BUSY HOUR REPORT -- per-cell chronic busy-hour (default 20:00-23:00,
// last 3 days) underperformance, fetched once per Filters change from
// /api/busy_hour_report; the "chronically bad if >= X% of busy hours"
// slider then re-filters the SAME fetched rows client-side (no re-query
// needed, since the server already computed every cell's %-bad figure
// against the fixed window). Row click reuses geoOpenSiteCharts() (Geo
// Analysis's click-a-site modal) as-is -- same KPI line charts + TA
// distribution, just triggered from a different tab.
// =====================================================================
const BUSY_HOUR_ROOT_CAUSE_INFO = {
  congestion:   {label:'Congestion',   cls:'warn'},
  interference: {label:'Interference', cls:'purple'},
  availability: {label:'Availability', cls:'bad'},
  other:        {label:'Other',        cls:''},
  low_traffic:  {label:'Low traffic',  cls:''},
};
let _busyHourSlider = null;
let _busyHourRows = [];
const BUSY_HOUR_COLS = 9;
// Currently-filtered rows in display order -- kept for downloadBusyHourCsv()
// to export exactly what's on screen (threshold + search applied) rather
// than the full unfiltered fetch.
let _busyHourVisibleRows = [];
function renderBusyHourTable(){
  const q = (document.getElementById('busyHourSearch').value || '').trim().toLowerCase();
  const pctThreshold = parseInt(document.getElementById('busyHourPctSlider').value, 10);
  // Low-traffic cells are excluded no matter the slider position -- a cell
  // nobody was using during busy hour isn't a capacity problem, so it
  // never belongs in a "chronically bad" list regardless of threshold.
  let rows = _busyHourRows.filter(r=>r.root_cause!=='low_traffic' && r.pct_dl_bad>=pctThreshold);
  if(q) rows = rows.filter(r=>(r.site_id||'').toLowerCase().includes(q));
  rows = rows.slice().sort((a,b)=>b.pct_dl_bad - a.pct_dl_bad);
  _busyHourVisibleRows = rows;
  let t = '<table><thead><tr><th>Site</th><th>Cell</th><th>Band</th><th>Sector</th>'+
    '<th>DL Thrp (Mbps)</th><th>% busy hrs &lt;1</th>'+
    '<th>DL PRB%</th><th>UL Interf (dBm)</th><th>Root Cause</th></tr></thead><tbody>';
  if(rows.length){
    rows.forEach(r=>{
      const rc = BUSY_HOUR_ROOT_CAUSE_INFO[r.root_cause] || BUSY_HOUR_ROOT_CAUSE_INFO.other;
      t += `<tr class="clickable-row" onclick="geoOpenSiteCharts('${escAttr(r.site_id)}')" title="Click for this site's hourly trend across all carriers">
        <td>${esc(r.site_id)}</td><td style="font-size:10.5px">${esc(String(r.local_cell_id))}</td>
        <td>${esc(r.band)}</td><td class="sec">${esc(r.sector)}</td>
        <td class="${r.pct_dl_bad>=pctThreshold?'vb':''}">${fmt(r.avg_dl_thrp,2)}</td>
        <td class="pc ${r.pct_dl_bad>=pctThreshold?'vb':'vg'}">${fmt(r.pct_dl_bad,0)}%</td>
        <td class="pc ${r.avg_dl_prb>75?'vb':'vg'}">${fmt(r.avg_dl_prb,0)}%</td>
        <td>${fmt(r.avg_interference,1)}</td>
        <td><span class="badge ${rc.cls}">${rc.label}</span></td></tr>`;
    });
  } else if(_busyHourRows.length){
    t += `<tr><td colspan="${BUSY_HOUR_COLS}" style="text-align:center;color:var(--faint)">No cells match this threshold/search &mdash; try lowering the % slider.</td></tr>`;
  } else {
    t += `<tr><td colspan="${BUSY_HOUR_COLS}" style="text-align:center;color:var(--faint)">No busy-hour data in this range.</td></tr>`;
  }
  t += '</tbody></table>';
  document.getElementById('busyHourTable').innerHTML = t;
}
// CSV (opens directly in Excel) of exactly what's currently on screen --
// respects the persistence % slider and site search, same row order.
// Built and downloaded entirely client-side (no server round-trip): a Blob
// URL fed to a throwaway <a download>, which works fine here since this
// page is a real browser tab the user's own server served, not a
// sandboxed preview.
function downloadBusyHourCsv(){
  if(!_busyHourVisibleRows.length){ alert('No rows to export -- adjust the filters first.'); return; }
  const headers = ['Site','Cell','LocalCellId','Band','Sector','DL Thrp (Mbps)','% busy hrs < 1 Mbps','DL PRB%','UL Interference (dBm)','Root Cause'];
  const csvEsc = v => { const s = v===null||v===undefined ? '' : String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [headers.map(csvEsc).join(',')];
  _busyHourVisibleRows.forEach(r=>{
    const rc = BUSY_HOUR_ROOT_CAUSE_INFO[r.root_cause] || BUSY_HOUR_ROOT_CAUSE_INFO.other;
    lines.push([r.site_id, r.cell_name, r.local_cell_id, r.band, r.sector,
      fmt(r.avg_dl_thrp,2), fmt(r.pct_dl_bad,0), fmt(r.avg_dl_prb,0), fmt(r.avg_interference,1), rc.label
    ].map(csvEsc).join(','));
  });
  const blob = new Blob([lines.join('\r\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'Busy_Hour_Report.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function loadBusyHourReport(){
  const fromDate = document.getElementById('busyHourFromDate').value;
  const toDate = document.getElementById('busyHourToDate').value;
  const lo = _busyHourSlider ? _busyHourSlider.lo : 20, hi = _busyHourSlider ? _busyHourSlider.hi : 23;
  const status = document.getElementById('busyHourStatus');
  const scope = document.getElementById('busyHourScope');
  status.textContent = `Loading ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day…`;
  const qs = new URLSearchParams({from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/busy_hour_report?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      _busyHourRows = data.rows || [];
      const expected = _busyHourRows[0] ? _busyHourRows[0].expected_samples : 0;
      const rangeTxt = `${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day — ${expected} busy-hour sample(s) expected per cell, ${_busyHourRows.length} cell(s) total.`;
      status.textContent = rangeTxt;
      scope.textContent = rangeTxt;
      renderBusyHourTable();
    })
    .catch(err=>{
      status.textContent = 'Failed to load: ' + err.message + ' — requires the server (uv run src/server.py).';
      _busyHourRows = [];
      document.getElementById('busyHourTable').innerHTML = '';
    });
}
function renderBusyHourTab(){
  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromSel = document.getElementById('busyHourFromDate'), toSel = document.getElementById('busyHourToDate');
  fillDateSelect(fromSel, dates, dates[Math.max(0, dates.length-3)]);
  fillDateSelect(toSel, dates, dates[dates.length-1]);
  const debouncedLoad = debounce(loadBusyHourReport, 350);
  _busyHourSlider = buildHourSlider(document.getElementById('busyHourHourSlider'), 20, 23, debouncedLoad);
  fromSel.onchange = toSel.onchange = loadBusyHourReport;
  document.getElementById('busyHourSearch').oninput = ()=>renderBusyHourTable();
  const pctSlider = document.getElementById('busyHourPctSlider'), pctLabel = document.getElementById('busyHourPctLabel');
  pctSlider.oninput = ()=>{ pctLabel.textContent = pctSlider.value; renderBusyHourTable(); };
  loadBusyHourReport();
}

// =====================================================================
// TXN
// =====================================================================
function renderTxn(){
  const rows = DATA.txn.rows;
  let t = '<table><thead><tr><th>#</th><th>Site</th><th>Data Vol (GB)</th><th>VoLTE (Erl)</th><th>Contribution %</th><th>TNL Issues</th><th>Cells &lt;99% avail</th><th>Down Cells</th></tr></thead><tbody>';
  rows.forEach((r,i)=>{
    t += `<tr><td>${i+1}</td><td class="cid">${esc(r.site_id)}</td><td>${fmt(r.data_vol,1)}</td><td>${fmt(r.volte,0)}</td><td>${r.contrib_pct}%</td>
      <td class="${r.tnl_issues>20?'vb':r.tnl_issues>5?'vw':''}">${r.tnl_issues}</td>
      <td class="${r.avail_issue_cells>0?'vw':''}">${r.avail_issue_cells}</td>
      <td class="${r.down_cells>0?'vb':'vg'}">${r.down_cells>0?r.down_cells:'\u2014'}</td></tr>`;
  });
  t += '</tbody></table>';
  document.getElementById('txnTable').innerHTML = t;
}

// =====================================================================
// Hourly upload — posts the new Excel to the local server, which
// re-runs the ETL + rebuild pipeline in-process and returns the fresh
// data; the page then reloads to show it. Requires running via
// `uv run src/server.py` (a static-file open of this HTML has no
// backend to receive the upload).
// =====================================================================
function uploadHourlyFile(input){
  const file = input.files[0];
  if(!file) return;
  const status = document.getElementById('uploadStatus');
  status.className = 'busy';
  status.textContent = `Ingesting ${file.name}...`;
  const fd = new FormData();
  fd.append('file', file);
  fetch('/api/upload', { method:'POST', body: fd })
    .then(async r => {
      const data = await r.json().catch(()=>({}));
      if(!r.ok){ throw new Error(data.error || ('HTTP '+r.status)); }
      return data;
    })
    .then(data => {
      let msg;
      if(data.all_duplicate){
        // Every row in this file exactly matched what's already stored --
        // recognized as a full duplicate and skipped. The database was not
        // touched at all, so there's nothing new to reload.
        msg = `No changes — this file's data (${data.rows_level_duplicate} cell row(s), ${data.rows_group_duplicate} group row(s)) is already in the database, byte-for-byte identical. Nothing was written.`;
        status.className = 'ok';
        status.textContent = msg;
        input.value = '';
        return;
      }
      msg = `${data.rows_level_delta} new cell row(s), ${data.rows_level_overwritten} updated`;
      if(data.rows_level_duplicate > 0) msg += `, ${data.rows_level_duplicate} duplicate (skipped, unchanged)`;
      msg += ` — latest hour now ${data.latest_hour}.`;
      if(data.intra_file_duplicates > 0){
        msg += ` ⚠ ${data.intra_file_duplicates} duplicate key(s) found inside the file (e.g. ${data.intra_file_duplicate_sample.join(', ')}) — only the last occurrence of each was kept.`;
        status.className = 'busy';
      } else {
        status.className = 'ok';
      }
      status.textContent = msg + ' Reloading...';
      setTimeout(()=>{ window.location.reload(); }, data.intra_file_duplicates > 0 ? 4000 : 1200);
    })
    .catch(err => {
      status.className = 'err';
      status.textContent = 'Upload failed: ' + err.message;
    })
    .finally(()=>{ input.value = ''; });
}

// =====================================================================
// Cell database (geometry) upload -- lat/long/azimuth/beamwidth per
// cell. Matched by header name (not position), so it tolerates a
// different column layout than the hourly KPI file. Does not need a
// full rebuild (geometry doesn't feed any query yet) or a page reload.
// =====================================================================
function uploadGeometryFile(input){
  const file = input.files[0];
  if(!file) return;
  const status = document.getElementById('geoUploadStatus');
  status.className = 'busy';
  status.textContent = `Ingesting ${file.name}...`;
  const fd = new FormData();
  fd.append('file', file);
  fetch('/api/upload_geometry', { method:'POST', body: fd })
    .then(async r => {
      const data = await r.json().catch(()=>({}));
      if(!r.ok){ throw new Error(data.error || ('HTTP '+r.status)); }
      return data;
    })
    .then(data => {
      status.className = 'ok';
      // Multi-sheet response: {sheets, per_sheet:{name:{loaded,...}}, total_loaded}
      const perSheet = data.per_sheet || {};
      const parts = (data.sheets || Object.keys(perSheet)).map(name=>{
        const s = perSheet[name] || {};
        if(s.skipped) return `${name}: skipped (${s.reason})`;
        if(s.error) return `${name}: error — ${s.error}`;
        let p = `${name}: ${s.loaded||0} loaded`;
        const extras = [];
        if(s.skipped_no_match_in_app_scope) extras.push(`${s.skipped_no_match_in_app_scope} not in this app's data`);
        if(s.skipped_band_mismatch) extras.push(`${s.skipped_band_mismatch} band conflict`);
        if(s.skipped_missing_key) extras.push(`${s.skipped_missing_key} missing key`);
        if(s.skipped_blank_key) extras.push(`${s.skipped_blank_key} blank`);
        if(extras.length) p += ` (${extras.join(', ')})`;
        return p;
      });
      status.textContent = `${data.total_loaded} cell(s) total. ` + parts.join(' · ');
      // geoLoadedCount is baked into the static bundle at build time --
      // it won't reflect this upload until the next full rebuild.
    })
    .catch(err => {
      status.className = 'err';
      status.textContent = 'Upload failed: ' + err.message;
    })
    .finally(()=>{ input.value = ''; });
}

// Header "Delete Data": password-protected wipe of ALL data (hourly
// KPIs, geometry, upload log). The password is verified server-side by
// /api/delete_all_data; this dialog only collects it.
function openDeleteDataModal(){
  const modal = document.getElementById('deleteDataModal');
  if(!modal) return;
  document.getElementById('deleteDataPassword').value = '';
  const st = document.getElementById('deleteDataStatus');
  st.textContent = ''; st.className = 'pw-status';
  document.getElementById('deleteDataBtn').disabled = false;
  modal.classList.remove('hidden');
  setTimeout(()=>document.getElementById('deleteDataPassword').focus(), 30);
}
function closeDeleteDataModal(){
  const modal = document.getElementById('deleteDataModal');
  if(modal) modal.classList.add('hidden');
}
function confirmDeleteData(){
  const pw = document.getElementById('deleteDataPassword').value;
  const st = document.getElementById('deleteDataStatus');
  const btn = document.getElementById('deleteDataBtn');
  if(!pw){ st.className = 'pw-status err'; st.textContent = 'Enter the password.'; return; }
  btn.disabled = true;
  st.className = 'pw-status busy';
  st.textContent = 'Deleting all data… this can take a minute on a large database.';
  fetch('/api/delete_all_data', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw})})
    .then(async r => {
      const data = await r.json().catch(()=>({}));
      if(!r.ok){ throw new Error(r.status===403 ? 'Incorrect password.' : (data.error || ('HTTP '+r.status))); }
      return data;
    })
    .then(() => {
      st.className = 'pw-status ok';
      st.textContent = 'All data deleted. Reloading…';
      setTimeout(()=>window.location.reload(), 900);
    })
    .catch(err => {
      btn.disabled = false;
      st.className = 'pw-status err';
      st.textContent = err.message === 'Failed to fetch' ? 'Server not reachable — start it with uv run src/server.py.' : err.message;
      const inp = document.getElementById('deleteDataPassword');
      inp.select(); inp.focus();
    });
}

// =====================================================================
// Data Management — lists every upload (grouped by the batch it was
// ingested as) and lets one be deleted. Deleting removes the data for
// every hour that batch touched, from whichever table(s) it touched --
// not just what that specific upload added -- so if a later upload
// also touched one of those hours, that gets flagged before you
// delete, not discovered after.
// =====================================================================
function loadDataManagement(){
  const note = document.getElementById('dmgmtNote');
  const table = document.getElementById('dmgmtTable');
  note.textContent = 'Loading...';
  fetch('/api/uploads')
    .then(async r => {
      if(!r.ok){ throw new Error('HTTP '+r.status); }
      return r.json();
    })
    .then(uploads => {
      note.textContent = uploads.length + ' upload(s) on record.';
      if(uploads.length === 0){
        table.innerHTML = '<div class="placeholder"><div class="big">&#128193;</div>No uploads yet — use the Upload Hourly Data button to add the first one.</div>';
        return;
      }
      let html = '<table><thead><tr><th>Uploaded At</th><th>File</th><th>Sheets</th><th>Rows Loaded</th><th>Hours Touched</th><th></th></tr></thead><tbody>';
      uploads.forEach(u=>{
        const hoursList = Object.entries(u.hours_touched).map(([sheet,hrs])=>`${sheet}: ${hrs.join(', ')}`).join(' · ');
        const overlapBadge = u.overlaps_later_upload.length
          ? `<span class="overlap-badge">⚠ ${u.overlaps_later_upload.join('/')} hour(s) later overwritten</span>` : '';
        html += `<tr>
          <td>${esc(u.ingested_at)}</td>
          <td class="cid">${esc(u.source_file)}</td>
          <td>${u.sheets.join(', ')}</td>
          <td>${u.rows_loaded_total}</td>
          <td style="white-space:normal;font-size:11px">${esc(hoursList)}${overlapBadge}</td>
          <td><button class="delbtn" onclick="deleteUpload('${u.batch_id}', this)">Delete</button></td>
        </tr>`;
      });
      html += '</tbody></table>';
      table.innerHTML = html;
    })
    .catch(err => {
      note.textContent = 'Could not load uploads: ' + err.message + ' — requires the server (uv run src/server.py).';
      table.innerHTML = '';
    });
}
function deleteUpload(batchId, btn){
  const row = btn.closest('tr');
  const hasOverlap = row && row.querySelector('.overlap-badge');
  const warning = hasOverlap
    ? 'This upload\'s hour(s) were later overwritten by a newer upload. Deleting it will remove the CURRENT data for those hours (which now belongs to the newer upload), not just what this upload originally added. Delete anyway?'
    : 'This deletes all data for the hour(s) this upload touched. Continue?';
  if(!confirm(warning)) return;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  fetch(`/api/uploads/${batchId}/delete`, { method:'POST' })
    .then(async r => {
      const data = await r.json().catch(()=>({}));
      if(!r.ok){ throw new Error(data.error || ('HTTP '+r.status)); }
      return data;
    })
    .then(()=>{
      btn.textContent = 'Deleted — reloading...';
      setTimeout(()=>{ window.location.reload(); }, 800);
    })
    .catch(err => { alert('Delete failed: ' + err.message); btn.disabled=false; btn.textContent='Delete'; });
}

// =====================================================================
// GEO ANALYSIS -- real OpenStreetMap basemap (Leaflet, vendored inline --
// see src/vendor/leaflet.js/.css -- so the app HTML stays one file; only
// the map TILE IMAGES are fetched live from tile.openstreetmap.org, which
// needs network access) with a custom SVG overlay drawn on top for the
// per-band sector wedges. Co-located cells at one site normally share the
// exact same lat/long, so each cell is drawn as a full pie-slice wedge
// from that one shared point, pointed at its recorded azimuth -- plain pie
// style, not nested rings; where two bands share (near enough) the same
// azimuth at one site their slices do overlap, later bands in
// GEO_RING_ORDER painting over earlier ones. Wedges are always shown, at
// every zoom level, sized to a fixed pixel radius (constant regardless of
// zoom) so sites stay visible whether you're zoomed into one neighborhood
// or looking at the whole network. Site/cell data is baked into the
// static bundle (one row per cell, no time dimension); only the tile
// imagery is remote. The overlay SVG has pointer-events:none with
// .geo-wedge/.geo-site-dot set back to auto, so empty map area passes
// drag/scroll straight through to Leaflet while hover/click still work on
// markers.
// =====================================================================
const GEO_RING_ORDER = ['L850','L900','L1800','L2100','L2600'];
// Every band is drawn as a full pie slice from the site's center point out
// to this same base radius -- no more per-band concentric rings. When
// multiple bands share the same (or a close) azimuth at one site, later
// bands in GEO_RING_ORDER paint over earlier ones, same trade-off a plain
// pie chart has with fully-overlapping slices. This is a BASE size in
// local marker-group units -- geoMarkerScale() then grows/shrinks the
// whole marker group with the current Leaflet zoom (see geoRepositionMarkers),
// so sites are unmistakable once you're zoomed in, not pinned to one
// constant screen size.
const GEO_WEDGE_RADIUS = 11;
const GEO_DOT_RADIUS = 3.5;
const GEO_WEDGE_HALF_ANGLE = 26; // degrees either side of azimuth -- real beamwidth isn't in the source file, so this approximates a typical ~52° sector antenna

// ---- Congestion / throughput color-by modes -----------------------------
// Same 4-color escalating-severity palette as the L2600 TA/overshoot
// charts (OVERSHOOT_RANGES), reused here for visual consistency: green ->
// orange -> pink -> red as PRB utilization climbs.
const GEO_PRB_RANGES = [
  {max:60, color:'#10b981', label:'0&ndash;60%'},
  {max:75, color:'#f59e0b', label:'60&ndash;75%'},
  {max:85, color:'#f472b6', label:'75&ndash;85%'},
  {max:Infinity, color:'#ef4444', label:'&gt;85%'},
];
// UL/DL user-throughput color-by modes -- LOWER throughput is worse here,
// the opposite direction from the PRB ranges above. Each table is still
// ordered index0=best(green)...last=worst(red), just matched by the
// highest MIN bound a value clears (geoLowValueColor) instead of PRB's
// ascending-max scan (geoPrbColor), so geoModeBuckets()/geoWorstColor
// below can rank any of these tables the same way: array index = severity.
const GEO_UL_THRP_RANGES = [
  {min:1,          color:'#10b981', label:'&ge;1 Mbps'},
  {min:0.4,        color:'#f472b6', label:'0.4&ndash;1 Mbps'},
  {min:-Infinity,  color:'#ef4444', label:'&lt;0.4 Mbps'},
];
const GEO_DL_THRP_RANGES = [
  {min:3,          color:'#10b981', label:'&ge;3 Mbps'},
  {min:1,          color:'#f472b6', label:'1&ndash;3 Mbps'},
  {min:-Infinity,  color:'#ef4444', label:'&lt;1 Mbps'},
];
// UL interference (dBm, closer to 0 = noisier/worse) -- only a single
// "flag above this" threshold, so this is a plain 2-way OK/fail split
// rather than a 3-tier range table.
const GEO_INTERFERENCE_THRESHOLD = -95; // dBm -- above (less negative than) this is flagged
const GEO_INTERFERENCE_OK_COLOR = '#10b981';
const GEO_INTERFERENCE_FAIL_COLOR = '#ef4444';
const GEO_NODATA_COLOR = '#3a4250';
const GEO_MODES = [
  {id:'band', label:'Band'},
  {id:'dlprb', label:'DL PRB Util'},
  {id:'ulprb', label:'UL PRB Util'},
  {id:'dlthrp', label:'DL Low Throughput'},
  {id:'ulthrp', label:'UL Low Throughput'},
  {id:'interference', label:'UL Interference'},
];
function geoPrbColor(pct){
  if(pct===null || pct===undefined || isNaN(pct)) return null;
  for(const r of GEO_PRB_RANGES) if(pct < r.max) return r.color;
  return GEO_PRB_RANGES[GEO_PRB_RANGES.length-1].color;
}
// Same idea as geoPrbColor but for a "lower is worse" KPI: ranges ordered
// best..worst, matched by the highest MIN bound the value clears.
function geoLowValueColor(ranges, value){
  if(value===null || value===undefined || isNaN(value)) return null;
  for(const r of ranges) if(value >= r.min) return r.color;
  return ranges[ranges.length-1].color;
}
function geoInterferenceColor(dbm){
  if(dbm===null || dbm===undefined || isNaN(dbm)) return null;
  return dbm > GEO_INTERFERENCE_THRESHOLD ? GEO_INTERFERENCE_FAIL_COLOR : GEO_INTERFERENCE_OK_COLOR;
}
// Resolves one cell's wedge color for the current metric mode. Returns
// null when there's no data for that cell in the selected range (a
// distinct "no data" gray, never silently defaulting to a bucket color).
function geoMetricColor(mode, metric){
  if(!metric) return null;
  if(mode==='dlprb') return geoPrbColor(metric.dl_prb_util);
  if(mode==='ulprb') return geoPrbColor(metric.ul_prb_util);
  if(mode==='dlthrp') return geoLowValueColor(GEO_DL_THRP_RANGES, metric.dl_thrp);
  if(mode==='ulthrp') return geoLowValueColor(GEO_UL_THRP_RANGES, metric.ul_thrp);
  if(mode==='interference') return geoInterferenceColor(metric.ul_interference);
  return null;
}
// The legend/distribution buckets for a metric mode, ordered index0=best
// ... last=worst -- doubles as the severity ranking for geoWorstColor
// (array index = rank) so there's one source of truth for both.
function geoModeBuckets(mode){
  if(mode==='dlprb' || mode==='ulprb') return GEO_PRB_RANGES.map(r=>({label:r.label, color:r.color}));
  if(mode==='dlthrp') return GEO_DL_THRP_RANGES.map(r=>({label:r.label, color:r.color}));
  if(mode==='ulthrp') return GEO_UL_THRP_RANGES.map(r=>({label:r.label, color:r.color}));
  if(mode==='interference') return [
    {label:`&le;${GEO_INTERFERENCE_THRESHOLD} dBm`, color:GEO_INTERFERENCE_OK_COLOR},
    {label:`&gt;${GEO_INTERFERENCE_THRESHOLD} dBm`, color:GEO_INTERFERENCE_FAIL_COLOR},
  ];
  return [];
}
// Worst-case color across a site's cells (for the always-visible site dot,
// which needs to flag trouble even below the wedge zoom threshold). Rank
// order matches severity via geoModeBuckets (array index = rank).
function geoWorstColor(mode, cells){
  let best = -1, color = null;
  const buckets = geoModeBuckets(mode);
  cells.forEach(c=>{
    const metric = _geoMetrics[c.cell_name];
    const col = geoMetricColor(mode, metric);
    if(!col) return;
    const rank = buckets.findIndex(b=>b.color===col);
    if(rank>best){ best=rank; color=col; }
  });
  return color;
}

function geoComputeBounds(cells){
  const lats = cells.map(c=>c.latitude).slice().sort((a,b)=>a-b);
  const lons = cells.map(c=>c.longitude).slice().sort((a,b)=>a-b);
  // 1st-99th percentile bounds, not raw min/max -- a handful of cells in
  // real uploads have clearly wrong coordinates (hundreds of km off); a
  // couple of bad rows shouldn't compress the whole map into a corner.
  const pct = (arr,p)=>arr[Math.min(arr.length-1, Math.max(0, Math.floor(arr.length*p)))];
  const latMin = pct(lats,0.01), latMax = pct(lats,0.99);
  const lonMin = pct(lons,0.01), lonMax = pct(lons,0.99);
  return L.latLngBounds([latMin,lonMin],[latMax,lonMax]);
}

function geoGroupBySite(cells){
  const sites = {};
  cells.forEach(c=>{
    if(!sites[c.site_id]) sites[c.site_id] = {site_id:c.site_id, lat:c.latitude, lon:c.longitude, cells:[]};
    sites[c.site_id].cells.push(c);
  });
  return Object.values(sites);
}

// Plain pie slice of radius r centered at (cx,cy), spanning
// [az-halfAngle, az+halfAngle] (compass bearing, 0=up/North, clockwise).
// Where two bands at one site share (near enough) the same azimuth, the
// later one drawn (see GEO_RING_ORDER) paints over the earlier one --
// same overlap trade-off any pie chart has with coincident slices.
function geoWedgePath(cx, cy, r, azDeg, halfAngle){
  const a1 = (azDeg-halfAngle)*Math.PI/180, a2 = (azDeg+halfAngle)*Math.PI/180;
  const ox1 = cx+r*Math.sin(a1), oy1 = cy-r*Math.cos(a1);
  const ox2 = cx+r*Math.sin(a2), oy2 = cy-r*Math.cos(a2);
  const largeArc = (halfAngle*2)>180 ? 1 : 0;
  return `M${cx.toFixed(1)},${cy.toFixed(1)} L${ox1.toFixed(1)},${oy1.toFixed(1)} A${r},${r} 0 ${largeArc} 1 ${ox2.toFixed(1)},${oy2.toFixed(1)} Z`;
}

let _geoMap = null, _geoBounds = null, _geoShown = false;
let _geoSitesData = [], _geoBandFilter = new Set(), _geoBandsPresent = [];
let _geoMapWired = false;
let _geoMode = 'band';
let _geoMetrics = {};        // cell_name -> {dl_prb_util, ul_prb_util, dl_thrp, ul_thrp, ul_interference, n_samples}, live-fetched
let _geoMetricsLoaded = false;
let _geoHourSlider = null;

// Creates the Leaflet map + OSM tile layer once cell geometry exists. The
// #geo tab isn't the active one at page load, so its container is
// display:none and has zero size here -- we still give the map a real
// center/zoom (setView) so lat/lng math works right away, but the
// size-dependent fitBounds() is deferred to geoOnTabShown(), the first
// time the tab actually becomes visible.
function geoInitMap(cells){
  _geoBounds = geoComputeBounds(cells);
  _geoMap = L.map('geoLeafletMap', {zoomControl:false, minZoom:3, maxZoom:19, worldCopyJump:true});
  _geoMap.setView(_geoBounds.getCenter(), 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'geo-dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(_geoMap);
  _geoMap.on('move', geoRepositionMarkers);
  // Leaflet auto-handles the browser WINDOW resizing but has no idea when
  // its own container's size changes for some other reason -- a tab
  // becoming visible, or (the reason this is here) #geoMapWrap moving into
  // or out of the "bigger display" modal, whose vw/vh sizing can take an
  // unpredictable number of layout passes to actually settle. Rather than
  // guess how many frames that takes, just watch the container directly
  // and resync whenever its real size changes, however long that takes.
  if(typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(()=>{ _geoMap.invalidateSize(); geoRepositionMarkers(); }).observe(_geoMap.getContainer());
  }
}
// Called from the tab-switcher the first (and every) time the Geo Analysis
// tab is shown -- invalidateSize() re-measures the now-visible container
// (Leaflet can't know its size while display:none), and the very first
// time, fitBounds() sets the real initial view (deferred until now because
// it needs that correct size to compute a sane zoom level).
function geoOnTabShown(){
  if(!_geoMap) return;
  _geoMap.invalidateSize();
  if(!_geoShown){
    _geoShown = true;
    _geoMap.fitBounds(_geoBounds, {padding:[30,30]});
  }
  geoRepositionMarkers();
}
// Markers grow as you zoom in (like a real GIS point symbol, not a
// constant-screen-size pin) so a site is unmistakable once you're zoomed
// in close, while staying compact zoomed out so dense clusters don't
// smear into a blob. Clamped at both ends.
function geoMarkerScale(){
  if(!_geoMap) return 1;
  return Math.max(0.5, Math.min(4, 1 + (_geoMap.getZoom()-12)*0.4));
}
// Site markers (dot + its band wedges) are drawn at local origin (0,0) and
// positioned+scaled via their own group's transform -- see geoRenderMap().
// On every Leaflet 'move' (pan, zoom, programmatic fitBounds/setView) this
// just recomputes each group's screen position and current zoom-scale from
// its stored lat/lon, without touching the wedge/dot geometry itself
// (getZoom() already reflects the target zoom the instant a zoom starts,
// so the scale keeps pace with the position through the whole animation
// rather than snapping only at 'zoomend').
function geoRepositionMarkers(){
  if(!_geoMap) return;
  const k = geoMarkerScale().toFixed(3);
  document.querySelectorAll('.geo-site-g').forEach(el=>{
    const p = _geoMap.latLngToContainerPoint([parseFloat(el.dataset.lat), parseFloat(el.dataset.lon)]);
    el.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${k})`);
  });
}
function geoZoom(factor){
  if(!_geoMap) return;
  if(factor>1) _geoMap.zoomIn(); else _geoMap.zoomOut();
}
function geoResetView(){
  if(!_geoMap || !_geoBounds) return;
  _geoMap.fitBounds(_geoBounds, {padding:[30,30]});
}
// "Bigger display" -- moves the SAME #geoMapWrap element (Leaflet
// instance, tiles, overlay SVG and all) into the fullscreen-ish modal
// rather than re-rendering a second map, so it's an exact live view of
// whatever's already on screen (same mode/bands/search/pan/zoom).
// appendChild on an element already in the document MOVES it, it doesn't
// clone it, so the Leaflet map object stays attached and doesn't need
// reinitializing -- the ResizeObserver set up in geoInitMap notices the
// container's new (much bigger) size on its own and resyncs Leaflet, no
// matter how many layout passes the modal's vw/vh sizing takes to settle.
let _geoMapWrapHome = null; // {parent, next} to restore geoMapWrap to on close
function geoOpenMapModal(){
  const wrap = document.getElementById('geoMapWrap');
  if(!wrap || !_geoMap || _geoMapWrapHome) return;
  _geoMapWrapHome = {parent: wrap.parentNode, next: wrap.nextSibling};
  document.getElementById('geoMapModalBody').appendChild(wrap);
  document.getElementById('geoMapModal').classList.remove('hidden');
}
function geoCloseMapModal(){
  const wrap = document.getElementById('geoMapWrap');
  if(!wrap || !_geoMapWrapHome) return;
  const {parent, next} = _geoMapWrapHome;
  _geoMapWrapHome = null;
  if(next) parent.insertBefore(wrap, next); else parent.appendChild(wrap);
  document.getElementById('geoMapModal').classList.add('hidden');
}
// Click-a-site KPI charts: DL/UL user throughput, DL/UL PRB utilization,
// and UL interference, one line per cell, for whatever site was clicked
// (dot OR wedge -- the specific sector clicked doesn't narrow it, every
// band/carrier at that site is shown). Reuses the exact same
// /api/site_kpis response and buildSiteCharts()/multiCellChart()
// rendering the Site KPIs tab uses, just trimmed down to those 5 charts
// and given its own modal/container (site KPIs tab's #sitePanels is a
// different element on a different tab). Always the last 4 days, every
// hour -- same fixed range as the MLB_SRVCC_CA "No CA" site drilldown
// (loadNoCaSiteDrilldown) -- rather than whatever this tab's own Filters
// panel date range happens to be set to (that's for the map's "Color by"
// coloring, a separate concern).
let _geoSiteChartsOpen = false;
let _geoSiteChartsSite = null; // which site the in-flight/rendered fetch is for, so a stale response never overwrites a newer one
const GEO_SITE_CHART_PANELS = {'Throughput': null, 'PRB Utilization': ['DL PRB Utilization', 'UL PRB Utilization'], 'Interference': null};
// Per-band TA (UE distance from site) distribution for the clicked site --
// same "TA Distribution Analysis" component (OVERSHOOT_RANGES buckets,
// pbarRow rows) the L2600 tab's sector drilldown (loadL2600SectorTa) uses,
// just summed across every sector at the site (via /api/ta_by_site)
// instead of one drilled-into sector, matching how the 4 KPI charts above
// already cover every carrier/sector together.
function geoLoadSiteTa(siteId, fromDate, toDate){
  const container = document.getElementById('geoSiteChartsTa');
  container.innerHTML = '<div class="ctl-note">Loading TA distribution&hellip;</div>';
  const qs = new URLSearchParams({site: siteId, from_date: fromDate, to_date: toDate, from_hour: 0, to_hour: 23});
  fetch('/api/ta_by_site?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(_geoSiteChartsSite !== siteId) return; // closed, or a different site opened, while this was in flight
      const bands = (data.rows || [])
        .map(row=>({ band: row.band, t: [0,1,2,3,4,5,6,7,8,9,10,11].map(i=>row['ta_idx'+i]||0) }))
        .filter(b=>b.band && b.t.some(v=>v>0))
        .sort((a,b)=>BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band));
      if(!bands.length){
        container.innerHTML = '<div class="ctl-note">No TA (distance) samples for this site in range.</div>';
        return;
      }
      const legend = OVERSHOOT_RANGES.map(r=>`<div class="bl-chip" style="flex:0 0 auto;min-width:auto"><span class="dot" style="background:${r.color}"></span><span class="bl-name">${r.label}</span></div>`).join('');
      const rows = bands.map(b=>{
        const counts = overshootBuckets(b.t);
        const total = counts.reduce((a,c)=>a+c,0) || 1;
        const segs = OVERSHOOT_RANGES.map((r,i)=>({pct: 100*counts[i]/total, color: r.color, text: fmt(100*counts[i]/total,1)+'%'}));
        return pbarRow(abbrBand(b.band), segs);
      }).join('');
      container.innerHTML = `<div class="bigchart-card" style="max-width:100%">
        <div class="bigchart-head"><span class="bigchart-title">TA Distribution Analysis</span><span class="bigchart-unit">% of TA samples, per carrier</span></div>
        <div class="bl-legend" style="margin-bottom:14px">${legend}</div>
        <div>${rows}</div>
      </div>`;
    })
    .catch(err=>{
      container.innerHTML = `<div class="ctl-note err">Failed to load TA distribution: ${esc(err.message)}</div>`;
    });
}
function geoOpenSiteCharts(siteId){
  const modal = document.getElementById('geoSiteChartsModal');
  const body = document.getElementById('geoSiteChartsBody');
  document.getElementById('geoSiteChartsTitle').textContent = `${siteId} — last 4 days hourly`;
  body.innerHTML = `<div class="ctl-note">Loading ${esc(siteId)}&hellip;</div>`;
  document.getElementById('geoSiteChartsTa').innerHTML = '';
  modal.classList.remove('hidden');
  _geoSiteChartsOpen = true;
  _geoSiteChartsSite = siteId;
  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  const fromDate = dates[Math.max(0, dates.length-4)];
  const toDate = dates[dates.length-1];
  geoLoadSiteTa(siteId, fromDate, toDate);
  const qs = new URLSearchParams({site: siteId, from_date: fromDate, to_date: toDate, from_hour: 0, to_hour: 23});
  fetch('/api/site_kpis?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      // Bail if the modal was closed, or a different site opened, while
      // this request was in flight -- avoids rendering stale results.
      if(modal.classList.contains('hidden')) return;
      if(_geoSiteChartsSite !== siteId) return;
      if(!data.dates || !data.dates.length){
        body.innerHTML = `<div class="ctl-note">No data for "${esc(siteId)}" in that range.</div>`;
        return;
      }
      const panels = data.panels
        .filter(p=>GEO_SITE_CHART_PANELS.hasOwnProperty(p.panel))
        .map(p=>{
          const keep = GEO_SITE_CHART_PANELS[p.panel];
          return {panel: p.panel, charts: keep ? p.charts.filter(c=>keep.includes(c.label)) : p.charts};
        });
      buildSiteCharts({...data, panels}, 'geoSiteChartsBody');
    })
    .catch(err=>{
      body.innerHTML = `<div class="ctl-note err">Failed to load: ${esc(err.message)} &mdash; requires the server (uv run src/server.py).</div>`;
    });
}
function geoCloseSiteCharts(){
  document.getElementById('geoSiteChartsModal').classList.add('hidden');
  document.getElementById('geoSiteChartsBody').innerHTML = '';
  document.getElementById('geoSiteChartsTa').innerHTML = '';
  _geoSiteChartsOpen = false;
  _geoSiteChartsSite = null;
}
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  if(_geoMapWrapHome) geoCloseMapModal();
  if(_geoSiteChartsOpen) geoCloseSiteCharts();
});
// "Take me to that site" -- fired on Enter in the search box. Prefers an
// exact (case-insensitive) site_id match; falls back to the first
// substring match. Jumps there and zooms in enough to see it clearly (but
// never zooms OUT if already closer than that); every other site stays
// exactly as it was, same as panning/zooming any other way (see
// geoRenderMap -- the search box never hides or dims anything). Deliberately
// setView({animate:false}) rather than flyTo/animated setView: Leaflet's
// animated pan/zoom rides on requestAnimationFrame, which browsers throttle
// or pause in a backgrounded/inactive tab -- an animated jump can silently
// never finish there, while an unanimated one always lands immediately.
function geoSiteSearchGoTo(){
  if(!_geoMap) return;
  const q = (document.getElementById('geoSiteSearch').value||'').trim().toLowerCase();
  if(!q) return;
  const match = _geoSitesData.find(s=>s.site_id.toLowerCase()===q)
    || _geoSitesData.find(s=>s.site_id.toLowerCase().includes(q));
  if(!match) return;
  _geoMap.setView([match.lat, match.lon], Math.max(_geoMap.getZoom(), 17), {animate:false});
}
function geoToggleBand(band, chipEl){
  if(_geoBandFilter.has(band)){ _geoBandFilter.delete(band); chipEl.classList.add('off'); }
  else { _geoBandFilter.add(band); chipEl.classList.remove('off'); }
  geoRenderMap();
}

function geoRenderMap(){
  const svg = document.getElementById('geoMapSvg');
  if(!_geoMap) return;
  const mode = _geoMode;
  const isMetricMode = mode !== 'band';
  const bucketDefs = geoModeBuckets(mode);

  let dots='', wedges='';
  const markerK = geoMarkerScale().toFixed(3);
  _geoSitesData.forEach(site=>{
    // Every site always renders at full visibility, same as every other
    // map/GIS view -- the search box (see geoSiteSearchGoTo) only pans
    // and zooms to a match, it never hides or dims anything else.
    const p = _geoMap.latLngToContainerPoint([site.lat, site.lon]);
    const cxs = p.x.toFixed(1), cys = p.y.toFixed(1);
    const gTr = `translate(${cxs},${cys}) scale(${markerK})`;
    const latLonAttrs = `data-lat="${site.lat}" data-lon="${site.lon}"`;
    const byBand = {};
    site.cells.forEach(c=>{ if(_geoBandFilter.has(c.band)) (byBand[c.band]=byBand[c.band]||[]).push(c); });
    const hasAny = Object.keys(byBand).length>0;
    const allSiteCells = hasAny ? Object.values(byBand).flat() : [];
    // Site dot: always visible (even below the wedge zoom threshold), so
    // in a metric mode it carries the WORST color among the site's
    // currently-visible cells -- lets you spot trouble spots while
    // still zoomed out across the whole network.
    let dotFillAttr = '';
    if(isMetricMode && hasAny){
      const worst = geoWorstColor(mode, allSiteCells);
      dotFillAttr = ` fill="${worst || GEO_NODATA_COLOR}"`;
    }
    // Marker drawn at LOCAL origin (0,0), positioned via the group's own
    // translate -- geoRepositionMarkers() keeps it pinned to (lat,lon) as
    // the map pans/zooms, using the lat/lon stashed on the group itself.
    dots += `<g class="geo-site-g" ${latLonAttrs} transform="${gTr}">
      <circle class="geo-site-dot" cx="0" cy="0" r="${GEO_DOT_RADIUS}"${dotFillAttr} opacity="${hasAny?1:0.3}" data-tip="${escAttr(JSON.stringify({site:site.site_id, siteOnly:true}))}"/>
    </g>`;
    let siteWedges = '';
    GEO_RING_ORDER.forEach(band=>{
      const list = byBand[band];
      if(!list) return;
      list.forEach(c=>{
        const az = c.azimuth||0;
        const d = geoWedgePath(0,0,GEO_WEDGE_RADIUS,az,GEO_WEDGE_HALF_ANGLE);
        const metric = _geoMetrics[c.cell_name] || null;
        let fill, cls = 'geo-wedge';
        if(!isMetricMode){
          fill = BAND_COLORS[band]||'#888';
        } else {
          const col = geoMetricColor(mode, metric);
          if(col){
            fill = col;
          } else {
            fill = GEO_NODATA_COLOR;
            cls += ' geo-nodata';
          }
        }
        const tip = escAttr(JSON.stringify({site:site.site_id, band, sector:c.sector, az, cell:c.cell_name, metric, mode}));
        siteWedges += `<path class="${cls}" d="${d}" fill="${fill}" data-tip="${tip}"/>`;
      });
    });
    if(siteWedges) wedges += `<g class="geo-site-g" ${latLonAttrs} transform="${gTr}">${siteWedges}</g>`;
  });
  svg.innerHTML = `<g id="geoDotsG">${dots}</g>
    <g id="geoWedgesG">${wedges}</g>`;

  geoRenderLegend(mode, bucketDefs);
}

// Map-corner legend: band swatches when mode=='band' (static, unaffected
// by range), or the color-bucket key for whichever metric mode is active.
// (There used to also be a bucket-distribution bar chart below the map for
// metric modes -- removed to give the map itself more room; the per-band
// coloring is already visible directly on the map.)
function geoRenderLegend(mode, bucketDefs){
  const legend = document.getElementById('geoMapLegend');
  if(mode==='band'){
    legend.innerHTML = _geoBandsPresent.map(b=>
      `<div class="row"><span class="sw" style="background:${BAND_COLORS[b]}"></span>${b}</div>`
    ).join('') + `<div class="row" style="margin-top:2px;color:var(--faint)">wedge = sector azimuth</div>`;
    return;
  }
  legend.innerHTML = bucketDefs.map(b=>
    `<div class="row"><span class="sw" style="background:${b.color}"></span>${b.label}</div>`
  ).join('') + `<div class="row"><span class="sw" style="background:${GEO_NODATA_COLOR}"></span>No data in range</div>`;
}

// Leaflet owns dragging/wheel-zoom on the map beneath -- the overlay SVG
// has pointer-events:none (with .geo-wedge/.geo-site-dot set back to auto,
// see style.css), so a mousedown/wheel over empty map area passes straight
// through to Leaflet instead of being caught here. This wiring only needs
// to handle the hover tooltip on markers.
function geoWireMapInteractions(){
  if(_geoMapWired) return;
  _geoMapWired = true;
  const svg = document.getElementById('geoMapSvg');
  const tip = document.getElementById('geoMapTip');

  svg.addEventListener('mousemove', e=>{
    const el = e.target.closest('.geo-wedge, .geo-site-dot');
    if(!el){ tip.classList.add('hidden'); return; }
    const info = JSON.parse(el.dataset.tip);
    let metricRows = '';
    if(info.mode && info.mode!=='band'){
      const m = info.metric;
      if(!m){
        metricRows = `<div class="t-row"><span class="k">${esc(GEO_MODES.find(g=>g.id===info.mode).label)}</span><span>no data in range</span></div>`;
      } else if(info.mode==='dlprb'){
        metricRows = `<div class="t-row"><span class="k">DL PRB Util</span><span>${fmt(m.dl_prb_util,1)}%</span></div>`;
      } else if(info.mode==='ulprb'){
        metricRows = `<div class="t-row"><span class="k">UL PRB Util</span><span>${fmt(m.ul_prb_util,1)}%</span></div>`;
      } else if(info.mode==='dlthrp'){
        const col = geoMetricColor('dlthrp', m);
        const warn = col===GEO_DL_THRP_RANGES[GEO_DL_THRP_RANGES.length-1].color;
        metricRows = `<div class="t-row"><span class="k">DL Thrp</span><span style="color:${col||'inherit'}">${fmt(m.dl_thrp,2)} Mbps${warn?' &#9888;':''}</span></div>`;
      } else if(info.mode==='ulthrp'){
        const col = geoMetricColor('ulthrp', m);
        const warn = col===GEO_UL_THRP_RANGES[GEO_UL_THRP_RANGES.length-1].color;
        metricRows = `<div class="t-row"><span class="k">UL Thrp</span><span style="color:${col||'inherit'}">${fmt(m.ul_thrp,2)} Mbps${warn?' &#9888;':''}</span></div>`;
      } else if(info.mode==='interference'){
        const col = geoMetricColor('interference', m);
        const warn = col===GEO_INTERFERENCE_FAIL_COLOR;
        metricRows = `<div class="t-row"><span class="k">UL Interference</span><span style="color:${col||'inherit'}">${fmt(m.ul_interference,1)} dBm${warn?' &#9888;':''}</span></div>`;
      }
    }
    tip.innerHTML = info.siteOnly
      ? `<div class="t-site">${esc(info.site)}</div><div class="t-row"><span class="k">Zoom in</span><span>to see sectors</span></div>`
      : `<div class="t-site">${esc(info.site)}</div>
      <div class="t-row"><span class="k">Band</span><span>${esc(info.band)}</span></div>
      <div class="t-row"><span class="k">Sector</span><span>${esc(info.sector||'?')}</span></div>
      <div class="t-row"><span class="k">Azimuth</span><span>${info.az}&deg;</span></div>
      ${metricRows}
      <div class="t-row"><span class="k">Cell</span><span style="font-size:9.5px">${esc(info.cell)}</span></div>`;
    tip.classList.remove('hidden');
    const vw=window.innerWidth, vh=window.innerHeight, off=14;
    let left=e.clientX+off, top=e.clientY+off;
    if(left+290>vw) left=e.clientX-290-off;
    if(top+110>vh) top=e.clientY-110-off;
    tip.style.left=left+'px'; tip.style.top=top+'px';
  });
  svg.addEventListener('mouseleave', ()=>{ tip.classList.add('hidden'); });
  // Hover (above) stays a lightweight per-cell tooltip; a click goes
  // further and opens the site-wide KPI line charts (every band/carrier
  // at that site, not just the sector clicked) -- see geoOpenSiteCharts().
  svg.addEventListener('click', e=>{
    if(_roadMode) return; // drawing a road -- a click on a wedge/dot shouldn't pop the site-charts modal
    const el = e.target.closest('.geo-wedge, .geo-site-dot');
    if(!el) return;
    const info = JSON.parse(el.dataset.tip);
    geoOpenSiteCharts(info.site);
  });
}

function renderGeoAnalysis(){
  document.getElementById('geoCellCount').textContent = DATA.meta.n_cells;
  document.getElementById('geoSiteCount').textContent = DATA.meta.n_sites;
  document.getElementById('geoLoadedCount').textContent = DATA.meta.n_cells_with_geometry;
  const pct = DATA.meta.n_cells ? Math.min(100, 100*DATA.meta.n_cells_with_geometry/DATA.meta.n_cells) : 0;
  document.getElementById('geoProgressBar').innerHTML =
    `<div style="height:8px;background:var(--panel2);border-radius:4px;overflow:hidden;border:1px solid var(--line)">
       <div style="height:100%;width:${pct}%;background:var(--purple)"></div>
     </div>`;

  const cells = (DATA.geo && DATA.geo.cells) || [];
  if(!cells.length){
    document.getElementById('geoPlaceholderSection').classList.remove('hidden');
    document.getElementById('geoMapSection').classList.add('hidden');
    return;
  }
  document.getElementById('geoPlaceholderSection').classList.add('hidden');
  document.getElementById('geoMapSection').classList.remove('hidden');
  document.getElementById('geoMapScope').textContent = `${cells.length} cells across ${new Set(cells.map(c=>c.site_id)).size} sites`;

  geoInitMap(cells);
  _geoSitesData = geoGroupBySite(cells);

  _geoBandsPresent = GEO_RING_ORDER.filter(b=>cells.some(c=>c.band===b));
  _geoBandFilter = new Set(_geoBandsPresent);
  document.getElementById('geoBandToggles').innerHTML = _geoBandsPresent.map(b=>
    `<span class="geo-band-chip" data-band="${b}" onclick="geoToggleBand('${b}', this)"><span class="sw" style="background:${BAND_COLORS[b]}"></span>${b}</span>`
  ).join('');

  document.getElementById('geoModeToggles').innerHTML = GEO_MODES.map(m=>
    `<button class="geo-mode-btn${m.id==='band'?' active':''}" onclick="geoSetMode('${m.id}', this)">${esc(m.label)}</button>`
  ).join('');

  const dates = uniqueDates(DATA.major.lines.dl_volume_gb.dates);
  fillDateSelect(document.getElementById('geoFromDate'), dates, dates[0]);
  fillDateSelect(document.getElementById('geoToDate'), dates, dates[dates.length-1]);
  const debouncedLoad = debounce(geoLoadMetrics, 350);
  _geoHourSlider = buildHourSlider(document.getElementById('geoHourSlider'), 0, 23, debouncedLoad);
  document.getElementById('geoFromDate').onchange = document.getElementById('geoToDate').onchange = geoLoadMetrics;

  // The search box never changes what's rendered (see geoRenderMap) --
  // Enter just pans/zooms to the match, so there's nothing to redraw
  // per keystroke.
  document.getElementById('geoSiteSearch').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); geoSiteSearchGoTo(); }
  });
  geoWireMapInteractions();
  geoRenderMap();
  roadInit(dates);
  // If the Geo Analysis tab happens to already be the active one (e.g. a
  // future default change), size/fit the map now too -- otherwise this
  // happens on first tab click, see geoOnTabShown().
  if(document.getElementById('geo').classList.contains('active')) geoOnTabShown();
}

// Metrics only matter once a "Color by" mode other than Band is selected --
// fetched lazily on first use, then kept in sync with the Filters range.
function geoLoadMetrics(){
  const status = document.getElementById('geoMetricStatus');
  if(_geoMode==='band' && !_geoMetricsLoaded){
    status.textContent = 'Band view — no range needed.';
    return;
  }
  const fromDate = document.getElementById('geoFromDate').value;
  const toDate = document.getElementById('geoToDate').value;
  const lo = _geoHourSlider ? _geoHourSlider.lo : 0, hi = _geoHourSlider ? _geoHourSlider.hi : 23;
  status.textContent = `Loading ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00…`;
  const qs = new URLSearchParams({from_date: fromDate, to_date: toDate, from_hour: lo, to_hour: hi});
  fetch('/api/geo_congestion?'+qs.toString())
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      _geoMetrics = {};
      (data.rows||[]).forEach(r=>{ _geoMetrics[r.cell_name] = r; });
      _geoMetricsLoaded = true;
      status.textContent = `Averaged ${fmtDateDMY(fromDate)} → ${fmtDateDMY(toDate)}, ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 each day — ${(data.rows||[]).length} cells.`;
      geoRenderMap();
    })
    .catch(err=>{
      status.textContent = 'Failed to load: ' + err.message + ' — requires the server (uv run src/server.py).';
    });
}

function geoSetMode(mode, btnEl){
  _geoMode = mode;
  document.querySelectorAll('.geo-mode-btn').forEach(b=>b.classList.remove('active'));
  btnEl.classList.add('active');
  if(mode!=='band' && !_geoMetricsLoaded){ geoLoadMetrics(); return; }
  if(mode==='band'){ document.getElementById('geoMetricStatus').textContent = _geoMetricsLoaded ? document.getElementById('geoMetricStatus').textContent : 'Band view — no range needed.'; }
  geoRenderMap();
}

// =====================================================================
// GEO VIDEO ANALYSIS -- play + record an hour-by-hour time-lapse video,
// colored by a chosen metric (DL PRB Utilization / DL Thrpt Per User /
// Interference -- GEO_VIDEO_METRICS, reusing the live Geo Analysis map's
// own geoMetricColor()/geoModeBuckets() rather than separate logic). Two
// modes, chosen via gvSetMode (_geoVideoMode). Both cycle band-by-band
// (ROAD_BAND_ORDER), full day per band -- Whole Network is a per-carrier
// breakdown of the network, the same walkthrough style Road Analysis
// already used, not every band mixed into one frame:
//   - 'network' (Whole Network): every geometry-loaded cell, no drawing
//     needed. Wedges drawn narrower than normal (see
//     ROAD_VIDEO_WEDGE_HALF_ANGLE_NETWORK) -- at network cell density the
//     live map's normal fan width overlaps into solid blobs. No
//     congestion callouts (see 'road' below) -- too many cells for that
//     to stay a useful signal instead of noise.
//   - 'road' (Road Analysis): draw a route on the live Geo Analysis map
//     (reparented into this tab -- see gvMoveMapToSlot/gvMoveMapHome),
//     auto-select the cells near it, with a name callout whenever a cell
//     crosses into the worst bucket for the active metric.
// Function/variable names below keep their original "road" prefix from
// when this only had the one mode -- both modes share this same
// pipeline, renaming everything would just be busywork with no behavior
// change.
//
// Drawing happens on the LIVE Leaflet map (_geoMap) using only core
// Leaflet (L.Polyline/L.CircleMarker -- no drawing plugin, matching the
// rest of this app's hand-rolled-over-plugins style). Cell selection is
// entirely client-side against _geoSitesData (already loaded for the
// existing map, no server round-trip). Playback/export renders onto its
// own <canvas>, framed on whatever the LIVE map is currently panned/
// zoomed to at the moment Generate is clicked (_geoMap.getCenter()/
// getZoom()) -- no auto-fit guessing at a "correct" zoom, the user
// already has full manual zoom/pan control on that map and frames the
// road themselves before generating. Recording encodes canvas frames with
// the native WebCodecs VideoEncoder and muxes them into a real MP4 with
// the vendored mp4-muxer (falls back to captureStream()+MediaRecorder on
// browsers without WebCodecs AVC encoding) -- see the note above
// roadStartRecording() for why MediaRecorder's own MP4 output isn't
// enough on its own.
// =====================================================================
const ROAD_BAND_ORDER = ['L850','L900','L2100','L1800','L2600'];
const ROAD_TILE_SIZE = 256;
// The +/- preview buttons step by this much (see build_html.py's
// roadPreviewZoomBy(0.5)/(-0.5) calls) -- half an integer zoom level,
// gentler than a full level per click. Kept here just for reference; the
// HTML calls pass the literal value directly.
const ROAD_ZOOM_STEP = 0.5;
// How long a "just entered congestion" name callout stays on screen
// (real recorded milliseconds, independent of hour-step speed) before
// fading back out -- see the transition-detection in roadOpenModalAndPlay.
const ROAD_CALLOUT_MS = 1600;
// Whole Network packs far more wedges into one frame than a drawn road
// ever does -- at the live map's normal 26°-either-side fan width
// (GEO_WEDGE_HALF_ANGLE) those overlap into solid blobs at network
// density. A narrower fan keeps each sector visually distinct without
// touching the live map's own wedge width (Road Analysis keeps the
// normal width -- its cell counts are small enough that it isn't an
// issue there).
const ROAD_VIDEO_WEDGE_HALF_ANGLE_NETWORK = 12;
// Same reasoning, for how far each wedge reaches out from its site
// (Road Analysis's normal 16px radius, below): shorter at network
// density so neighboring sites' fans don't reach into each other and
// the whole network actually fits legibly on screen.
const ROAD_VIDEO_WEDGE_RADIUS_NETWORK = 10;
const ROAD_VIDEO_WEDGE_RADIUS = 16;

let _roadMode = false;
let _roadPoints = [];            // [[lat,lon], ...] vertices of the drawn route
let _roadLine = null;            // L.polyline of the route, live on _geoMap
let _roadVertexMarkers = [];     // L.circleMarker per vertex
let _roadHighlightMarkers = [];  // ring markers around selected sites
let _roadBufferM = 300;
let _roadSelectedCells = [];     // every cell (any band) whose OWN coordinates are within the buffer of the road
let _roadHourly = {};            // cell_name -> {hour(0-23): dl_thrp}
let _roadStepTimer = null;
let _roadRafId = null;
let _roadRecorder = null;
let _roadCancelPlayback = null;  // set while playing; call to stop the in-flight animation loop
// Preview-step state -- the user's own zoom/pan for the export, set with
// the +/- buttons and click-drag on the preview canvas (see
// roadOpenPreview/roadPreviewZoomBy/roadPreviewDragMove), independent of
// the live Geo Analysis map. World-pixel origin + integer zoom, in the
// same Web Mercator space roadLonLatToWorldPx produces.
let _roadPreviewZoom = 14;
let _roadPreviewOriginX = 0, _roadPreviewOriginY = 0;
let _roadPreviewTiles = [];
let _roadPreviewDate = null;
let _roadPreviewWired = false;   // drag listeners attached once, reused across opens
let _roadDragging = false;
let _roadDragStart = null;       // {x,y} in canvas-internal pixels
let _roadDragOrigin = null;      // {x,y} originX/Y at drag start

// Geo Video Analysis mode + metric -- 'network' needs no drawing (every
// cell, all bands together, one pass through the day); 'road' is the
// original Road Analysis flow, now with the same metric choice. Metric
// ids map directly onto the LIVE map's own geoMetricColor()/
// geoModeBuckets() modes ('dlprb'|'dlthrp'|'interference'), reused as-is
// -- see roadDrawFrame.
let _geoVideoMode = 'network';
let _geoVideoMetric = 'dlthrp';
const GEO_VIDEO_METRICS = [
  {id:'dlprb', label:'DL PRB Utilization'},
  {id:'dlthrp', label:'DL Thrpt Per User (Mbps)'},
  {id:'interference', label:'Interference'},
];

function roadInit(dates){
  fillDateSelect(document.getElementById('roadDate'), dates, dates[dates.length-1]);
  _roadBufferM = parseInt(document.getElementById('roadBufferSlider').value, 10);

  document.getElementById('gvModeToggles').innerHTML =
    `<button class="geo-mode-btn active" onclick="gvSetMode('network', this)">Whole Network</button>
     <button class="geo-mode-btn" onclick="gvSetMode('road', this)">Road Analysis</button>`;
  document.getElementById('gvMetricToggles').innerHTML = GEO_VIDEO_METRICS.map(m=>
    `<button class="geo-mode-btn${m.id===_geoVideoMetric?' active':''}" onclick="gvSetMetric('${m.id}', this)">${esc(m.label)}</button>`
  ).join('');
  gvSetMode('network');
}

// Metric choice -- both modes share it (see GEO_VIDEO_METRICS). Only
// takes effect on the next Generate; doesn't touch anything already on
// screen.
function gvSetMetric(id, btnEl){
  _geoVideoMetric = id;
  document.querySelectorAll('#gvMetricToggles .geo-mode-btn').forEach(b=>b.classList.remove('active'));
  if(btnEl) btnEl.classList.add('active');
}

// Mode toggle -- shows/hides the mode-specific controls, and moves the
// LIVE Geo Analysis map (#geoMapWrap) into this tab's own slot for Road
// Analysis (needed to draw on) or back to its home in the Geo Analysis
// tab for Whole Network (needs no map here at all). Reuses the exact
// same reparent-the-live-Leaflet-instance trick geoOpenMapModal()/
// geoCloseMapModal() already use for "bigger display", including their
// shared _geoMapWrapHome bookkeeping -- see gvMoveMapToSlot/gvMoveMapHome.
function gvSetMode(mode, btnEl){
  _geoVideoMode = mode;
  const btns = document.querySelectorAll('#gvModeToggles .geo-mode-btn');
  btns.forEach(b=>b.classList.remove('active'));
  (btnEl || btns[mode==='network'?0:1])?.classList.add('active');
  // Metric choice (gvMetricRow) applies to BOTH modes now -- always
  // visible, not gated by mode.
  document.getElementById('gvRoadStatusRow').classList.toggle('hidden', mode!=='road');
  document.getElementById('gvRoadHintRow').classList.toggle('hidden', mode!=='road');
  document.getElementById('gvRoadControlsRow').classList.toggle('hidden', mode!=='road');
  document.getElementById('gvMapSlot').classList.toggle('hidden', mode!=='road');
  if(mode==='road'){
    gvMoveMapToSlot();
    roadClear(); // fresh slate every time Road Analysis is (re)selected
  } else {
    gvMoveMapHome();
    document.getElementById('roadGenerateBtn').disabled = false;
  }
}
function gvMoveMapToSlot(){
  const wrap = document.getElementById('geoMapWrap');
  const slot = document.getElementById('gvMapSlot');
  if(!wrap || !slot || _geoMapWrapHome) return; // already away (here, or in the fullscreen modal)
  _geoMapWrapHome = {parent: wrap.parentNode, next: wrap.nextSibling};
  slot.appendChild(wrap);
}
function gvMoveMapHome(){
  const wrap = document.getElementById('geoMapWrap');
  const slot = document.getElementById('gvMapSlot');
  if(!wrap || !_geoMapWrapHome || wrap.parentNode!==slot) return; // not ours to move (e.g. sitting in the fullscreen modal instead)
  const {parent, next} = _geoMapWrapHome;
  _geoMapWrapHome = null;
  if(next) parent.insertBefore(wrap, next); else parent.appendChild(wrap);
}
// Re-applies the current mode's map placement whenever this tab becomes
// active again (e.g. the map was sent home while the user was on a
// different tab -- see the .tab click handler).
function gvOnTabShown(){
  if(_geoVideoMode==='road') gvMoveMapToSlot();
}

function roadToggleDraw(){
  if(!_geoMap) return;
  const btn = document.getElementById('roadDrawBtn');
  if(!_roadMode){
    roadClear(); // start every new drawing fresh
    _roadMode = true;
    btn.textContent = '✓ Finish Road';
    btn.style.borderColor = '#3b82f6'; btn.style.color = '#3b82f6';
    _geoMap.getContainer().style.cursor = 'crosshair';
    document.getElementById('roadStatus').textContent = 'Click points along the road on the map, then click "Finish Road".';
    _geoMap.on('click', roadMapClick);
  } else {
    _roadMode = false;
    btn.textContent = '✎ Draw Road';
    btn.style.borderColor = ''; btn.style.color = '';
    _geoMap.getContainer().style.cursor = '';
    _geoMap.off('click', roadMapClick);
    if(_roadPoints.length < 2){
      document.getElementById('roadStatus').textContent = 'Draw at least 2 points to define a road.';
      document.getElementById('roadGenerateBtn').disabled = true;
    } else {
      roadComputeSelection();
    }
  }
}

function roadMapClick(e){
  _roadPoints.push([e.latlng.lat, e.latlng.lng]);
  roadRedrawRoute();
}

function roadRedrawRoute(){
  if(_roadLine){ _geoMap.removeLayer(_roadLine); _roadLine = null; }
  _roadVertexMarkers.forEach(m=>_geoMap.removeLayer(m));
  _roadVertexMarkers = [];
  if(!_roadPoints.length) return;
  _roadLine = L.polyline(_roadPoints, {color:'#3b82f6', weight:3, dashArray:'6,4'}).addTo(_geoMap);
  _roadPoints.forEach(p=>{
    _roadVertexMarkers.push(L.circleMarker(p, {radius:5, color:'#3b82f6', weight:2, fillColor:'#0e1117', fillOpacity:1}).addTo(_geoMap));
  });
}

function roadClearSelectionHighlight(){
  _roadHighlightMarkers.forEach(m=>_geoMap.removeLayer(m));
  _roadHighlightMarkers = [];
}

function roadClear(){
  _roadMode = false;
  const btn = document.getElementById('roadDrawBtn');
  btn.textContent = '✎ Draw Road';
  btn.style.borderColor = ''; btn.style.color = '';
  if(_geoMap){ _geoMap.getContainer().style.cursor = ''; _geoMap.off('click', roadMapClick); }
  _roadPoints = [];
  if(_roadLine){ _geoMap.removeLayer(_roadLine); _roadLine = null; }
  _roadVertexMarkers.forEach(m=>_geoMap.removeLayer(m));
  _roadVertexMarkers = [];
  roadClearSelectionHighlight();
  _roadSelectedCells = [];
  document.getElementById('roadGenerateBtn').disabled = true;
  document.getElementById('roadStatus').textContent = 'Click "Draw Road", then click points along a road on the map. Click again to finish.';
}

function roadBufferChanged(){
  _roadBufferM = parseInt(document.getElementById('roadBufferSlider').value, 10);
  document.getElementById('roadBufferLabel').textContent = _roadBufferM + ' m';
  if(_roadPoints.length >= 2) roadComputeSelection();
}

// Equirectangular approximation (fine at city scale) -- projects lat/lon
// to local meters around a shared reference latitude, just for distance
// math and for the export canvas's own self-contained layout.
function roadProjectXY(lat, lon, refLat){
  const R = 6371000;
  return [R * (lon*Math.PI/180) * Math.cos(refLat*Math.PI/180), R * (lat*Math.PI/180)];
}
function roadPointSegDist(px,py, ax,ay, bx,by){
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  let t = len2>0 ? ((px-ax)*dx+(py-ay)*dy)/len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}
function roadDistanceToRoute(lat, lon, refLat, routeXY){
  const [px,py] = roadProjectXY(lat, lon, refLat);
  let min = Infinity;
  for(let i=0;i<routeXY.length-1;i++){
    min = Math.min(min, roadPointSegDist(px,py, routeXY[i][0],routeXY[i][1], routeXY[i+1][0],routeXY[i+1][1]));
  }
  return min;
}

// Selection filters by each CELL's own coordinates, not a per-site
// stand-in. It used to pick the site once (via one representative
// cell's lat/lon) and then keep every cell at that site regardless of
// band -- but different bands at nominally "the same site" can genuinely
// sit hundreds of meters to several km apart (confirmed against real
// geometry data, e.g. one Islamabad site whose L2100 carriers are ~300m
// and ~7.8km from its L1800/L900/L850 cells respectively, not a data
// error). That meant a site could get pulled in by an L1800 cell near
// the road while dragging in an L2100 cell that was nowhere near it, or
// exclude an L2100 cell that WAS near the road because the site's
// representative cell happened not to be. Filtering per cell means
// "selected" always means that specific cell is actually within the
// buffer, for every band, independent of what its site's other cells
// are doing.
function roadComputeSelection(){
  const refLat = _roadPoints.reduce((s,p)=>s+p[0],0)/_roadPoints.length;
  const routeXY = _roadPoints.map(p=>roadProjectXY(p[0],p[1],refLat));
  const allCells = _geoSitesData.flatMap(s=>s.cells);
  _roadSelectedCells = allCells.filter(c=>roadDistanceToRoute(c.latitude, c.longitude, refLat, routeXY) <= _roadBufferM);
  roadClearSelectionHighlight();
  // One highlight ring per unique location among the selected cells
  // (not per site) -- a partially-selected site now shows a ring only
  // where it actually has a selected cell, and a site whose bands split
  // across two real locations (like the Faizabad case above) gets two
  // rings, honestly reflecting that they're not the same spot.
  const seenLoc = new Set();
  _roadSelectedCells.forEach(c=>{
    const key = c.latitude.toFixed(5)+','+c.longitude.toFixed(5);
    if(seenLoc.has(key)) return;
    seenLoc.add(key);
    _roadHighlightMarkers.push(L.circleMarker([c.latitude,c.longitude], {radius:9, color:'#10b981', weight:2, fillOpacity:0, interactive:false}).addTo(_geoMap));
  });
  const nSites = new Set(_roadSelectedCells.map(c=>c.site_id)).size;
  const counts = {};
  _roadSelectedCells.forEach(c=>{ counts[c.band] = (counts[c.band]||0)+1; });
  const summary = ROAD_BAND_ORDER.filter(b=>counts[b]).map(b=>`${b}: ${counts[b]}`).join(', ');
  document.getElementById('roadStatus').textContent = _roadSelectedCells.length
    ? `${nSites} site(s), ${_roadSelectedCells.length} cell(s) within ${_roadBufferM} m of the road — ${summary}.`
    : `No cells within ${_roadBufferM} m of this road — try a wider buffer.`;
  document.getElementById('roadGenerateBtn').disabled = _roadSelectedCells.length===0;
}

// Fetches the hourly data for whichever mode is active, then opens the
// preview. Road Analysis: the drawn selection's cells via /api/road_hourly
// (needs cell names -- tens, fits fine in a URL). Whole Network: every
// cell via /api/network_hourly (no cell filter -- ~10,000 names couldn't
// reasonably go through a URL anyway, and "whole network" means all of
// them regardless). Both endpoints return the same {dl_prb_util, dl_thrp,
// ul_interference} shape per hour, so _roadHourly ends up identically
// shaped either way -- everything downstream (preview draw, recording,
// roadDrawFrame) doesn't need to know which mode produced it.
function roadGenerate(){
  const network = _geoVideoMode==='network';
  if(!network && !_roadSelectedCells.length) return;
  if(typeof HTMLCanvasElement.prototype.captureStream !== 'function' || typeof MediaRecorder === 'undefined'){
    const msg = 'Video export needs a browser with MediaRecorder support (Chrome, Edge, or Firefox).';
    if(!network) document.getElementById('roadStatus').textContent = msg;
    return;
  }
  const date = document.getElementById('roadDate').value;
  const btn = document.getElementById('roadGenerateBtn');
  btn.disabled = true;
  const setStatus = msg=>{ if(!network) document.getElementById('roadStatus').textContent = msg; };
  setStatus('Loading hourly data…');

  const req = network
    ? fetch('/api/network_hourly?'+new URLSearchParams({date}))
    : fetch('/api/road_hourly?'+new URLSearchParams({date, cells: _roadSelectedCells.map(c=>c.cell_name).join(',')}));

  req.then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
      return data;
    })
    .then(data=>{
      if(network){
        _roadSelectedCells = _geoSitesData.flatMap(s=>s.cells); // every geometry-loaded cell, all bands
        _roadHourly = data.cells || {}; // already grouped {cell_name: {hour: {...}}} server-side
        const n = Object.keys(_roadHourly).length;
        setStatus(`Loaded hourly data for ${n} cell(s).`);
      } else {
        _roadHourly = {};
        (data.rows||[]).forEach(r=>{
          const hr = parseInt(String(r.time).slice(0,2), 10);
          if(!_roadHourly[r.cell_name]) _roadHourly[r.cell_name] = {};
          _roadHourly[r.cell_name][hr] = {dl_prb_util:r.dl_prb_util, dl_thrp:r.dl_thrp, ul_interference:r.ul_interference};
        });
        setStatus(`Loaded ${(data.rows||[]).length} hourly reading(s) — adjust the preview, then start recording.`);
      }
      btn.disabled = false;
      roadOpenPreview(date);
    })
    .catch(err=>{
      setStatus('Failed to load: ' + err.message + ' — requires the server (uv run src/server.py).');
      btn.disabled = false;
    });
}

function roadCloseModal(){
  document.getElementById('roadModal').classList.add('hidden');
  if(_roadCancelPlayback){ _roadCancelPlayback(); _roadCancelPlayback = null; }
  if(_roadStepTimer){ clearTimeout(_roadStepTimer); _roadStepTimer = null; }
  if(_roadRafId){ clearInterval(_roadRafId); _roadRafId = null; }
  if(_roadRecorder && _roadRecorder.state === 'recording') _roadRecorder.stop();
  _roadDragging = false;
}

// "Enlarge" toggle -- widens the modal AND grows the canvas's own
// internal resolution by the same factor (ROAD_ENLARGE_SCALE), rather
// than just stretching a fixed-resolution image bigger via CSS. That
// distinction is what makes it "only the map gets bigger": the title
// bar/legend/progress bar are drawn at FIXED pixel sizes regardless of
// canvas size (see roadDrawFrame's ctx.font calls), so when the canvas's
// pixel budget grows, that fixed-size chrome ends up occupying a
// SMALLER share of the frame while the map area gets proportionally
// more room AND more real tile/wedge detail -- not just a blurrier
// stretch of the same raster, which is what plain CSS scaling alone
// produced (and made the title text look oversized along with
// everything else).
// Only done while still in the PREVIEW step (Start Recording button
// still visible) -- resizing the canvas mid-recording could disrupt
// MediaRecorder's capture of it, so once recording has started/finished
// this falls back to a plain CSS resize of the modal (canvas still
// grows via its own width:100%, just without the resolution bump).
const ROAD_CANVAS_BASE_W = 1000, ROAD_CANVAS_BASE_H = 680;
const ROAD_ENLARGE_SCALE = 1.4;
let _roadEnlarged = false;
function roadToggleEnlarge(){
  _roadEnlarged = !_roadEnlarged;
  const content = document.getElementById('roadModalContent');
  const btn = document.getElementById('roadEnlargeBtn');
  content.style.width = _roadEnlarged ? '97vw' : 'min(1040px,94vw)';
  content.style.maxHeight = _roadEnlarged ? '96vh' : '';
  btn.title = _roadEnlarged ? 'Shrink' : 'Enlarge';
  const inPreview = !document.getElementById('roadStartBtn').classList.contains('hidden');
  if(inPreview){
    roadResizeCanvasForEnlarge();
    roadPreviewReload();
  }
}
// Applies the current _roadEnlarged state to the canvas's own internal
// resolution (see roadToggleEnlarge). Also called when a fresh preview
// opens, so the canvas matches whatever enlarge state was left on from
// a previous run.
function roadResizeCanvasForEnlarge(){
  const canvas = document.getElementById('roadCanvas');
  const scale = _roadEnlarged ? ROAD_ENLARGE_SCALE : 1;
  canvas.width = Math.round(ROAD_CANVAS_BASE_W*scale);
  canvas.height = Math.round(ROAD_CANVAS_BASE_H*scale);
}

// Standard Web Mercator lon/lat -> WORLD pixel coords at a given zoom
// (same projection every XYZ slippy-map tile provider, OSM included,
// uses -- matches Leaflet's own project()). World pixel space is what
// lets tile images and cell/route positions line up exactly.
function roadLonLatToWorldPx(lon, lat, zoom){
  const scale = ROAD_TILE_SIZE * Math.pow(2, zoom);
  const siny = Math.min(Math.max(Math.sin(lat*Math.PI/180), -0.9999), 0.9999);
  return [(0.5 + lon/360) * scale, (0.5 - Math.log((1+siny)/(1-siny)) / (4*Math.PI)) * scale];
}
// Loads one OSM tile through OUR OWN /api/tile proxy (same-origin, so the
// canvas it's drawn onto stays readable by captureStream/MediaRecorder --
// see the comment on that route in server.py). Resolves to null on any
// failure rather than rejecting, so one missing tile can't abort the
// whole export -- that spot just shows the plain background instead.
function roadLoadTileImage(z,tx,ty){
  const n = Math.pow(2,z);
  const xw = ((tx % n) + n) % n;
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = `/api/tile/${z}/${xw}/${ty}.png`;
  });
}
// `zoom` (the display/preview zoom) can be fractional -- the +/- buttons
// step by ROAD_ZOOM_STEP (0.5, gentler than a full zoom level per click,
// see roadPreviewZoomBy) so the map doesn't jump drastically on one
// click. Real XYZ tiles only exist at INTEGER zooms, so tiles are always
// FETCHED at Math.round(zoom) but tagged with that tile zoom; the
// drawing side (roadDrawFrame) scales each tile by 2^(displayZoom -
// tileZoom) to land correctly at the fractional display zoom -- same
// trick Leaflet itself uses mid zoom-animation.
async function roadLoadTiles(zoom, minWorldX, maxWorldX, minWorldY, maxWorldY){
  const tileZoom = Math.round(zoom);
  const toTileWorld = Math.pow(2, tileZoom-zoom); // display-zoom world-px -> tile-zoom world-px
  const tx0=Math.floor(minWorldX*toTileWorld/ROAD_TILE_SIZE), tx1=Math.floor(maxWorldX*toTileWorld/ROAD_TILE_SIZE);
  const ty0=Math.floor(minWorldY*toTileWorld/ROAD_TILE_SIZE), ty1=Math.floor(maxWorldY*toTileWorld/ROAD_TILE_SIZE);
  const jobs = [];
  for(let tx=tx0; tx<=tx1; tx++){
    for(let ty=ty0; ty<=ty1; ty++){
      jobs.push(roadLoadTileImage(tileZoom,tx,ty).then(img=>({tx,ty,img,tileZoom})));
    }
  }
  return Promise.all(jobs);
}

// Canvas dimensions/margins shared by the preview step and the actual
// recording -- both draw through the exact same roadDrawFrame(), just at
// different times, so what you see in the preview is exactly what ends
// up in the video.
const ROAD_PAD_TOP=90, ROAD_PAD_BOT=40, ROAD_PAD_SIDE=60;

// Builds the {toPx, originX, originY, zoom} projection for the CURRENT
// preview state (_roadPreviewZoom/OriginX/OriginY) -- used by both the
// live preview redraw and (once locked in) the actual recording.
function roadPreviewProjection(){
  const canvas = document.getElementById('roadCanvas');
  const zoom = _roadPreviewZoom, originX = _roadPreviewOriginX, originY = _roadPreviewOriginY;
  const toPx = (lat,lon)=>{
    const [wx,wy] = roadLonLatToWorldPx(lon, lat, zoom);
    return [ROAD_PAD_SIDE + (wx-originX), ROAD_PAD_TOP + (wy-originY)];
  };
  return {ctx: canvas.getContext('2d'), W: canvas.width, H: canvas.height, originX, originY, padSide:ROAD_PAD_SIDE, padTop:ROAD_PAD_TOP, zoom, toPx};
}

// Opens the modal into the PREVIEW step: a single static frame (first
// band, hour 0) that the user can zoom/pan with the controls on top of
// the canvas, independent of the live Geo Analysis map. Initial framing
// is seeded from whatever the live map currently shows (a reasonable
// starting point), but from here on the user adjusts it directly on
// THIS canvas -- see roadPreviewZoomBy / the drag handlers wired below.
async function roadOpenPreview(date){
  _roadPreviewDate = date;
  document.getElementById('roadModalTitle').textContent = fmtDateDMY(date);
  document.getElementById('roadDownloadBtn').classList.add('hidden');
  document.getElementById('roadPreviewControls').classList.remove('hidden');
  document.getElementById('roadStartBtn').classList.remove('hidden');
  document.getElementById('roadPlaybackStatus').textContent = 'Loading preview…';
  document.getElementById('roadModal').classList.remove('hidden');

  roadResizeCanvasForEnlarge(); // match whatever _roadEnlarged was left on from a previous run
  const canvas = document.getElementById('roadCanvas');
  const availW = canvas.width-2*ROAD_PAD_SIDE, availH = canvas.height-ROAD_PAD_TOP-ROAD_PAD_BOT;
  _roadPreviewZoom = Math.round(_geoMap.getZoom());
  const [cx, cy] = roadLonLatToWorldPx(_geoMap.getCenter().lng, _geoMap.getCenter().lat, _roadPreviewZoom);
  _roadPreviewOriginX = cx - availW/2;
  _roadPreviewOriginY = cy - availH/2;

  roadWirePreviewDrag();
  await roadPreviewReload();
}

// Re-fetches tiles for whatever the preview is currently framing, then
// redraws. Called on open, on every zoom step, and once at the end of a
// drag (drag itself just redraws with the tiles already in hand -- see
// roadPreviewDragMove -- so panning stays instant, no re-fetch per pixel).
async function roadPreviewReload(){
  document.getElementById('roadPlaybackStatus').textContent = 'Loading map tiles…';
  const canvas = document.getElementById('roadCanvas');
  const availW = canvas.width-2*ROAD_PAD_SIDE, availH = canvas.height-ROAD_PAD_TOP-ROAD_PAD_BOT;
  _roadPreviewTiles = await roadLoadTiles(_roadPreviewZoom, _roadPreviewOriginX, _roadPreviewOriginX+availW, _roadPreviewOriginY, _roadPreviewOriginY+availH);
  const loaded = _roadPreviewTiles.filter(t=>t.img).length;
  document.getElementById('roadPlaybackStatus').textContent = loaded
    ? 'Adjust zoom/pan on the preview above, then Start Recording.'
    : 'Map imagery unavailable (could not reach OpenStreetMap) — continuing without a basemap.';
  roadPreviewDraw();
}

// Draws ONE static frame (first present band, hour 0, no callouts) at
// the current preview framing -- reuses the exact same roadDrawFrame()
// the real recording uses, so the preview is a true WYSIWYG of the video.
function roadPreviewDraw(){
  const proj = roadPreviewProjection();
  proj.tiles = _roadPreviewTiles;
  proj.date = _roadPreviewDate;
  proj.metric = _geoVideoMetric;
  proj.network = _geoVideoMode==='network';
  proj.routePx = _roadPoints.map(p=>proj.toPx(p[0],p[1]));
  // Both modes preview the first present band -- matches the first frame
  // the actual recording will show, since Whole Network now cycles
  // band-by-band the same way Road Analysis does (a per-carrier
  // breakdown of the network, not every band mixed into one frame).
  const band = ROAD_BAND_ORDER.find(b=>_roadSelectedCells.some(c=>c.band===b));
  const cells = band ? _roadSelectedCells.filter(c=>c.band===band) : [];
  roadDrawFrame(proj, band, 0, cells, [], performance.now());
}

// Zoom step around the CURRENT CENTER of the preview -- pure pixel-space
// math (world-px scales by exactly 2^delta per zoom level in Web
// Mercator), no lat/lon round-trip needed. delta is ROAD_ZOOM_STEP
// (0.5) from the +/- buttons -- a full integer zoom level per click
// roughly doubles/halves the visible area, which read as a jarring jump;
// half a level is a gentler, more controllable step. Tiles still load
// fine at a fractional zoom -- see roadLoadTiles.
function roadPreviewZoomBy(delta){
  const canvas = document.getElementById('roadCanvas');
  const availW = canvas.width-2*ROAD_PAD_SIDE, availH = canvas.height-ROAD_PAD_TOP-ROAD_PAD_BOT;
  const newZoom = Math.round((Math.max(3, Math.min(19, _roadPreviewZoom+delta)))*2)/2; // snap to the nearest 0.5 step
  if(newZoom===_roadPreviewZoom) return;
  const factor = Math.pow(2, newZoom-_roadPreviewZoom);
  const centerX = _roadPreviewOriginX+availW/2, centerY = _roadPreviewOriginY+availH/2;
  _roadPreviewZoom = newZoom;
  _roadPreviewOriginX = centerX*factor - availW/2;
  _roadPreviewOriginY = centerY*factor - availH/2;
  roadPreviewReload();
}

// Click-drag-to-pan on the preview canvas -- wired once (guarded by
// _roadPreviewWired) since the canvas element is reused across opens.
// Dragging just shifts the origin and redraws with whatever tiles are
// already loaded (instant, no fetch); a fresh roadPreviewReload() only
// fires on mouseup, matching how Leaflet itself defers loading new tiles
// until a pan gesture ends.
function roadWirePreviewDrag(){
  if(_roadPreviewWired) return;
  _roadPreviewWired = true;
  const canvas = document.getElementById('roadCanvas');
  const toCanvasPx = (clientDx, clientDy)=>{
    const rect = canvas.getBoundingClientRect();
    const s = canvas.width / rect.width; // canvas internal res vs its CSS-scaled display size
    return [clientDx*s, clientDy*s];
  };
  canvas.addEventListener('mousedown', e=>{
    _roadDragging = true;
    _roadDragStart = {x:e.clientX, y:e.clientY};
    _roadDragOrigin = {x:_roadPreviewOriginX, y:_roadPreviewOriginY};
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e=>{
    if(!_roadDragging) return;
    const [dx,dy] = toCanvasPx(e.clientX-_roadDragStart.x, e.clientY-_roadDragStart.y);
    _roadPreviewOriginX = _roadDragOrigin.x - dx;
    _roadPreviewOriginY = _roadDragOrigin.y - dy;
    roadPreviewDraw();
  });
  window.addEventListener('mouseup', ()=>{
    if(!_roadDragging) return;
    _roadDragging = false;
    canvas.style.cursor = 'grab';
    roadPreviewReload();
  });
}

// Picks the first AVC (H.264) codec string this browser's WebCodecs
// VideoEncoder can actually encode at this frame size, preferring
// higher profile/level (headroom for the Enlarge button's bigger canvas)
// and falling back toward Baseline/L3.1. Returns null if this browser
// can't encode AVC via WebCodecs at all (the MediaRecorder path below
// then takes over).
const AVC_CODEC_CANDIDATES = ['avc1.640033', 'avc1.4d0033', 'avc1.42001f'];
async function roadPickAvcCodec(width, height, framerate){
  for(const codec of AVC_CODEC_CANDIDATES){
    try{
      const support = await VideoEncoder.isConfigSupported({codec, width, height, bitrate: 8_000_000, framerate});
      if(support && support.supported) return codec;
    }catch(e){ /* try the next candidate */ }
  }
  return null;
}

// Locks in the preview's current zoom/pan and runs the actual capture --
// same frame sequence as before, just framed by the user's own preview
// adjustments instead of an auto-fit guess.
async function roadStartRecording(){
  document.getElementById('roadPreviewControls').classList.add('hidden');
  document.getElementById('roadStartBtn').classList.add('hidden');
  document.getElementById('roadPlaybackStatus').textContent = 'Recording…';

  const date = _roadPreviewDate;
  const canvas = document.getElementById('roadCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const {originX, originY, padSide, padTop, toPx, zoom} = roadPreviewProjection();
  const tiles = _roadPreviewTiles; // already loaded/current for this exact framing

  const routePx = _roadPoints.map(p=>toPx(p[0],p[1]));
  const network = _geoVideoMode==='network';
  // Both modes cycle band-by-band, full day per band -- Whole Network is
  // a per-carrier breakdown of the network (same walkthrough style as
  // Road Analysis), not every band mixed into one frame.
  const cellsByBand = {};
  ROAD_BAND_ORDER.forEach(b=>{ cellsByBand[b] = _roadSelectedCells.filter(c=>c.band===b); });
  const bandsPresent = ROAD_BAND_ORDER.filter(b=>cellsByBand[b].length>0);
  const frames = [];
  bandsPresent.forEach(band=>{ for(let h=0; h<24; h++) frames.push({band, hour:h}); });

  const speedMs = parseInt(document.getElementById('roadSpeed').value, 10);
  // setInterval, not requestAnimationFrame -- rAF is throttled to
  // near-zero by the browser the moment this tab is backgrounded (the
  // user alt-tabs away while a time-lapse generates, which is a normal
  // thing to do), silently stalling the whole recording. Timers keep
  // running at a background tab's normal rate for a good while, so the
  // export actually finishes even when this tab isn't the active one.
  const ROAD_REDRAW_MS = 50; // ~20fps -- smooth enough for the callout fade,
  // and also the rate frames are actually captured into the video below.
  const ENCODE_FPS = 1000 / ROAD_REDRAW_MS;

  // Prefer encoding straight to a real, non-fragmented MP4 via WebCodecs +
  // mp4-muxer. Chrome's MediaRecorder CAN record to video/mp4, but it only
  // ever produces a fragmented MP4 (moof/mdat pairs, an empty leading
  // moov) -- spec-valid and fine in a browser or VLC, but exactly the
  // shape WhatsApp's and most phones' native players reject outright
  // ("something is wrong with the video file"), which is why the earlier
  // MediaRecorder-MP4 fix didn't actually solve phone playback. Muxing
  // ourselves with fastStart:'in-memory' writes one full sample table into
  // a single moov up front -- a normal flat MP4 that plays everywhere.
  // captureStream()+MediaRecorder (WebM, or MP4 if it happens to work) is
  // kept only as a fallback for browsers without WebCodecs AVC encoding.
  let encoder = null, mux = null, encodeFrameIndex = 0;
  let fileExt = 'webm', deliverMime = 'video/webm';
  if(typeof VideoEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined'){
    const codec = await roadPickAvcCodec(W, H, ENCODE_FPS);
    if(codec){
      mux = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: {codec: 'avc', width: W, height: H},
        fastStart: 'in-memory',
      });
      encoder = new VideoEncoder({
        output: (chunk, meta)=>mux.addVideoChunk(chunk, meta),
        error: e=>console.error('VideoEncoder error', e),
      });
      encoder.configure({codec, width: W, height: H, bitrate: 8_000_000, framerate: ENCODE_FPS, avc: {format: 'avc'}});
      fileExt = 'mp4'; deliverMime = 'video/mp4';
    }
  }

  let recorder = null, chunks = null, mime = null;
  if(!encoder){
    const stream = canvas.captureStream(ENCODE_FPS);
    const ROAD_MIME_CANDIDATES = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    mime = ROAD_MIME_CANDIDATES.find(m=>MediaRecorder.isTypeSupported(m)) || 'video/webm';
    fileExt = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    deliverMime = mime;
    recorder = new MediaRecorder(stream, {mimeType: mime});
    chunks = [];
    recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
  }

  const deliver = blob=>{
    const url = URL.createObjectURL(blob);
    const dlBtn = document.getElementById('roadDownloadBtn');
    dlBtn.classList.remove('hidden');
    dlBtn.textContent = `⌟ Download video (.${fileExt})`;
    dlBtn.onclick = ()=>{
      const a = document.createElement('a');
      a.href = url; a.download = `${network?'NetworkTimeLapse':'RoadTimeLapse'}_${date}.${fileExt}`;
      document.body.appendChild(a); a.click(); a.remove();
    };
    document.getElementById('roadPlaybackStatus').textContent =
      `Done — ${frames.length} frame(s) across ${bandsPresent.length} band(s). Ready to download.`;
  };

  let finished = false;
  const finish = async ()=>{
    if(finished) return;
    finished = true;
    if(encoder){
      await encoder.flush();
      encoder.close(); // release the codec now rather than leaving it idle for
                        // the browser to reclaim later (harmless, but reclaim
                        // logs a console error after we're already done with it)
      mux.finalize();
      deliver(new Blob([mux.target.buffer], {type: deliverMime}));
    } else {
      recorder.onstop = ()=>deliver(new Blob(chunks, {type: mime}));
      recorder.stop();
    }
  };
  // Unified stop()/state handle -- roadCloseModal()'s cancel path calls
  // _roadRecorder.stop() without needing to know which pipeline is active.
  _roadRecorder = {get state(){ return finished ? 'inactive' : 'recording'; }, stop: finish};
  if(recorder) recorder.start();

  const dc = {ctx, W, H, tiles, originX, originY, padSide, padTop, routePx, toPx, date, zoom, metric:_geoVideoMetric, network};
  // "Worst" bucket for the ACTIVE metric -- geoModeBuckets() already
  // orders every mode's buckets index0=best...last=worst uniformly, so
  // this works the same for PRB/throughput/interference without
  // metric-specific branching.
  const worstColor = geoModeBuckets(_geoVideoMetric).slice(-1)[0].color;
  let prevBucket = {};    // cell_name -> bucket color as of the previous hour, reset each new band
  let callouts = [];      // {name, x, y, start} -- cells that just crossed into congestion
  let cancelled = false;
  _roadCancelPlayback = ()=>{ cancelled = true; };

  let i = 0, lastBand = null;
  function nextHour(){
    if(cancelled) return;
    if(i >= frames.length){
      _roadStepTimer = setTimeout(()=>{ if(!cancelled) finish(); }, 500);
      return;
    }
    const f = frames[i];
    if(f.band !== lastBand){ lastBand = f.band; prevBucket = {}; callouts = []; }
    const cells = cellsByBand[f.band];
    // Congestion callouts are Road Analysis only -- at whole-network
    // scale a single bad hour could trigger dozens of these at once,
    // just noise rather than a useful signal. A callout fires once, at
    // the moment a cell crosses INTO the worst bucket for the active
    // metric (wasn't there the hour before) -- not every hour it stays
    // bad, which would just be a permanent wall of labels.
    if(!network){
      cells.forEach(c=>{
        const metric = _roadHourly[c.cell_name] ? _roadHourly[c.cell_name][f.hour] : undefined;
        const col = geoMetricColor(_geoVideoMetric, metric);
        if(col===worstColor && prevBucket[c.cell_name]!==worstColor){
          const [x,y] = toPx(c.latitude, c.longitude);
          callouts.push({name:c.cell_name, x, y, start:performance.now()});
        }
        prevBucket[c.cell_name] = col;
      });
    }
    document.getElementById('roadPlaybackStatus').textContent =
      `Recording ${f.band} — ${String(f.hour).padStart(2,'0')}:00 (frame ${i+1}/${frames.length})…`;
    i++;
    // Hold a beat longer on each band's opening frame so the band change
    // actually reads before hours start ticking past.
    const holdMs = f.hour===0 ? speedMs*3 : speedMs;
    const holdStart = performance.now();
    _roadRafId = setInterval(()=>{
      if(cancelled){ clearInterval(_roadRafId); return; }
      const now = performance.now();
      callouts = callouts.filter(c => now-c.start < ROAD_CALLOUT_MS);
      roadDrawFrame(dc, f.band, f.hour, cells, callouts, now);
      if(encoder){
        const vf = new VideoFrame(canvas, {timestamp: Math.round(encodeFrameIndex * (1e6/ENCODE_FPS))});
        encoder.encode(vf);
        vf.close();
        encodeFrameIndex++;
      }
      if(now-holdStart >= holdMs){ clearInterval(_roadRafId); _roadRafId = null; nextHour(); }
    }, ROAD_REDRAW_MS);
  }
  nextHour();
}

// Undoes the small set of HTML entities the live map's GEO_*_RANGES/
// geoModeBuckets() labels are written in (they're normally dropped
// straight into innerHTML, but canvas fillText wants plain text).
function roadDecodeLabel(html){
  return html.replace(/&ge;/g,'≥').replace(/&le;/g,'≤').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—');
}

// One frame: the real OSM basemap (tiles pre-loaded by roadPreviewReload,
// so drawing them here is just drawImage -- no per-frame fetching), a
// title bar (band + metric + date + hour), the active metric's range
// legend (geoModeBuckets() -- the SAME buckets/colors the live Geo
// Analysis map's own "Color by" modes use), the drawn road (Road Analysis
// only -- empty for Whole Network), one sector "fan" wedge per cell
// (geoWedgePath -- the SAME shape the live map draws, oriented at the
// cell's real azimuth) colored by its value for the active metric that
// hour (geoMetricColor()), any active "just entered congestion" name
// callouts (Road Analysis only), and an hour-of-day progress bar.
function roadDrawFrame(dc, band, hour, cells, callouts, now){
  const {ctx, W, H, tiles, originX, originY, padSide, padTop, routePx, toPx, date, zoom, metric, network} = dc;
  const buckets = geoModeBuckets(metric);
  const metricLabel = (GEO_VIDEO_METRICS.find(m=>m.id===metric)||{}).label || metric;
  const wedgeHalfAngle = network ? ROAD_VIDEO_WEDGE_HALF_ANGLE_NETWORK : GEO_WEDGE_HALF_ANGLE;
  // Grows/shrinks with the preview's OWN zoom, same formula the live map's
  // geoMarkerScale() already uses for its markers (zoom 12 = 1x, +0.4x per
  // level, clamped 0.5x-4x) -- without this, zooming in on the preview
  // only revealed more map detail underneath while the wedges themselves
  // stayed a fixed pixel size, which read as if zoom wasn't doing anything
  // to them at all.
  const wedgeZoomScale = Math.max(0.5, Math.min(4, 1 + ((zoom!==undefined?zoom:13)-12)*0.4));
  const wedgeRadius = (network ? ROAD_VIDEO_WEDGE_RADIUS_NETWORK : ROAD_VIDEO_WEDGE_RADIUS) * wedgeZoomScale;

  ctx.fillStyle = '#0e1117';
  ctx.fillRect(0,0,W,H);
  // Each tile is drawn at 2^(displayZoom - tile's own fetch zoom) its
  // native size -- at an integer display zoom that's exactly 1 (fetch
  // zoom == display zoom, no scaling), but the preview's zoom can be a
  // half-step (see ROAD_ZOOM_STEP) where tiles were fetched at the
  // nearest integer zoom and need to be scaled up/down to land right.
  tiles.forEach(({tx,ty,img,tileZoom})=>{
    if(!img) return;
    const tileScale = Math.pow(2, (zoom!==undefined?zoom:tileZoom) - tileZoom);
    const size = ROAD_TILE_SIZE*tileScale;
    ctx.drawImage(img, padSide+(tx*size-originX), padTop+(ty*size-originY), size, size);
  });
  // Dark scrim so title/legend/route/wedges stay legible over busy map
  // imagery without hiding the map underneath it.
  ctx.fillStyle = 'rgba(14,17,23,0.30)';
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle = 'rgba(22,27,36,0.92)';
  ctx.fillRect(0,0,W,70);
  ctx.strokeStyle = 'var(--chart-grid)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0,70.5); ctx.lineTo(W,70.5); ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6edf3';
  ctx.font = '700 22px "SF Mono","JetBrains Mono",monospace';
  ctx.fillText(`${band||'All Bands'} — ${metricLabel} — ${fmtDateDMY(date)} ${String(hour).padStart(2,'0')}:00`, 24, 26);

  let lx = 24;
  ctx.font = '600 13px "SF Mono","JetBrains Mono",monospace';
  buckets.forEach(r=>{
    const label = roadDecodeLabel(r.label);
    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(lx+6, 54, 6, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = 'var(--chart-ink2)';
    ctx.fillText(label, lx+18, 54);
    lx += 18 + ctx.measureText(label).width + 26;
  });

  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3; ctx.setLineDash([8,5]);
  ctx.beginPath();
  routePx.forEach(([x,y],idx)=>{ idx===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); });
  ctx.stroke();
  ctx.setLineDash([]);

  cells.forEach(c=>{
    const [x,y] = toPx(c.latitude, c.longitude);
    const cellMetric = _roadHourly[c.cell_name] ? _roadHourly[c.cell_name][hour] : undefined;
    const color = geoMetricColor(metric, cellMetric) || GEO_NODATA_COLOR;
    const wedge = new Path2D(geoWedgePath(x, y, wedgeRadius, c.azimuth||0, wedgeHalfAngle));
    ctx.fillStyle = color;
    ctx.fill(wedge);
    ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(14,17,23,0.85)';
    ctx.stroke(wedge);
  });

  callouts.forEach(cal=>{
    const t = (now-cal.start)/ROAD_CALLOUT_MS;
    const alpha = t<0.15 ? t/0.15 : t>0.7 ? Math.max(0,(1-t)/0.3) : 1;
    if(alpha<=0) return;
    ctx.font = '700 12px "SF Mono","JetBrains Mono",monospace';
    let label = cal.name, tw = ctx.measureText(label).width;
    const maxW = 260;
    if(tw > maxW){
      while(label.length>4 && ctx.measureText(label+'…').width > maxW) label = label.slice(0,-1);
      label += '…'; tw = ctx.measureText(label).width;
    }
    const bx = cal.x-tw/2-8, by = cal.y-34, bw = tw+16, bh = 20;
    ctx.fillStyle = `rgba(229,72,77,${0.92*alpha})`;
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(bx,by,bw,bh,5); else ctx.rect(bx,by,bw,bh);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cal.x-5,by+bh); ctx.lineTo(cal.x+5,by+bh); ctx.lineTo(cal.x,by+bh+6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cal.x, by+bh/2);
    ctx.textAlign = 'left';
  });

  const barX=24, barY=H-28, barW=W-48, barH=8;
  ctx.fillStyle = 'rgba(28,35,46,0.9)'; ctx.fillRect(barX,barY,barW,barH);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(barX,barY, barW*((hour+1)/24), barH);
  ctx.fillStyle = 'var(--chart-ink2)'; ctx.font = '11px "SF Mono","JetBrains Mono",monospace';
  ctx.fillText('00:00', barX, barY-10);
  ctx.fillText('23:00', barX+barW-32, barY-10);
  ctx.fillText(network ? `${cells.length} cell(s) on ${band} across the network` : `${cells.length} cell(s) on ${band} along this road`, barX, H-8);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px "SF Mono","JetBrains Mono",monospace';
  ctx.textAlign = 'right';
  ctx.fillText('© OpenStreetMap contributors', W-16, H-8);
  ctx.textAlign = 'left';
}

// ---- init ----
// meta.empty: the database has no data (fresh install / after Delete
// Data) -- the page is just the header + upload prompt, no tabs to render.
if(!DATA.meta.empty){
  renderMajor();
  renderMlbSrvccCa();
  renderLayerwise();
  renderCell();
  renderSiteKpiTab();
  renderBalance();
  renderDip();
  renderL2600();
  renderTxn();
  renderGeoAnalysis();
  renderBusyHourTab();
}
