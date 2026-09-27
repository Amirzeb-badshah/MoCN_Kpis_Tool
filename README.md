# Network Insight App

LTE Network Insight dashboard for the Islamabad-Rawalpindi MOCN network.
SQLite backend (`data/network_insight.db`) + a dashboard rebuilt from it
(`output/network_insight_app.html`), with a browser upload button for
your hourly Excel files.

The database already contains the real data from the `MoCN_KPIs.xlsx`
file you provided (Cell_Group + Cell_Level sheets, 871 sites,
23,485 cell-hour rows), and `output/network_insight_app.html` is
pre-built and ready to open immediately.

## Quick start — hourly uploads (recommended)

```
unzip network_insight_app.zip
cd network_insight_app
uv run src/server.py
```

This opens `http://localhost:8000` in your browser. In the dashboard
header there's an **"Upload Hourly Data"** button — pick your new
`Cell_Group` + `Cell_Level` Excel file, and the server:

1. Saves it to `data/uploads/` (kept for audit trail, timestamped)
2. Ingests it into the database (safe to re-upload the same hour —
   it overwrites that hour's rows instead of duplicating them)
3. Re-runs every aggregation query and rebuilds the dashboard
4. The page reloads automatically showing the fresh data

This is the workflow for your every-hour uploads — leave this running
and just click Upload each time a new file lands.

## Quick start — view only, no upload (no dependencies)

```
uv run src/serve.py
```

Same dashboard, but the Upload button won't work here — there's no
backend behind it, just a static file server. Use this if you only
want to look at the current data without adding a new hour, or if you
prefer to keep ingesting via the command line (below).

You can also just double-click `output/network_insight_app.html` to
open it directly in a browser with no server at all — all data is
embedded in the file.

## Command-line ingestion (alternative to the upload button)

```
uv run src/etl.py path/to/NewHourly.xlsx
uv run src/build.py
```

Same effect as clicking Upload, if you'd rather script it (e.g. a
scheduled task that runs every hour automatically).

## Project layout

```
network_insight_app/
  pyproject.toml
  data/
    network_insight.db       <- SQLite backend (already has your real data)
    uploads/                  <- every uploaded file is kept here (audit trail)
  output/
    network_insight_app.html <- the dashboard (pre-built, open directly)
    bundle.json                <- intermediate aggregated data (debug/inspect)
  src/
    schema.py         table definitions, band/sector derivation
    etl.py             ingest an hourly Excel file into the database (python-calamine)
    queries.py          all SQL aggregation logic (one function per tab)
    build_bundle.py    runs every query, writes output/bundle.json
    build_html.py      renders output/network_insight_app.html from a bundle
    pipeline.py          shared rebuild logic (used by both build.py and server.py)
    data_mgmt.py          Data Management tab backend: list + delete uploads
    geometry_etl.py         ingest the cell database (geometry) file, by header name
    build.py             CLI: ingest + rebuild in one step (no browser needed)
    server.py             Flask app: dashboard + the upload button's backend
    serve.py               plain static server, no upload, no extra dependencies
    app.js               frontend rendering code (consumes bundle.json)
    style.css            design system (dark theme, shared across tabs)
```

## What's wired to real data vs. waiting on more data

**Live from your data:** Major KPIs, LayerWise Analysis (Pre/Post
comparison across all available hours), Cell Level Analysis (zero-traffic
and degraded-cell detection), Traffic Balancing, Traffic Dip Summary,
L2600 Analysis, TXN Issues.

**Waiting on data you haven't sent yet:**
- **Geo Analysis tab / site maps** — needs the `cell_geometry` table
  populated (lat/long, azimuth, beamwidth per cell). The table exists
  and is indexed; once you have a geometry file, add an ingestion
  function in `etl.py` following the same pattern as `load_cell_level`.
- **Neighbor-aware TNL attribution** — needs the `cells_db` table
  populated (cell-to-neighbor relations). Same story: table exists,
  ready for data.

Both tabs currently show an honest placeholder explaining exactly
what's missing rather than fabricated numbers.

## Data validation — no data is ever ingested twice

Every ingest (whether via the upload button or `etl.py` on the command
line) is safe to re-run. Two things are checked, both tested end to end:

1. **Re-uploading an hour you already have.** Rows are keyed by
   `(date, time, cell_name)` — the same hour re-uploaded overwrites
   those exact rows instead of adding new ones, so the row count never
   grows from a repeat upload. The response distinguishes **new** rows
   from **updated** (overwritten) rows, so if you accidentally re-upload
   an old file, or upload a corrected re-export for an hour you already
   have, you can see exactly what happened — e.g. `"rows_level_delta": 0,
   "rows_level_overwritten": 3488"` means nothing new was added, but
   3,488 existing rows were refreshed with (possibly different) values.

2. **Duplicate keys inside a single file.** If the same cell appears
   twice within one upload (a real export glitch, not hypothetical —
   worth watching for), that used to be silently collapsed with no
   trace. It's now detected and surfaces as
   `"intra_file_duplicates"` in the API response and the on-page upload
   status, with a sample of which cell(s) collided
   (`"intra_file_duplicate_sample"`) — the *last* occurrence in the
   file is what gets kept, matching how a spreadsheet reader would
   naturally resolve it, but now you're told when it happens instead
   of it being invisible.

A malformed `LocalCell Id` (text instead of a number, blank, etc.) no
longer crashes the whole hourly ingest either — that one row is stored
with `band='Unknown'` so it's visible and traceable rather than taking
down the rest of the file.

Tested directly against the real HTTP upload endpoint (not just
in-process): baseline upload, exact re-upload, a corrected re-export
with different values for the same hour, and a file with an
intra-file duplicate key — all behave as described above.

## Data Management tab — see and delete uploads

The last tab in the dashboard, **Data Management**, lists every upload
(newest first): when it was uploaded, the source filename, which
sheets it touched, how many rows, and exactly which hour(s) it
covered. Every upload appears here immediately after it's ingested —
via the Upload button or the command line, both are logged the same way.

Each row has a **Delete** button. Deleting an upload removes the data
for every hour that upload touched — from whichever table(s) it
touched — and the page reloads so every other tab reflects the change.

**One thing worth understanding before you delete something:** if a
later upload also touched one of the same hours (e.g. you uploaded a
corrected re-export), that's flagged with a warning badge and called
out in the confirmation dialog before you delete. Deleting in that
case removes the *current* data for those hours — which by then may
belong to the newer upload, not the one you clicked delete on — rather
than trying to "undo" just the original upload's contribution. This
keeps the behavior simple and predictable rather than silently
guessing at partial-undo logic.

This tab needs the server (`uv run src/server.py`) — same as the
Upload button, it has nothing to talk to if you're just viewing the
static HTML file.

## Delete Data — wipe everything (password protected)

The red **Delete Data** button in the header empties the whole database:
every hourly KPI row, all cell geometry, neighbor relations and the upload
history. It asks for a password (`1234`, set as `DELETE_DATA_PASSWORD` in
`src/server.py`), which the server checks, so the endpoint can't be called
without it. The original Excel files in `data/uploads/` are kept, so
re-uploading them restores the data. After a wipe the page shows a
"No data yet" screen until the next hourly upload. The per-upload Delete
buttons on the Data Management tab are unchanged.

## Degraded Cells — adjustable thresholds

The Degraded Cells panel (Cell Level Analysis) has an editable box per
rule (CSSR, PRB, Service Drop, DL Thrp, Avail). The list re-checks
instantly as you type, a changed box is highlighted, and **Defaults**
restores the built-in values (`DEGRADE_RULES` in `src/queries.py`). Edited
thresholds are remembered in that browser. A cell is still flagged only
when it breaches in every one of the last 3 hours.

## MLB_SRVCC_CA tab — new KPI set

A new tab, right after Major KPIs, covering 25 MLB (mobility load
balancing), SRVCC, and Carrier Aggregation counters. Five of them
(CA User Avg %, CA User Throughput, and PCell 3CC/4CC/5CC Avg Users)
also get a headline card at the top — hover a card to reveal its full
line chart; every other KPI gets a full-size chart directly. Every
chart uses that KPI's own available hours, since some of these are
network-wide values and others are aggregated by this app from
cell-level data (see the data-quality note below on why), and those
two sources don't always cover the same hours.

## Two upload buttons — Hourly Data and Cell Database

**Upload Hourly Data** (existing) ingests the `Cell_Group` +
`Cell_Level` KPI export, same as before.

**Upload Cell Database** (new) ingests a separate file containing
cell geometry — latitude, longitude, azimuth, beamwidth, antenna
height — into the `cell_geometry` table that powers the Geo Analysis
map once populated. This reads by **column header name**, not fixed
position (aliases like "Cell Name"/"CellID"/"CGI" all match), since a
geometry file's layout is more likely to vary than the hourly KPI
export's stable machine-generated template. Only a cell-name column
is required; latitude/longitude/azimuth/beamwidth/height are all
optional and stored as NULL if missing. If the file's cell-name
column can't be identified, the upload fails with a specific error
naming what it looked for and what it found instead — no silent
partial ingest, no guessing.

The Geo Analysis tab shows a live progress bar (cells with geometry
loaded, out of total cells) so you can see how complete the geometry
coverage is as you upload.

## Performance notes

- All tables are indexed on `(date, time)`, `(date, time, band)`,
  `(date, time, site_id)`, and `cell_name`.
- The browser never touches the raw ~23K-row cell table — the frontend
  only loads the pre-aggregated `bundle.json` (a few hundred KB),
  computed once at build time by indexed SQL.
- Warm indexed queries run in ~3-4ms; a full rebuild across all 8 tabs
  takes well under 1 second.
- Excel reading uses `python-calamine` (Rust-backed), not `openpyxl` —
  roughly 6-7x faster in testing on large sheets, which matters since
  you're uploading a new file every hour.

## Data-quality notes from the real export

- Some KPI cells contained a literal `/0` text marker (a baked-in
  divide-by-zero error from the source system) instead of a null value.
  `etl.py` sanitizes these on ingest so they can't corrupt averages.
- Only 3 cells in the entire 871-site network are on the L2600 band —
  flagged in the L2600 tab as a deployment finding, not a data error.
- Two of the new MLB/CA columns have a broken pre-aggregation at the
  `Cell_Group` (network-wide) level in the source export:
  `ca_user_avg_pct` reports values up to 165,353% (should be 0-100),
  and `mlb_prb_ho_prep_rate` reports large negative numbers. Both are
  sane at the per-cell level. `queries.py` works around this by
  computing the network-wide hourly figure itself (traffic-weighted
  average across cells) for just these two columns, rather than
  trusting the source's own rollup — worth raising with whoever owns
  that export template, since the underlying `Cell_Group` values for
  these two KPIs shouldn't be used elsewhere without the same fix.
