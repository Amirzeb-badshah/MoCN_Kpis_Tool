# /// script
# requires-python = ">=3.10"
# ///
"""
Assembles the final static app: CSS (design system) + the real-data JSON
bundle + JS (app.js) that renders every tab from that bundle. No
client-side aggregation of raw rows -- the bundle is already the small,
indexed-SQL output build_bundle.py produced.

render(bundle) is importable (server.py calls it in-process after an
upload, no subprocess round-trip needed). Running this file directly
reads output/bundle.json and writes output/network_insight_app.html,
same as before.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CSS = open(os.path.join(HERE, "style.css"), encoding="utf-8").read()
APP_JS = open(os.path.join(HERE, "app.js"), encoding="utf-8").read()
# Vendored Leaflet (basemap for the Geo Analysis tab) -- inlined so the
# output HTML is still one self-contained file; only the OSM tile IMAGES
# are fetched live at view time (they need network access), the library
# code itself does not. See src/vendor/README (if present) for the
# version/source.
LEAFLET_JS = open(os.path.join(HERE, "vendor", "leaflet.js"), encoding="utf-8").read()
LEAFLET_CSS = open(os.path.join(HERE, "vendor", "leaflet.css"), encoding="utf-8").read()
# Vendored mp4-muxer (https://github.com/Vanilagy/mp4-muxer) -- lets the Geo
# Video Analysis recorder mux WebCodecs-encoded H.264 frames into a real,
# non-fragmented ("flat") MP4 client-side. Chrome's MediaRecorder can record
# straight to video/mp4, but it only ever produces a FRAGMENTED MP4 (moof/
# mdat pairs, empty leading moov) -- valid per spec and fine in a browser or
# VLC, but WhatsApp's and many mobile OSes' players reject that shape with a
# generic "something is wrong with the video file" error. Encoding via
# VideoEncoder and muxing with this library instead produces a normal flat
# MP4 (fastStart: in-memory -- full sample table written into one moov up
# front) that plays everywhere. Defines the global `Mp4Muxer`.
MP4_MUXER_JS = open(os.path.join(HERE, "vendor", "mp4-muxer.js"), encoding="utf-8").read()

EXTRA_CSS = """
.badge{display:inline-block;font-family:var(--mono);font-size:10.5px;padding:3px 9px;border-radius:20px;background:rgba(109,74,255,.12);color:var(--accent);border:1px solid rgba(109,74,255,.3)}
.badge.warn{background:rgba(245,158,11,.12);color:var(--warn);border-color:rgba(245,158,11,.3)}
.badge.bad{background:rgba(239,68,68,.12);color:var(--bad);border-color:rgba(239,68,68,.3)}
.badge.purple{background:rgba(168,85,247,.12);color:var(--purple);border-color:rgba(168,85,247,.3)}
#busyHourTable thead th{background:rgba(109,74,255,.16);color:var(--accent)}
.tstrip{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 13px;margin-bottom:16px}
.tstrip label{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);margin-right:5px}
.tstrip .ctl{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-family:var(--mono);font-size:12px;cursor:pointer}
.tstrip .scope{font-family:var(--mono);font-size:11px;color:var(--accent);background:rgba(109,74,255,.1);border:1px solid rgba(109,74,255,.25);border-radius:20px;padding:4px 11px}
.tstrip .scope.fixed{color:var(--warn);background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.25)}
.tstrip .sep{width:1px;height:22px;background:var(--line);margin:0 4px}
.ctl-note{font-family:var(--mono);font-size:11px;color:var(--faint)}
.prow{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.prow:last-child{border-bottom:none}
.prow .pll{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--ink)}
.pbars{display:flex;flex-direction:column;gap:5px}
.pbrow{display:grid;grid-template-columns:58px 1fr;align-items:center;gap:8px}
.pbrow .ptag{font-family:var(--mono);font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.prow .sbar{height:20px}
.sbar{display:flex;height:22px;border-radius:4px;overflow:hidden;border:1px solid var(--line)}
.sseg{display:flex;align-items:center;justify-content:center;font-size:10px;font-family:var(--mono);color:#1e1b3a;font-weight:600}
.hbar-row{display:grid;grid-template-columns:70px 1fr 54px 80px;align-items:center;gap:10px;padding:6px 0}
.hbar-track{height:20px;background:var(--panel2);border-radius:4px;overflow:hidden;border:1px solid var(--line)}
.hbar-fill{height:100%;border-radius:3px 0 0 3px}
.cpanel{border:1px solid var(--line);border-radius:8px;margin-bottom:14px;overflow:hidden}
.cphead{display:flex;align-items:center;gap:10px;padding:13px 16px;background:var(--panel);cursor:pointer;user-select:none}
.cphead h3{font-size:14px;font-weight:650;margin:0}
.cphead .chev{margin-left:auto;font-family:var(--mono);color:var(--faint);transition:transform .2s}
.cphead.collapsed .chev{transform:rotate(-90deg)}
.cpbody{padding:14px 16px;background:var(--bg)}
.cpbody.hidden{display:none}
.catchips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.chip{background:var(--panel);border:1px solid var(--line);color:var(--dim);font-family:var(--mono);font-size:11.5px;padding:6px 12px;border-radius:20px;cursor:pointer}
.chip.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.chip .n{opacity:.75;margin-left:5px}
.matrix td.site{font-weight:700;color:var(--ink);background:var(--panel2);vertical-align:middle}
.pc{font-weight:600;text-align:center;border-radius:3px}
.lc{padding:14px 16px 10px}
/* hover-to-expand headline cards -- .expand-chart's own display/position
   rules live in style.css now (shows to the right of the card, not
   below); this block used to also define a conflicting, more-specific
   `.msc-card .expand-chart{...top:calc(100% + 6px)...}` rule that
   silently overrode style.css's positioning every time (higher
   specificity wins regardless of source order) -- that was the actual
   reason the flyout kept appearing below the card instead of beside it. */
.msc-card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:15px;cursor:default;overflow:visible}
.msc-card .k-lbl{margin-bottom:4px}
.msc-card .spark-wrap{margin-top:8px;height:34px}
.msc-card:hover{border-color:var(--accent)}
.msc-card .hint{font-family:var(--mono);font-size:9px;color:var(--faint);margin-top:6px}
.lc-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}
.lc-title{font-weight:650;font-size:13.5px;letter-spacing:-.01em}
.lc-unit{font-family:var(--mono);font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em}
.osgridhead,.osgrid{display:grid;grid-template-columns:64px repeat(4,1fr);gap:4px;align-items:stretch}
.oshcap{font-family:var(--mono);font-size:9.5px;color:var(--faint);text-align:center}
.oslab{font-family:var(--mono);font-weight:700;font-size:12px;color:var(--ink);display:flex;align-items:center}
.oscell{height:34px;border-radius:3px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,.25)}
.oscell span{font-family:var(--mono);font-size:11px;font-weight:600;color:rgba(0,0,0,.72)}
.placeholder{border:1px dashed var(--line);border-radius:10px;padding:34px;text-align:center;color:var(--dim)}
.placeholder .big{font-size:34px;margin-bottom:8px}
.dlbtn{background:var(--good);color:#fff;border:none;border-radius:7px;padding:9px 15px;font-family:var(--sans);font-weight:650;font-size:13px;cursor:pointer}
.delbtn{background:var(--bad);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-family:var(--sans);font-weight:600;font-size:12px;cursor:pointer}
.delbtn:hover{filter:brightness(1.1)}
.overlap-badge{display:inline-block;font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(245,158,11,.15);color:var(--warn);border:1px solid rgba(245,158,11,.3);margin-left:6px}
.upbtn{display:inline-block;background:var(--accent);color:#fff}
.geobtn{background:var(--purple)}
.upbtn:hover{filter:brightness(1.08)}
#uploadStatus{font-family:var(--mono);font-size:12px}
#uploadStatus.ok{color:var(--good)}
#uploadStatus.err{color:var(--bad)}
#uploadStatus.busy{color:var(--warn)}
.rejwrap5{display:flex;gap:24px;height:190px;align-items:flex-end;padding:10px 8px 0}
.rejhour5{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px}
.rbars{display:flex;align-items:flex-end;gap:10px;height:150px;width:100%;justify-content:center}
.rb{width:34px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px}
.rbfill{width:100%;border-radius:3px 3px 0 0;min-height:2px}
.rbv{font-family:var(--mono);font-size:9.5px;color:var(--ink)}
.rhlab{font-family:var(--mono);font-size:12px;color:var(--dim);font-weight:600;border-top:1px solid var(--line);padding-top:5px;width:100%;text-align:center}
"""

def _page_head():
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Network Insight — Islamabad-Rawalpindi MOCN</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
{LEAFLET_CSS}
{CSS}
{EXTRA_CSS}
</style>
</head>
<body>
"""


def _header_top(meta):
    """Title + stats + upload/delete controls. Shared by the full
    dashboard and the empty (no data yet) page."""
    latest = f"{meta['latest_date']} &middot; {meta['latest_time'][:5]}" if meta.get("latest_date") else "no data"
    return f"""<header>
  <div class="wrap">
    <div class="cphead hdrhead" onclick="togglePanel(this)">
      <div>
        <div class="eyebrow">RF Analytics &middot; Live from network_insight.db</div>
        <h1>Network Insight Report</h1>
      </div>
      <span class="chev">&#9662;</span>
    </div>
    <div class="cpbody hdrbody">
      <div class="sub">MOCN_N_ISB-RWP_4G &middot; {meta['n_sites']} sites &middot; {meta['n_cells']} cells</div>
      <div class="controls">
        <div><label>LATEST DATA</label><span class="ctl" style="cursor:default">{latest}</span></div>
        <div><label>INGEST</label><span class="ctl" style="cursor:default">hourly &middot; Cell_Group + Cell_Level</span></div>
        <label class="dlbtn upbtn" for="hourlyFileInput">&#8593; Upload Hourly Data<input id="hourlyFileInput" type="file" accept=".xlsx" style="display:none" onchange="uploadHourlyFile(this)"></label>
        <label class="dlbtn upbtn geobtn" for="geometryFileInput">&#8593; Upload Cell Database<input id="geometryFileInput" type="file" accept=".xlsx" style="display:none" onchange="uploadGeometryFile(this)"></label>
        <button class="delbtn" onclick="openDeleteDataModal()" title="Delete ALL data (hourly KPIs, cell geometry, upload history) -- password protected">&#128465; Delete Data</button>
        <span id="uploadStatus" class="ctl-note"></span>
        <span id="geoUploadStatus" class="ctl-note"></span>
      </div>
    </div>"""


# Password dialog for the header's "Delete Data" button. The password is
# checked by the server (/api/delete_all_data), not here.
DELETE_MODAL_HTML = """
<div class="chart-modal hidden" id="deleteDataModal" onclick="if(event.target===this) closeDeleteDataModal()">
  <div class="chart-modal-content pw-modal">
    <button class="chart-modal-close" onclick="closeDeleteDataModal()">&times;</button>
    <div class="pw-icon">&#128465;</div>
    <h3>Delete all data?</h3>
    <p>This permanently removes <b>every</b> hourly KPI record, all uploaded cell geometry and the upload history. The dashboard will be empty until a new file is uploaded. The original Excel files in <code>data/uploads</code> are kept.</p>
    <form onsubmit="event.preventDefault(); confirmDeleteData();">
      <label for="deleteDataPassword">Password</label>
      <input type="password" id="deleteDataPassword" class="ctl" autocomplete="off" placeholder="Enter password">
      <div id="deleteDataStatus" class="pw-status"></div>
      <div class="pw-actions">
        <button type="button" class="ctl" onclick="closeDeleteDataModal()">Cancel</button>
        <button type="submit" class="delbtn" id="deleteDataBtn">Delete everything</button>
      </div>
    </form>
  </div>
</div>
"""


def render_empty(bundle):
    """Page shown when the database holds no hourly data (fresh install,
    or right after Delete Data): the header with its upload buttons and a
    prompt to upload. app.js is included for the upload/delete handlers;
    it skips all tab rendering when meta.empty is set."""
    return _page_head() + _header_top(bundle["meta"]) + """
  </div>
</header>
<div class="wrap">
<script id="appdata" type="application/json">""" + json.dumps(bundle, default=str) + """</script>
<section>
  <div class="empty-state">
    <div class="big">&#128202;</div>
    <h2>No data yet</h2>
    <p>The database is empty. Use <b>Upload Hourly Data</b> above to load a <code>Cell_Group</code> + <code>Cell_Level</code> Excel file &mdash; the dashboard builds itself as soon as the first hour is ingested.</p>
  </div>
</section>
</div>
""" + DELETE_MODAL_HTML + "<script>\n" + APP_JS + "\n</script>\n</body>\n</html>\n"


def render(bundle):
    """Build the full HTML string for a given bundle dict."""
    BUNDLE = bundle
    HTML_HEAD = _page_head() + _header_top(BUNDLE["meta"]) + f"""
    <div class="tabs">
      <button class="tab active" data-tab="major">Major KPIs</button>
      <button class="tab" data-tab="mlbsrvccca">MLB_SRVCC_CA</button>
      <button class="tab" data-tab="layer">LayerWise Analysis</button>
      <button class="tab" data-tab="cell">Cell Level Analysis</button>
      <button class="tab" data-tab="sitekpi">Site KPIs</button>
      <button class="tab" data-tab="balance">Traffic Balancing</button>
      <button class="tab" data-tab="dip">Traffic Dip Summary</button>
      <button class="tab" data-tab="l2600">L2600 Analysis</button>
      <button class="tab" data-tab="geo">Geo Analysis</button>
      <button class="tab" data-tab="geovideo">Geo Video Analysis</button>
      <button class="tab" data-tab="busyhour">Busy Hour Report</button>
      <button class="tab" data-tab="txn">Traffic &amp; TXN Issues</button>
      <button class="tab" data-tab="datamgmt">Data Management</button>
    </div>
  </div>
</header>
<div class="wrap">
<script id="appdata" type="application/json">{json.dumps(BUNDLE, default=str)}</script>
"""
    TABS_HTML = """
<!-- ===== MAJOR KPIs ===== -->
<div class="view active" id="major">
  <div class="cpanel filter-panel">
    <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
    <div class="cpbody">
      <div class="tstrip">
        <span class="scope" id="majorScope">Pies &amp; table: latest hour</span>
        <span class="sep"></span>
        <span class="grp"><label>From</label><select class="ctl" id="pieFrom"></select></span>
        <span class="grp"><label>To</label><select class="ctl" id="pieTo"></select></span>
        <span class="ctl-note">Drives the pies and carrier summary table only</span>
      </div>
    </div>
  </div>
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Traffic Split per Carrier</h2></div>
    <div class="grid c2">
      <div class="card enl-card" data-enl-title="Traffic Split per Carrier &mdash; Data Volume"><button class="enlarge-btn" title="Enlarge" onclick="openEnlarge(this)">&#10021;</button><div class="k-lbl" style="margin-bottom:8px">Data Volume by band</div><div id="pieVol"></div></div>
      <div class="card enl-card" data-enl-title="Traffic Split per Carrier &mdash; VoLTE Traffic"><button class="enlarge-btn" title="Enlarge" onclick="openEnlarge(this)">&#10021;</button><div class="k-lbl" style="margin-bottom:8px">VoLTE Traffic by band</div><div id="pieVolte"></div></div>
    </div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">02</span><h2>Data &amp; Voice Utilization by Band</h2><div class="sec-sub" id="bandUtilScope"></div></div>
    <div id="bandUtilCharts" class="bigchart-stack"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">03</span><h2>Per-Carrier Summary Table</h2></div>
    <div class="tbl-wrap" style="max-height:none"><table id="bandTable"></table></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">04</span><h2>Group KPI Trends</h2><div class="sec-sub" id="majorRangeLabel"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="kpiFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="kpiToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="kpiHourSlider"></div></span>
          <span class="ctl-note">Defaults to the last 3 days, all hours &mdash; the hour handles keep only that hour-of-day range on every date selected (e.g. 08:00-20:00 keeps just 08:00-20:00 on each day, not a span across days). Drag on any chart to zoom in.</span>
        </div>
      </div>
    </div>
    <div id="majorLineCharts" class="grid c2"></div>
  </section>
</div>

<!-- ===== MLB / SRVCC / CA ===== -->
<div class="view" id="mlbsrvccca">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>MLB_SRVCC_CA — Headline KPIs</h2><div class="sec-sub">Based on the latest available hour, independent of the range below. Hover a card for the full trend.</div></div>
    <div id="mscCards" class="grid c3"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">02</span><h2>All KPIs — Line Charts</h2><div class="sec-sub" id="mscRangeLabel"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="mscFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="mscToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="mscHourSlider"></div></span>
          <span class="ctl-note">The hour handles keep only that hour-of-day range on every date selected. Drag on any chart to zoom in.</span>
        </div>
      </div>
    </div>
    <div id="mscLineCharts" class="grid c2"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">03</span><h2>Sites With No CA Users</h2><div class="sec-sub" id="noCaScope"></div></div>
    <div class="sec-sub">Click a row for that site's CA Users Avg trend, last 4 days &mdash; requires the server (uv run src/server.py).</div>
    <div class="tbl-wrap" style="max-height:420px"><table id="noCaTable"></table></div>
  </section>
  <section class="hidden" id="noCaSiteDrill">
    <div class="sec-head"><span class="sec-num">04</span><h2>CA Users Avg &mdash; Site Drill-Down</h2><div class="sec-sub" id="noCaSiteDrillH"></div></div>
    <div id="noCaSiteDrillCharts"></div>
  </section>
</div>

<!-- ===== LAYERWISE ===== -->
<div class="view" id="layer">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>LayerWise Analysis</h2><div class="sec-sub">Every chart aggregated across the selected range &mdash; not a single snapshot hour.</div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="layerFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="layerToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="layerHourSlider"></div></span>
          <span class="ctl-note" id="layerRangeNote">Aggregated over the selected range</span>
        </div>
      </div>
    </div>
    <section>
      <div class="sec-head"><span class="sec-num">02</span><h2>Rejections &mdash; Last 4 Hours</h2><div class="sec-sub">Fixed to the most recent 4 hours, independent of the range above</div></div>
      <div class="card enl-card" data-enl-title="Rejections &mdash; Last 4 Hours"><button class="enlarge-btn" title="Enlarge" onclick="openEnlarge(this)">&#10021;</button><div id="rejHourly"></div>
        <div class="legend"><span><span class="dot" style="background:var(--bad)"></span>RAB Fail - License</span><span><span class="dot" style="background:var(--warn)"></span>RRC ReEst Rej</span><span><span class="dot" style="background:var(--purple)"></span>E-RAB Fail - TNL</span></div>
      </div>
    </section>
    <section>
      <div class="sec-head"><span class="sec-num">03</span><h2>CQI Distribution by Layer</h2></div>
      <div class="card" id="cqiPaired"></div>
      <div class="legend"><span><span class="dot" style="background:var(--bad)"></span>CQI 0-6 (Poor)</span><span><span class="dot" style="background:var(--warn)"></span>CQI 7-9 (Fair)</span><span><span class="dot" style="background:var(--good)"></span>CQI 10-15 (Good)</span></div>
    </section>
    <section>
      <div class="sec-head"><span class="sec-num">04</span><h2>PRB Utilization Bands per Layer</h2></div>
      <div class="card" id="prbPaired"></div>
      <div class="legend"><span><span class="dot" style="background:var(--good)"></span>Healthy (&lt;70%)</span><span><span class="dot" style="background:var(--warn)"></span>Elevated (70-85%)</span><span><span class="dot" style="background:var(--bad)"></span>Congested (&gt;85%)</span></div>
    </section>
    <section>
      <div class="sec-head"><span class="sec-num">05</span><h2>UL Interference per Layer</h2></div>
      <div class="card" id="ulPaired"></div>
      <div class="legend"><span><span class="dot" style="background:var(--good)"></span>Good (&le;-112dBm)</span><span><span class="dot" style="background:var(--warn)"></span>Elevated (-112 to -105dBm)</span><span><span class="dot" style="background:var(--bad)"></span>Poor (&gt;-105dBm)</span></div>
    </section>
    <section>
      <div class="sec-head"><span class="sec-num">06</span><h2>Modulation Distribution per Layer</h2></div>
      <div class="card" id="modPaired"></div>
      <div class="legend"><span><span class="dot" style="background:var(--bad)"></span>QPSK</span><span><span class="dot" style="background:var(--warn)"></span>16QAM</span><span><span class="dot" style="background:var(--good)"></span>64QAM</span></div>
    </section>
  </section>
</div>

<!-- ===== CELL LEVEL ===== -->
<div class="view" id="cell">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Cell Level Analysis</h2><div class="sec-sub">Latest hour tables &middot; row-click for hourly charts.</div></div>
    <div class="tstrip">
      <span class="scope" id="cellScope"></span>
      <span class="ctl-note" id="cellTrendNote"></span>
    </div>
    <div class="cpanel">
      <div class="cphead" onclick="togglePanel(this)"><span class="pill bad">Panel 1</span><h3>Zero-Traffic Cells</h3><span class="pill bad" id="zeroCount" style="margin-right:8px"></span><span class="chev">&#9662;</span></div>
      <div class="cpbody"><div class="tbl-wrap" style="max-height:260px" id="zeroTable"></div></div>
    </div>
    <div class="cpanel">
      <div class="cphead" onclick="togglePanel(this)"><span class="pill warn">Panel 2</span><h3>Degraded Cells</h3><span class="pill warn" id="degCount" style="margin-right:8px"></span><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="thr-strip">
          <span class="thr-title">Thresholds</span>
          <div class="thr-inputs" id="degThresholds"></div>
          <button class="ctl thr-reset" onclick="resetDegThresholds()" title="Back to the default thresholds">&#8634; Defaults</button>
        </div>
        <div class="ctl-note" id="degRuleNote" style="margin:-4px 0 12px"></div>
        <div class="catchips" id="degChips"></div>
        <div class="tbl-wrap" style="max-height:320px" id="degTable"></div>
      </div>
    </div>
    <div class="drill" id="cellCharts" style="display:none">
      <div class="drill-h" id="cellChartsH"></div>
      <div id="cellLineCharts" class="grid c2"></div>
    </div>
  </section>
</div>

<!-- ===== SITE KPIs ===== -->
<div class="view" id="sitekpi">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Site-Level KPIs</h2><div class="sec-sub">Every KPI at cell (LocalCellId) granularity, one site at a time &mdash; requires the server (uv run src/server.py).</div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>Site</label><input class="ctl" id="siteInput" list="siteList" placeholder="Type or pick a site&hellip;" style="min-width:340px" autocomplete="off"><datalist id="siteList"></datalist></span>
          <span class="sep"></span>
          <span class="grp"><label>From date</label><select class="ctl" id="siteFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="siteToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="siteHourSlider"></div></span>
          <button class="dlbtn" style="padding:8px 16px;font-size:12px;margin-left:0" onclick="loadSiteKpis()">&#9654; Load Charts</button>
        </div>
      </div>
    </div>
    <div class="ctl-note" id="siteStatus" style="margin-bottom:14px">Pick a site above, then click Load Charts. Each chart shows one line per LocalCellId &mdash; click a legend chip to hide/show that cell, click the &#10021; icon to enlarge a chart, drag on a chart to zoom in.</div>
    <div id="sitePanels"></div>
  </section>
</div>

<!-- shared "maximize chart" modal: Site KPIs charts, plus the enlarge
     buttons on Major KPIs and LayerWise Rejections (openEnlarge) -->
<div class="chart-modal hidden" id="chartModal" onclick="if(event.target===this) closeChartModal()">
  <div class="chart-modal-content">
    <button class="chart-modal-close" onclick="closeChartModal()">&times;</button>
    <div id="chartModalBody"></div>
  </div>
</div>

<!-- ===== TRAFFIC BALANCING ===== -->
<div class="view" id="balance">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Traffic Balancing &mdash; Actionable Imbalance</h2><div class="sec-sub" id="balanceScope">A carrier averaging &gt;85% PRB with co-sited headroom, over the selected range.</div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="balanceFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="balanceToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="balanceHourSlider"></div></span>
          <span class="ctl-note" id="balanceStatus">Requires the server (uv run src/server.py) &mdash; PRB% below is averaged over the selected range.</span>
        </div>
      </div>
    </div>
    <div class="tbl-wrap" id="balanceTable"></div>
  </section>
  <section class="hidden" id="sectorDrill">
    <div class="sec-head"><span class="sec-num">02</span><h2>Sector Drill-Down</h2><div class="sec-sub" id="sectorDrillH"></div></div>
    <div id="sectorDrillCharts"></div>
  </section>
</div>

<!-- ===== TRAFFIC DIP SUMMARY ===== -->
<div class="view" id="dip">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Traffic Dip Summary</h2></div>
    <div class="tstrip"><span class="scope" id="dipScope"></span></div>
    <div class="grid c4" id="dipCards" style="margin-bottom:8px"></div>
  </section>
  <section><div class="sec-head"><span class="sec-num">02</span><h2>Data Volume Dip &mdash; Contributing Cells</h2></div><div class="tbl-wrap" id="dipVolTable"></div></section>
  <section><div class="sec-head"><span class="sec-num">03</span><h2>VoLTE Traffic Dip &mdash; Contributing Cells</h2></div><div class="tbl-wrap" id="dipVolteTable"></div></section>
  <section><div class="sec-head"><span class="sec-num">04</span><h2>Dip Map</h2></div><div id="dipMapPlaceholder"></div></section>
</div>

<!-- ===== L2600 ANALYSIS ===== -->
<div class="view" id="l2600">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>L2600 Analysis &mdash; Utilization Focus</h2></div>
    <div class="tstrip"><span class="scope fixed">Latest hour only</span></div>
    <div class="grid c3" id="l2600Cards" style="margin-bottom:8px"></div>
    <div id="l2600Insight"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">02</span><h2>L2600 PRB Utilization &mdash; Last 7 Hours, DL vs UL</h2></div>
    <div class="sec-sub" id="l2600HourlyScope"></div>
    <div id="l2600HourlyBands"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">03</span><h2>L2600 Hot Sectors &mdash; DL or UL PRB Utilization &gt; 75%</h2><div class="sec-sub" id="l2600HotScope"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="l2600HotFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="l2600HotToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:220px"><label>Hours</label><div id="l2600HotHourSlider"></div></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:200px"><label>Search site</label><input class="ctl" id="l2600HotSearch" placeholder="Type a site name&hellip;" autocomplete="off"></span>
          <span class="ctl-note" id="l2600HotStatus">Requires the server (uv run src/server.py).</span>
        </div>
      </div>
    </div>
    <div class="sec-sub">Click a row for that sector's hourly trend across all carriers, last 3 days &mdash; requires the server (uv run src/server.py).</div>
    <div class="tbl-wrap" id="l2600Table"></div>
  </section>
  <section class="hidden" id="l2600SectorDrill">
    <div class="sec-head"><span class="sec-num">04</span><h2>Sector Drill-Down &mdash; All Carriers</h2><div class="sec-sub" id="l2600SectorDrillH"></div></div>
    <div id="l2600SectorDrillCharts"></div>
    <div id="l2600SectorDrillTa" style="margin-top:18px"></div>
  </section>
  <section>
    <div class="sec-head"><span class="sec-num">05</span><h2>L2600 Overshoot Analysis</h2><div class="sec-sub" id="l2600OvershootScope"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="l2600OvFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="l2600OvToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:260px"><label>Hours</label><div id="l2600OvHourSlider"></div></span>
        </div>
      </div>
    </div>
    <div id="l2600OvershootChart"></div>
    <div class="sec-sub" style="margin-top:10px">Distance derived from the UE Timing-Advance distribution (L.RA.TA.UE.Index0&ndash;11); the 3 index buckets that straddle a 0.7/1.5/2.0&nbsp;km boundary are split proportionally by span width.</div>
  </section>
</div>

<!-- ===== GEO ANALYSIS ===== -->
<div class="view" id="geo">
  <section id="geoPlaceholderSection">
    <div class="sec-head"><span class="sec-num">01</span><h2>Geo Analysis</h2></div>
    <div class="tstrip"><span class="scope fixed">Latest hour only</span></div>
    <div class="placeholder">
      <div class="big">&#128205;</div>
      <div style="font-weight:650;color:var(--ink);margin-bottom:6px">Waiting for cell geometry</div>
      <div style="max-width:520px;margin:0 auto">The <code>cell_geometry</code> table is created and indexed, ready to receive lat/long and azimuth for all <b id="geoCellCount"></b> cells across <b id="geoSiteCount"></b> sites. <b id="geoLoadedCount"></b> cells have geometry loaded so far via the "Upload Cell Database" button. Once at least some cells have it, this tab renders a site map with per-band sector wedges automatically.</div>
      <div style="max-width:520px;margin:8px auto 0" id="geoProgressBar"></div>
    </div>
  </section>
  <section class="hidden" id="geoMapSection">
    <div class="sec-head"><span class="sec-num">01</span><h2>Geo Analysis &mdash; Site Map</h2><div class="sec-sub" id="geoMapScope"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>Color by</label><span class="geo-mode-toggles" id="geoModeToggles"></span></span>
          <span class="sep"></span>
          <span class="grp"><label>From date</label><select class="ctl" id="geoFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="geoToDate"></select></span>
          <span class="grp" style="flex:1;min-width:220px"><label>Hours</label><div id="geoHourSlider"></div></span>
          <span class="ctl-note" id="geoMetricStatus">Band view &mdash; no range needed.</span>
        </div>
        <div class="tstrip" style="margin-top:10px">
          <span class="grp" id="geoBandToggles"></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:220px"><label>Search site</label><input class="ctl" id="geoSiteSearch" placeholder="Type a site name, press Enter&hellip;" autocomplete="off"></span>
          <span class="ctl-note">Scroll to zoom, drag to pan, click a wedge for details.</span>
        </div>
      </div>
    </div>
    <div class="geo-map-wrap" id="geoMapWrap">
      <div id="geoLeafletMap" class="geo-leaflet-map"></div>
      <svg id="geoMapSvg" class="geo-map-svg"></svg>
      <div class="geo-map-tip hidden" id="geoMapTip"></div>
      <div class="geo-map-legend" id="geoMapLegend"></div>
      <div class="geo-map-controls">
        <button onclick="geoZoom(1.3)" title="Zoom in">+</button>
        <button onclick="geoZoom(1/1.3)" title="Zoom out">&minus;</button>
        <button onclick="geoResetView()" title="Reset view">&#8634;</button>
        <button onclick="geoOpenMapModal()" title="Bigger display">&#9974;</button>
      </div>
    </div>
  </section>
</div>

<!-- ===== GEO VIDEO ANALYSIS ===== -->
<div class="view" id="geovideo">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Geo Video Analysis</h2><div class="sec-sub">Hour-by-hour time-lapse video &mdash; the whole network, or a road you draw.</div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Settings</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>View</label><span class="geo-mode-toggles" id="gvModeToggles"></span></span>
          <span class="sep"></span>
          <span class="grp"><label>Date</label><select class="ctl" id="roadDate"></select></span>
          <span class="grp"><label>Speed</label>
            <select class="ctl" id="roadSpeed">
              <option value="180">Fast</option>
              <option value="350" selected>Medium</option>
              <option value="700">Slow</option>
            </select>
          </span>
        </div>
        <div class="tstrip" id="gvMetricRow">
          <span class="grp"><label>Color by</label><span class="geo-mode-toggles" id="gvMetricToggles"></span></span>
        </div>
        <div class="tstrip hidden" id="gvRoadStatusRow">
          <span class="ctl-note" id="roadStatus">Click &ldquo;Draw Road&rdquo;, then click points along a road on the map. Click again to finish.</span>
        </div>
        <div class="tstrip hidden" id="gvRoadHintRow">
          <span class="ctl-note">&#128269; The video frames exactly what the map below is currently zoomed/panned to &mdash; scroll or use the +/&minus; buttons on the map to set your own zoom before clicking Generate.</span>
        </div>
        <div class="tstrip hidden" id="gvRoadControlsRow">
          <button class="ctl" id="roadDrawBtn" onclick="roadToggleDraw()">&#9998; Draw Road</button>
          <button class="ctl" onclick="roadClear()">Clear</button>
          <span class="sep"></span>
          <span class="grp"><label>Buffer</label>
            <input type="range" id="roadBufferSlider" min="100" max="1000" step="50" value="300" oninput="roadBufferChanged()">
            <span class="ctl-note" id="roadBufferLabel">300 m</span>
          </span>
        </div>
        <div class="tstrip" style="margin-top:10px">
          <button class="dlbtn" id="roadGenerateBtn" onclick="roadGenerate()">&#127909; Generate Time-Lapse</button>
        </div>
      </div>
    </div>
    <div id="gvMapSlot" class="hidden"></div>
  </section>
</div>

<!-- Road Time-Lapse playback/export modal -- opened by roadGenerate() once
     the selected road's hourly data has loaded. Opens into a PREVIEW step
     first (roadOpenPreview): a static frame with its own +/- zoom and
     click-drag pan, independent of the live Geo Analysis map, so framing
     the road is an explicit, visible step rather than something set
     beforehand off-screen. "Start Recording" (roadStartRecording) then
     locks that framing in and runs the actual capture. Canvas is drawn
     and recorded entirely client-side (canvas.captureStream +
     MediaRecorder, both native browser APIs -- no new dependency), one
     frame per (band, hour), band order L850->L900->L2100->L1800->L2600
     per the network team's own walkthrough order (see ROAD_BAND_ORDER in
     app.js). -->
<div class="chart-modal hidden" id="roadModal" onclick="if(event.target===this) roadCloseModal()">
  <div class="chart-modal-content" id="roadModalContent" style="width:min(1040px,94vw)">
    <button class="chart-modal-close" onclick="roadCloseModal()">&times;</button>
    <div class="sec-sub" style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <span>Road Time-Lapse &mdash; <b id="roadModalTitle"></b></span>
      <button class="ctl" id="roadEnlargeBtn" onclick="roadToggleEnlarge()" title="Enlarge this window" style="margin-left:auto;margin-right:34px">&#9974; Enlarge</button>
    </div>
    <div style="position:relative">
      <canvas id="roadCanvas" width="1000" height="680" style="width:100%;height:auto;display:block;border-radius:8px;background:#1e1b3a;border:1px solid var(--line);cursor:grab"></canvas>
      <!-- top:12% (not the shared .geo-map-controls default of 14px) --
           the canvas's own title bar is a fixed 70 of 680 internal px
           (~10.3% of height); a long title (band + metric name + date +
           hour) can run wide enough to reach right under a 14px-from-top
           button, so these sit just below that bar instead, clear of the
           title at any title length. -->
      <div class="geo-map-controls" id="roadPreviewControls" style="top:12%">
        <button onclick="roadPreviewZoomBy(0.5)" title="Zoom in">+</button>
        <button onclick="roadPreviewZoomBy(-0.5)" title="Zoom out">&minus;</button>
      </div>
    </div>
    <div class="tstrip" style="margin-top:12px">
      <span class="ctl-note" id="roadPlaybackStatus">Preparing&hellip;</span>
      <button class="dlbtn" id="roadStartBtn" onclick="roadStartRecording()">&#9654; Start Recording</button>
      <button class="dlbtn hidden" id="roadDownloadBtn">&#8991; Download video</button>
    </div>
  </div>
</div>

<!-- Geo Analysis "bigger display" -- reuses the SAME live map element
     (moved in/out of the DOM on open/close, not re-rendered), so the
     Leaflet instance, all markers, and whatever filters/view are
     currently set carry over exactly. -->
<div class="chart-modal hidden geo-map-modal" id="geoMapModal" onclick="if(event.target===this) geoCloseMapModal()">
  <div class="geo-map-modal-content">
    <button class="chart-modal-close" onclick="geoCloseMapModal()">&times;</button>
    <div id="geoMapModalBody"></div>
  </div>
</div>

<!-- Geo Analysis "click a site" KPI charts -- DL/UL throughput, DL/UL PRB
     utilization, and UL interference, one line per cell (so every
     band/carrier at the site shows up as its own line), fetched live from
     the same /api/site_kpis endpoint and chart-drawing code as the Site
     KPIs tab; plus a per-band TA (distance) distribution chart, same
     component the L2600 tab's sector drilldown uses, fetched from
     /api/ta_by_site. -->
<div class="chart-modal hidden" id="geoSiteChartsModal" onclick="if(event.target===this) geoCloseSiteCharts()">
  <div class="chart-modal-content">
    <button class="chart-modal-close" onclick="geoCloseSiteCharts()">&times;</button>
    <div class="sec-sub" style="margin-bottom:10px">Site KPIs &mdash; <b id="geoSiteChartsTitle"></b></div>
    <div id="geoSiteChartsBody"></div>
    <div id="geoSiteChartsTa" style="margin-top:16px"></div>
  </div>
</div>

<!-- ===== BUSY HOUR REPORT ===== -->
<div class="view" id="busyhour">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Busy Hour Report</h2><div class="sec-sub" id="busyHourScope"></div></div>
    <div class="cpanel filter-panel">
      <div class="cphead" onclick="togglePanel(this)"><h3>Filters</h3><span class="chev">&#9662;</span></div>
      <div class="cpbody">
        <div class="tstrip">
          <span class="grp"><label>From date</label><select class="ctl" id="busyHourFromDate"></select></span>
          <span class="grp"><label>To date</label><select class="ctl" id="busyHourToDate"></select></span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:220px"><label>Busy hours</label><div id="busyHourHourSlider"></div></span>
          <span class="ctl-note" id="busyHourStatus">Requires the server (uv run src/server.py).</span>
        </div>
        <div class="tstrip" style="margin-top:10px">
          <span class="grp" style="flex:1;min-width:280px"><label>Chronically bad if &ge; <b id="busyHourPctLabel">75</b>% of busy hours</label>
            <input type="range" id="busyHourPctSlider" min="10" max="100" step="5" value="75" style="width:100%">
          </span>
          <span class="sep"></span>
          <span class="grp" style="flex:1;min-width:200px"><label>Search site</label><input class="ctl" id="busyHourSearch" placeholder="Type a site name&hellip;" autocomplete="off"></span>
        </div>
      </div>
    </div>
    <div class="tstrip">
      <button class="dlbtn" onclick="downloadBusyHourCsv()">&#8991; Download as Excel</button>
    </div>
    <div class="tbl-wrap" id="busyHourTable"></div>
  </section>
</div>

<!-- ===== TXN ISSUES ===== -->
<div class="view" id="txn">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Traffic &amp; TXN Issues</h2><div class="sec-sub">Ranked by TNL failures / down cells.</div></div>
    <div class="tstrip"><span class="scope fixed">Latest hour only</span><span class="ctl-note">Neighbor-aware TNL attribution waiting on cells_db upload</span></div>
    <div class="tbl-wrap" style="max-height:none" id="txnTable"></div>
  </section>
</div>

<!-- ===== DATA MANAGEMENT ===== -->
<div class="view" id="datamgmt">
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>Data Management</h2><div class="sec-sub">Every hourly upload, newest first. Delete removes its data from the dashboard.</div></div>
    <div class="tstrip"><span class="ctl-note" id="dmgmtNote">Requires the server (uv run src/server.py) — a static file open can't list or delete uploads.</span></div>
    <div class="tbl-wrap" style="max-height:none" id="dmgmtTable"></div>
  </section>
</div>

</div>
"""
    return HTML_HEAD + TABS_HTML + DELETE_MODAL_HTML + "<script>\n" + LEAFLET_JS + "\n</script>\n<script>\n" + MP4_MUXER_JS + "\n</script>\n<script>\n" + APP_JS + "\n</script>\n</body>\n</html>\n"


if __name__ == "__main__":
    BUNDLE = json.load(open(os.path.join(ROOT, "output", "bundle.json"), encoding="utf-8"))
    html = render(BUNDLE)
    with open(os.path.join(ROOT, "output", "network_insight_app.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print("output/network_insight_app.html written")
