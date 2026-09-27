"""
Aggregation layer for the Network Insight app.
Every function issues indexed SQL against network_insight.db and returns
small, pre-aggregated Python structures — the browser never touches the
raw 23k-row cell table, which is what keeps the app fast.
"""
import sqlite3
from schema import DB_PATH

def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c

def available_hours():
    """All (date,time) pairs present in cell_level_hourly, ascending."""
    c = conn()
    rows = c.execute("SELECT DISTINCT date, time FROM cell_level_hourly ORDER BY date, time").fetchall()
    c.close()
    return [(r["date"], r["time"]) for r in rows]

def available_group_hours():
    c = conn()
    rows = c.execute("SELECT DISTINCT date, time FROM cell_group_hourly ORDER BY date, time").fetchall()
    c.close()
    return [(r["date"], r["time"]) for r in rows]

def latest_hour():
    h = available_hours()
    return h[-1] if h else (None, None)

def prev_hour():
    h = available_hours()
    return h[-2] if len(h) >= 2 else (None, None)

# ---------------------------------------------------------------------------
# MAJOR KPIs (Cell_Group level)
# Three columns (dl_volume_gb, ul_volume_gb, volte_traffic_erl) have a
# broken pre-aggregation at Cell_Group level in the source export -- same
# class of problem already documented below for MLB_SRVCC_CA -- their
# group-level values run 600-1200x higher than SUM(...) over the matching
# cell_level_hourly rows for the same hour (verified across all 66 hours;
# e.g. 2026-08-23 00:00 group=21194.9 GB vs level-summed=17.3 GB for the
# same 9 cells). Cell_Level is the raw per-cell export with nothing rolled
# up, so for these three we sum it ourselves instead of trusting
# Cell_Group's own rollup. Every other column here reads directly from
# Cell_Group, same as before.
# ---------------------------------------------------------------------------
GROUP_LINE_KPIS = [
    ("DL Volume", "GB", "dl_volume_gb", "level_summed"),
    ("UL Volume", "GB", "ul_volume_gb", "level_summed"),
    ("VoLTE Traffic", "Erl", "volte_traffic_erl", "level_summed"),
    ("RRC Setup SR (Service)", "%", "rrc_setup_sr_service", "group"),
    ("RRC Setup SR (Signaling)", "%", "rrc_setup_sr_signaling", "group"),
    ("E-RAB Setup SR", "%", "erab_setup_sr", "group"),
    ("Call Setup SR (CSSR)", "%", "call_setup_sr", "group"),
    ("Service Drop Rate", "%", "service_drop_rate", "group"),
    # VoLTE Call Drop Rate (volte_drop_rate) removed from every chart/
    # analysis app-wide -- confirmed wrong values, per explicit request.
    ("CSFB SR (LTE->GSM)", "%", "csfb_sr_ho", "group"),
    ("Active Users DL Avg", "users", "active_user_dl_avg", "group"),
    ("Inter-freq HO Out SR", "%", "inter_freq_ho_out_sr", "group"),
    ("Intra-freq HO Out SR", "%", "intra_freq_ho_out_sr", "group"),
    ("X2 Handover SR", "%", "x2_ho_sr", "group"),
    ("S1 Handover SR", "%", "s1_ho_sr", "group"),
    ("DL User Throughput", "Mbps", "dl_user_thrp_mbps", "group"),
    ("UL User Throughput", "Mbps", "ul_user_thrp_mbps", "group"),
    ("SRVCC SR (LTE->GSM)", "%", "srvcc_sr", "group"),
    ("E-RAB Fail - TNL", "count", "erab_failest_tnl", "group"),
    ("E-RAB Fail - License", "count", "erab_failest_noradiores_rrcuserlic", "group"),
]

def _day_aware_labels(rows):
    """Hour-only labels ('14:00') are ambiguous once data spans more than
    one date -- prefix with the date ('23 Aug 14:00') whenever that's
    the case, so multi-day series never show two points both labelled
    '00:00' with no way to tell them apart."""
    dates = {r["date"] for r in rows}
    if len(dates) <= 1:
        return [r["time"][:5] for r in rows]
    out = []
    for r in rows:
        d = r["date"][-2:] + "/" + r["date"][5:7]  # DD/MM
        out.append(f"{d} {r['time'][:5]}")
    return out

def _raw_dt(rows):
    """Parallel (dates, hours) arrays straight off the row -- 'YYYY-MM-DD'
    and 'HH:MM:SS', unformatted. The browser needs these (not the
    display-formatted `times` label) to draw the two-row day/hour axis
    (hour-of-day ticks on top, date centered per day below, day-boundary
    dividers) matching datamis/sample.jpg."""
    return [r["date"] for r in rows], [r["time"] for r in rows]

def _level_summed_hourly(col):
    """Hourly network-wide series for `col`, computed as SUM(col) across all
    cells at each hour (used for the Cell_Group columns whose rollup is
    unreliable -- see GROUP_LINE_KPIS comment above). No band filter: this
    is a network total, same scope as network_totals()."""
    c = conn()
    rows = c.execute(f"""
        SELECT date, time, SUM({col}) AS v
        FROM cell_level_hourly
        GROUP BY date, time
        ORDER BY date, time
    """).fetchall()
    c.close()
    return rows

def major_kpi_series():
    """Full hourly series (all ingested hours) for every Major-KPI line chart."""
    group_cols = [col for _, _, col, src in GROUP_LINE_KPIS if src == "group"]
    c = conn()
    rows = c.execute(
        f"SELECT date, time, {', '.join(group_cols)} FROM cell_group_hourly ORDER BY date, time"
    ).fetchall()
    c.close()
    times = _day_aware_labels(rows)
    dates, hours = _raw_dt(rows)

    out = {}
    for label, unit, col, src in GROUP_LINE_KPIS:
        if src == "group":
            vals = [r[col] for r in rows]
            out[col] = {"label": label, "unit": unit, "times": times, "dates": dates, "hours": hours, "values": vals}
        else:
            srows = _level_summed_hourly(col)
            stimes = _day_aware_labels(srows)
            sdates, shours = _raw_dt(srows)
            out[col] = {"label": label, "unit": unit, "times": stimes, "dates": sdates, "hours": shours,
                        "values": [r["v"] for r in srows]}
    return out

def latest_group_row():
    date, time = latest_hour_group()
    c = conn()
    row = c.execute("SELECT * FROM cell_group_hourly WHERE date=? AND time=?", (date, time)).fetchone()
    c.close()
    return dict(row) if row else {}

def latest_hour_group():
    h = available_group_hours()
    return h[-1] if h else (None, None)

# ---------------------------------------------------------------------------
# MLB / SRVCC / CA tab
# Two columns (ca_user_avg_pct, mlb_prb_ho_prep_rate) have a broken
# pre-aggregation at Cell_Group level in the source export -- their
# group-level values are wildly out of range (verified: ca_user_avg_pct
# up to 165,353 despite being a "%", mlb_prb_ho_prep_rate consistently
# large negative). Their Cell_Level values are sane, so for these two
# specifically we compute the network-wide hourly figure ourselves
# (traffic-weighted average over cells) instead of trusting Cell_Group's
# own rollup. Every other column here reads directly from Cell_Group,
# same as the rest of Major KPIs.
# ---------------------------------------------------------------------------
MLB_SRVCC_CA_KPIS = [
    ("PRB-based MLB HO Prep Rate", "%", "mlb_prb_ho_prep_rate", "level_weighted"),
    ("PRB-based MLB HO Exec Success", "count", "mlb_prb_ho_exec_success", "group"),
    ("PRB-based MLB HO Exec Attempts", "count", "mlb_prb_ho_exec_att", "group"),
    ("SRVCC Success Rate (LTE->GSM)", "%", "srvcc_sr", "group"),
    ("SRVCC Execution Success Rate", "%", "srvcc_exec_sr", "group"),
    ("SRVCC Preparation Success Rate", "%", "srvcc_prep_sr", "group"),
    ("CA User Throughput", "Mbps", "ca_user_thrp_mbps", "group"),
    ("CA User Avg %", "%", "ca_user_avg_pct", "level_weighted"),
    ("CA DLSCell Act Attempts", "count", "ca_dlscell_act_att", "group"),
    ("CA DLSCell Act Success", "count", "ca_dlscell_act_succ", "group"),
    ("CA DLSCell Add Blind Attempts", "count", "ca_dlscell_add_blind_att", "group"),
    ("CA DLSCell Add Blind Success", "count", "ca_dlscell_add_blind_succ", "group"),
    ("CA DLSCell Add Meas Attempts", "count", "ca_dlscell_add_meas_att", "group"),
    ("CA DLSCell Add Meas Success", "count", "ca_dlscell_add_meas_succ", "group"),
    ("CA DLSCell Add Success (Total)", "count", "ca_dlscell_add_succ", "group"),
    ("CA DLSCell Deact Attempts", "count", "ca_dlscell_deact_att", "group"),
    ("CA DLSCell Deact (CQI) Attempts", "count", "ca_dlscell_deact_cqi_att", "group"),
    ("CA DLSCell Deact (CQI) Success", "count", "ca_dlscell_deact_cqi_succ", "group"),
    ("3CC DL Avg Throughput/User", "MB", "cc3_dl_avg_thrp_per_user_mb", "group"),
    ("CA DL PCell 3CC Active Duration", "ms", "ca_dl_pcell_3cc_act_dur_ms", "group"),
    ("E-RAB Normal Release, 3CC Users", "count", "erab_normrel_causer_3cc", "group"),
    ("E-RAB Abnormal Release, 3CC Users", "count", "erab_abnormrel_causer_3cc", "group"),
    ("PCell DL 3CC Avg Users", "users", "traffic_user_pcell_dl_3cc_avg", "group"),
    ("PCell DL 4CC Avg Users", "users", "traffic_user_pcell_dl_4cc_avg", "group"),
    ("PCell DL 5CC Avg Users", "users", "traffic_user_pcell_dl_5cc_avg", "group"),
]

# the 5 KPIs that also get a headline card (in addition to their line chart)
MLB_SRVCC_CA_CARDS = [
    "ca_user_avg_pct", "ca_user_thrp_mbps",
    "traffic_user_pcell_dl_3cc_avg", "traffic_user_pcell_dl_4cc_avg", "traffic_user_pcell_dl_5cc_avg",
]

def _level_weighted_hourly(col, weight_col="dl_volume_gb"):
    """Hourly network-wide series for `col`, computed as a traffic-weighted
    average across cells at each hour (used for the two columns whose
    Cell_Group rollup is unreliable)."""
    c = conn()
    rows = c.execute(f"""
        SELECT date, time,
               SUM({col} * {weight_col}) / NULLIF(SUM(CASE WHEN {col} IS NOT NULL THEN {weight_col} ELSE 0 END),0) AS v
        FROM cell_level_hourly
        WHERE band NOT IN ('Indoor','Unknown')
        GROUP BY date, time
        ORDER BY date, time
    """, ).fetchall()
    c.close()
    return rows

def mlb_srvcc_ca_series():
    """Full hourly series (all ingested hours) for every KPI on the
    MLB_SRVCC_CA tab."""
    group_cols = [col for _, _, col, src in MLB_SRVCC_CA_KPIS if src == "group"]
    c = conn()
    rows = c.execute(
        f"SELECT date, time, {', '.join(group_cols)} FROM cell_group_hourly ORDER BY date, time"
    ).fetchall()
    c.close()
    times = _day_aware_labels(rows)
    dates, hours = _raw_dt(rows)

    out = {}
    for label, unit, col, src in MLB_SRVCC_CA_KPIS:
        if src == "group":
            vals = [r[col] for r in rows]
            out[col] = {"label": label, "unit": unit, "times": times, "dates": dates, "hours": hours, "values": vals}
        else:
            wrows = _level_weighted_hourly(col)
            wtimes = _day_aware_labels(wrows)
            wdates, whours = _raw_dt(wrows)
            out[col] = {"label": label, "unit": unit, "times": wtimes, "dates": wdates, "hours": whours,
                        "values": [r["v"] for r in wrows]}
    return out

def no_ca_sites():
    """Sites with zero CA (Carrier Aggregation) activity for the entire
    span of the LATEST ingested date -- from that date's 00:00 through
    whatever its last available hour is (there's never data past that hour
    for that date, so filtering on date alone already covers exactly that
    span) -- restricted to sites that actually have 2+ carriers (macro
    bands) to aggregate in the first place. A single-carrier site cannot
    do CA by definition, so it can never be an "actionable" no-CA finding
    -- it belongs in a coverage/deployment conversation, not this list.
    'Indoor' and 'Unknown' aren't counted as carriers for this purpose,
    same convention as every other per-band view in this app.

    'CA activity' = SUM(ca_dlscell_act_succ) + SUM(ca_dlscell_act_att) +
    SUM(ca_user_thrp_mbps) across every cell/hour at the site, all zero.
    NULL cells count as 0 via COALESCE, never as "missing" -- an hour with
    no value reported is treated the same as an hour with a reported zero.

    This used to check traffic_user_pcell_dl_3cc/4cc/5cc_avg instead (the
    same columns the tab's own "PCell DL NCC Avg Users" cards use) --
    verified wrong: those columns are simply unpopulated for most cells in
    this dataset regardless of real CA usage, which flagged ~90% of sites
    as "no CA" even when they had tens of thousands of successful CA
    secondary-cell activations that same day. ca_dlscell_act_succ/att and
    ca_user_thrp_mbps are populated far more consistently and are a much
    more direct measure of "did CA actually happen here" (successful
    secondary-cell activations = CA sessions actually established)."""
    c = conn()
    latest_date = c.execute("SELECT MAX(date) FROM cell_level_hourly").fetchone()[0]
    if not latest_date:
        c.close()
        return {"date": None, "from_hour": None, "to_hour": None, "sites": []}
    hours = c.execute(
        "SELECT MIN(time), MAX(time) FROM cell_level_hourly WHERE date=?", (latest_date,)
    ).fetchone()
    rows = c.execute("""
        SELECT site_id,
               COUNT(DISTINCT cell_name) AS n_cells,
               GROUP_CONCAT(DISTINCT band) AS bands,
               COUNT(DISTINCT CASE WHEN band NOT IN ('Indoor','Unknown') THEN band END) AS n_carriers,
               SUM(COALESCE(ca_dlscell_act_succ,0)) AS act_succ,
               SUM(COALESCE(ca_dlscell_act_att,0)) AS act_att,
               SUM(COALESCE(ca_user_thrp_mbps,0)) AS ca_thrp
        FROM cell_level_hourly
        WHERE date=?
        GROUP BY site_id
        HAVING n_carriers >= 2 AND act_succ = 0 AND act_att = 0 AND ca_thrp = 0
        ORDER BY n_cells DESC, site_id
    """, (latest_date,)).fetchall()
    c.close()
    sites = [{"site": r["site_id"], "n_cells": r["n_cells"], "bands": r["bands"]} for r in rows]
    return {"date": latest_date, "from_hour": hours[0][:5], "to_hour": hours[1][:5], "sites": sites}

# ---------------------------------------------------------------------------
# Per-band summary (drives Major KPIs pies/table AND LayerWise)
# Ratio KPIs are weighted by traffic volume so the roll-up is correct
# (never a naive average-of-percentages across cells).
# ---------------------------------------------------------------------------
def band_summary_hourly():
    """Per-hour, per-band RAW components (sums, not pre-divided ratios) for
    every hour cell_level_hourly has. This is what 'Traffic Split per
    Carrier' is built from: cell_group_hourly has only a single whole-network
    row per hour (no band column at all), so a per-band split can only ever
    come from cell_level_hourly. Shipping raw numerator/denominator pairs
    (instead of one pre-computed ratio per hour) lets the browser sum them
    over whatever From/To hour range is selected and *then* divide -- giving
    the same traffic-weighted result band_summary() gives for a single hour,
    correctly generalized to a range instead of silently showing one hour's
    numbers no matter what range is picked.

    Also carries the raw components LayerWise Analysis's "aggregated over
    the selected range" view needs (CQI mix, PRB health-band cell-hour
    counts, UL interference, modulation mix) -- same one query, same
    range-then-divide approach, so Major KPIs' Traffic Split per Carrier
    and LayerWise's per-band sections share one dataset instead of two."""
    c = conn()
    rows = c.execute("""
        SELECT date, time, band,
               SUM(dl_volume_gb) AS dl_vol,
               SUM(ul_volume_gb) AS ul_vol,
               SUM(volte_traffic_erl) AS volte,
               SUM(call_setup_sr * dl_volume_gb) AS cssr_num,
               SUM(dl_volume_gb) AS cssr_den,
               SUM(service_drop_rate * dl_volume_gb) AS drop_num,
               SUM(dl_user_thrp_mbps * active_user_dl_avg) AS dlthrp_num,
               SUM(active_user_dl_avg) AS dlthrp_den,
               SUM(ul_user_thrp_mbps * active_user_ul_avg) AS ulthrp_num,
               SUM(active_user_ul_avg) AS ulthrp_den,
               SUM(rrc_setup_sr_service * dl_volume_gb) AS rrc_num,
               SUM(erab_setup_sr * dl_volume_gb) AS erab_num,
               SUM(intra_freq_ho_out_sr * dl_volume_gb) AS intra_num,
               SUM(inter_freq_ho_out_sr * dl_volume_gb) AS inter_num,
               SUM(dl_prb_util) AS prb_sum,
               COUNT(*) AS n_cells,
               SUM(cqi_0_6_pct * dl_volume_gb) AS cqi_low_num,
               SUM(cqi_7_9_pct * dl_volume_gb) AS cqi_mid_num,
               SUM(cqi_10_15_pct * dl_volume_gb) AS cqi_high_num,
               SUM(CASE WHEN dl_prb_util<70 THEN 1 ELSE 0 END) AS prb_healthy,
               SUM(CASE WHEN dl_prb_util>=70 AND dl_prb_util<85 THEN 1 ELSE 0 END) AS prb_elevated,
               SUM(CASE WHEN dl_prb_util>=85 THEN 1 ELSE 0 END) AS prb_congested,
               SUM(ul_interference_avg_dbm) AS ul_dbm_sum,
               SUM(CASE WHEN ul_interference_avg_dbm IS NOT NULL THEN 1 ELSE 0 END) AS ul_dbm_n,
               SUM(dl_sch_qpsk_tb) AS mod_qpsk,
               SUM(dl_sch_16qam_tb) AS mod_q16,
               SUM(dl_sch_64qam_tb) AS mod_q64
        FROM cell_level_hourly
        WHERE band != 'Indoor'
        GROUP BY date, time, band
        ORDER BY date, time
    """).fetchall()
    c.close()
    by_hour = {}
    for r in rows:
        by_hour.setdefault((r["date"], r["time"]), []).append(dict(r))
    return by_hour

def cqi_by_band(date, time):
    c = conn()
    rows = c.execute("""
        SELECT band,
               SUM(cqi_0_6_pct * dl_volume_gb) / NULLIF(SUM(dl_volume_gb),0) AS cqi_low,
               SUM(cqi_7_9_pct * dl_volume_gb) / NULLIF(SUM(dl_volume_gb),0) AS cqi_mid,
               SUM(cqi_10_15_pct * dl_volume_gb) / NULLIF(SUM(dl_volume_gb),0) AS cqi_high
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor')
        GROUP BY band
    """, (date, time)).fetchall()
    c.close()
    return {r["band"]: dict(r) for r in rows}

def prb_bands_by_band(date, time):
    c = conn()
    rows = c.execute("""
        SELECT band,
          SUM(CASE WHEN dl_prb_util<70 THEN 1 ELSE 0 END) AS healthy,
          SUM(CASE WHEN dl_prb_util>=70 AND dl_prb_util<85 THEN 1 ELSE 0 END) AS elevated,
          SUM(CASE WHEN dl_prb_util>=85 THEN 1 ELSE 0 END) AS congested,
          COUNT(*) AS total
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor')
        GROUP BY band
    """, (date, time)).fetchall()
    c.close()
    return {r["band"]: dict(r) for r in rows}

def ul_interference_by_band(date, time):
    c = conn()
    rows = c.execute("""
        SELECT band, AVG(ul_interference_avg_dbm) AS avg_dbm
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor')
        GROUP BY band
    """, (date, time)).fetchall()
    c.close()
    return {r["band"]: r["avg_dbm"] for r in rows}

def modulation_by_band(date, time):
    c = conn()
    rows = c.execute("""
        SELECT band,
               SUM(dl_sch_qpsk_tb) AS qpsk, SUM(dl_sch_16qam_tb) AS q16, SUM(dl_sch_64qam_tb) AS q64
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor')
        GROUP BY band
    """, (date, time)).fetchall()
    c.close()
    out = {}
    for r in rows:
        tot = (r["qpsk"] or 0) + (r["q16"] or 0) + (r["q64"] or 0)
        if tot > 0:
            out[r["band"]] = {"qpsk": 100*r["qpsk"]/tot, "q16": 100*r["q16"]/tot, "q64": 100*r["q64"]/tot}
        else:
            out[r["band"]] = {"qpsk": 0, "q16": 0, "q64": 0}
    return out

def rejections_last_n_hours(n=5):
    hrs = available_group_hours()[-n:]
    c = conn()
    out = []
    for date, time in hrs:
        row = c.execute("""SELECT rrc_reestfail_rej, erab_failest_tnl, erab_failest_noradiores_rrcuserlic
                            FROM cell_group_hourly WHERE date=? AND time=?""", (date, time)).fetchone()
        out.append({"time": time[:5], "rrc_reest_rej": row["rrc_reestfail_rej"] if row else None,
                    "erab_tnl": row["erab_failest_tnl"] if row else None,
                    "rab_lic": row["erab_failest_noradiores_rrcuserlic"] if row else None})
    c.close()
    return out

# ---------------------------------------------------------------------------
# Cell Level Analysis
# ---------------------------------------------------------------------------
def zero_traffic_cells(date, time, lookback=3):
    """Cells with data volume = 0 AND VoLTE = 0 across the last `lookback`
    available hours (uses however many hours exist if fewer than 3)."""
    hrs = [h for h in available_hours() if h[0] <= date][-lookback:]
    if not hrs:
        return []
    c = conn()
    placeholders = " OR ".join(["(date=? AND time=?)"] * len(hrs))
    params = [x for h in hrs for x in h]
    rows = c.execute(f"""
        SELECT cell_name, site_id, band, sector, date, time, dl_volume_gb, volte_traffic_erl, radio_network_avail_rate
        FROM cell_level_hourly WHERE {placeholders} ORDER BY cell_name, date, time
    """, params).fetchall()
    c.close()
    by_cell = {}
    for r in rows:
        by_cell.setdefault(r["cell_name"], []).append(r)
    out = []
    for cell, recs in by_cell.items():
        if len(recs) < len(hrs):
            continue
        if all((r["dl_volume_gb"] or 0) == 0 and (r["volte_traffic_erl"] or 0) == 0 for r in recs):
            last = recs[-1]
            out.append({
                "cell": cell, "site": last["site_id"], "band": last["band"], "sector": last["sector"],
                "vol_series": [round(r["dl_volume_gb"] or 0, 2) for r in recs],
                "volte_series": [round(r["volte_traffic_erl"] or 0, 2) for r in recs],
                "avail": last["radio_network_avail_rate"],
                "zero_since": recs[0]["time"][:5],
            })
    return out

DEGRADE_RULES = [
    ("CSSR < 98.5", "call_setup_sr", "<", 98.5),
    ("PRB > 85%", "dl_prb_util", ">", 85),
    ("Service Drop > 0.3", "service_drop_rate", ">", 0.3),
    # "VoLTE Drop > 0.2" (volte_drop_rate) removed from every chart/
    # analysis app-wide -- confirmed wrong values, per explicit request.
    ("DL Thrp < 3.0", "dl_user_thrp_mbps", "<", 3.0),
    ("Avail < 95%", "radio_network_avail_rate", "<", 95),
]
# Short names/units for the editable threshold boxes in Cell Level Analysis.
DEGRADE_RULE_NAMES = {
    "call_setup_sr": "CSSR", "dl_prb_util": "PRB", "service_drop_rate": "Service Drop",
    "dl_user_thrp_mbps": "DL Thrp", "radio_network_avail_rate": "Avail",
}
DEGRADE_RULE_UNITS = {
    "call_setup_sr": "%", "dl_prb_util": "%", "service_drop_rate": "%",
    "dl_user_thrp_mbps": "Mbps", "radio_network_avail_rate": "%",
}

def _degrade_window(date, lookback):
    """Rows for the last `lookback` hours up to `date`, grouped by cell,
    keeping only cells present in every one of those hours (a breach has
    to hold across the whole window). Returns (n_hours, {cell: recs})."""
    hrs = [h for h in available_hours() if h[0] <= date][-lookback:]
    if not hrs:
        return 0, {}
    c = conn()
    placeholders = " OR ".join(["(date=? AND time=?)"] * len(hrs))
    params = [x for h in hrs for x in h]
    cols = "cell_name, site_id, band, sector, date, time, " + ", ".join(col for _, col, _, _ in DEGRADE_RULES)
    rows = c.execute(f"SELECT {cols} FROM cell_level_hourly WHERE {placeholders}", params).fetchall()
    c.close()
    by_cell = {}
    for r in rows:
        by_cell.setdefault(r["cell_name"], []).append(r)
    full = {cell: sorted(recs, key=lambda r: (r["date"], r["time"]))
            for cell, recs in by_cell.items() if len(recs) >= len(hrs)}
    return len(hrs), full


def degraded_cells_raw(date, time, lookback=3):
    """Per-cell values for every DEGRADE_RULES column over the lookback
    window, so the Cell Level Analysis tab can re-apply thresholds the
    user edits in the page without a server round-trip. Compact list
    form: rules[i] lines up with each cell's vals[i]."""
    _, by_cell = _degrade_window(date, lookback)
    rules = [{"col": col, "name": DEGRADE_RULE_NAMES[col], "unit": DEGRADE_RULE_UNITS[col],
              "op": op, "default": thresh} for _, col, op, thresh in DEGRADE_RULES]
    cells = []
    for cell, recs in by_cell.items():
        latest = recs[-1]
        vals = [[None if r[col] is None else round(r[col], 3) for r in recs] for _, col, _, _ in DEGRADE_RULES]
        cells.append([cell, latest["site_id"], latest["band"], latest["sector"], vals])
    return {"rules": rules, "cells": cells}


def degraded_cells(date, time, lookback=3, cap=150):
    n_hrs, by_cell = _degrade_window(date, lookback)
    if not n_hrs:
        return {}
    result = {label: [] for label, *_ in DEGRADE_RULES}
    for cell, recs in by_cell.items():
        latest = recs[-1]
        for label, col, op, thresh in DEGRADE_RULES:
            vals = [r[col] for r in recs]
            if any(v is None for v in vals):
                continue
            breach = all(v < thresh for v in vals) if op == "<" else all(v > thresh for v in vals)
            if breach:
                severity = (thresh - latest[col]) if op == "<" else (latest[col] - thresh)
                result[label].append({
                    "cell": cell, "site": latest["site_id"], "band": latest["band"], "sector": latest["sector"],
                    "value": round(latest[col], 2), "threshold": thresh,
                    "trend": " -> ".join(f"{v:.1f}" for v in vals),
                    "_severity": severity,
                })
    out = {}
    for label, items in result.items():
        items.sort(key=lambda x: -x["_severity"])
        total = len(items)
        for it in items:
            it.pop("_severity", None)
        out[label] = {"total": total, "cells": items[:cap]}
    return out

def cell_hourly_series(cell_name):
    c = conn()
    rows = c.execute("""
        SELECT date, time, dl_volume_gb, dl_prb_util, service_drop_rate, call_setup_sr,
               dl_user_thrp_mbps
        FROM cell_level_hourly WHERE cell_name=? ORDER BY date, time
    """, (cell_name,)).fetchall()
    c.close()
    return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# Traffic Balancing (latest hour only)
# ---------------------------------------------------------------------------
def traffic_balancing(date, time):
    c = conn()
    rows = c.execute("""
        SELECT site_id, sector, band, dl_prb_util
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor','Unknown')
    """, (date, time)).fetchall()
    c.close()
    matrix = {}
    for r in rows:
        key = (r["site_id"], r["sector"])
        matrix.setdefault(key, {})[r["band"]] = r["dl_prb_util"]
    out = []
    for (site, sector), bands in matrix.items():
        vals = {b: v for b, v in bands.items() if v is not None}
        if not vals:
            continue
        max_band = max(vals, key=vals.get)
        max_val = vals[max_band]
        if max_val is None or max_val <= 85:
            continue
        headroom_bands = [b for b, v in vals.items() if b != max_band and v is not None and v < 70]
        if not headroom_bands:
            continue
        best_target = min(headroom_bands, key=lambda b: vals[b])
        out.append({
            "site": site, "sector": sector, "bands": vals,
            "hot": max_band, "hot_prb": round(max_val, 1),
            "target": best_target, "target_prb": round(vals[best_target], 1),
        })
    out.sort(key=lambda r: -r["hot_prb"])
    return out

def traffic_balancing_range(from_date, to_date, from_hour, to_hour):
    """Same imbalance logic as traffic_balancing(), generalized from a
    single hour to a date range + hour-of-day window (same semantics as
    every other From/To + hour-slider control in the app: the hour window
    applies on every date in [from_date,to_date], not just the two ends).
    dl_prb_util is AVERAGED across every matching cell/hour per
    (site,sector,band) instead of read as one raw snapshot value -- this
    is what makes it a per-site drill-down analog of the range aggregation
    already used elsewhere (Major KPIs, LayerWise): one representative
    value per band over the whole selected period, not a single hour that
    may or may not be typical.

    Fetched live (like Site KPIs) rather than baked into the static bundle
    -- (site, sector, band) granularity across 900+ sites and every hour
    doesn't scale to shipping ahead of time."""
    c = conn()
    rows = c.execute("""
        SELECT site_id, sector, band, AVG(dl_prb_util) AS avg_prb
        FROM cell_level_hourly
        WHERE band NOT IN ('Indoor','Unknown')
          AND date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
        GROUP BY site_id, sector, band
    """, (from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()
    matrix = {}
    for r in rows:
        key = (r["site_id"], r["sector"])
        matrix.setdefault(key, {})[r["band"]] = r["avg_prb"]
    out = []
    for (site, sector), bands in matrix.items():
        vals = {b: v for b, v in bands.items() if v is not None}
        if not vals:
            continue
        max_band = max(vals, key=vals.get)
        max_val = vals[max_band]
        if max_val is None or max_val <= 85:
            continue
        headroom_bands = [b for b, v in vals.items() if b != max_band and v is not None and v < 70]
        if not headroom_bands:
            continue
        best_target = min(headroom_bands, key=lambda b: vals[b])
        out.append({
            "site": site, "sector": sector, "bands": {b: round(v, 1) for b, v in vals.items()},
            "hot": max_band, "hot_prb": round(max_val, 1),
            "target": best_target, "target_prb": round(vals[best_target], 1),
        })
    out.sort(key=lambda r: -r["hot_prb"])
    return out

# ---------------------------------------------------------------------------
# Traffic Balancing drill-down: click a (site, sector) row -> 3-days-hourly
# trend for that sector's own cells, one line per cell (same proven
# multi-cell chart component as the Site KPIs tab -- reused rather than a
# new one-off, per the explicit "the line charts are no good" feedback:
# this is the one chart style that has NOT drawn that complaint).
# ---------------------------------------------------------------------------
SECTOR_DRILLDOWN_KPIS = [
    ("DL PRB Utilization", "%", "dl_prb_util"),
    ("UL PRB Utilization", "%", "ul_prb_util"),
    ("L.Traffic.ActiveUser.DL.Avg", "users", "active_user_dl_avg"),
    ("L.Traffic.ActiveUser.UL.Avg", "users", "active_user_ul_avg"),
    ("DL User Thrp", "Mbps", "dl_user_thrp_mbps"),
    ("UL User Thrp", "Mbps", "ul_user_thrp_mbps"),
]

def sector_kpi_detail(site_id, sector, days=3, band=None):
    """Same response shape as site_kpi_detail() (dates/hours/cells/panels
    with one panel of multi-cell charts) so the frontend can reuse
    buildSiteCharts() verbatim -- but scoped to one (site,sector) and a
    fixed last-`days`-days window, and with the 6 KPIs the Traffic
    Balancing drill-down asked for instead of the full Site KPIs set.
    An optional `band` restricts to just that band's cell(s) in the sector
    -- e.g. the L2600 tab's drill-down wants only the L2600 cell(s), not
    every band sharing the sector."""
    c = conn()
    all_dates = [r[0] for r in c.execute(
        "SELECT DISTINCT date FROM cell_level_hourly ORDER BY date").fetchall()]
    if not all_dates:
        c.close()
        return {"site": site_id, "sector": sector, "dates": [], "hours": [], "cells": [], "panels": []}
    from_date = all_dates[max(0, len(all_dates) - days)]
    to_date = all_dates[-1]

    cols = ",".join(col for _, _, col in SECTOR_DRILLDOWN_KPIS)
    params = [site_id, sector, from_date, to_date]
    band_clause = ""
    if band:
        band_clause = "AND band=?"
        params.append(band)
    else:
        band_clause = "AND band NOT IN ('Indoor','Unknown')"
    rows = c.execute(f"""
        SELECT date, time, cell_name, local_cell_id, band, {cols}
        FROM cell_level_hourly
        WHERE site_id=? AND sector=? AND date BETWEEN ? AND ?
          {band_clause}
        ORDER BY date, time
    """, params).fetchall()
    c.close()

    cell_keys = sorted(
        {(r["cell_name"], r["local_cell_id"], r["band"] or "") for r in rows},
        key=lambda x: (x[2], x[1] if x[1] is not None else 0),
    )
    cell_names = [ck[0] for ck in cell_keys]

    dt_pairs = sorted({(r["date"], r["time"]) for r in rows})
    idx = {dt: i for i, dt in enumerate(dt_pairs)}
    n = len(dt_pairs)

    charts = []
    for label, unit, col in SECTOR_DRILLDOWN_KPIS:
        by_cell = {cn: [None] * n for cn in cell_names}
        for r in rows:
            by_cell[r["cell_name"]][idx[(r["date"], r["time"])]] = r[col]
        charts.append({"label": label, "unit": unit, "col": col, "by_cell": by_cell})

    scope = f"{band} " if band else ""
    return {
        "site": site_id, "sector": sector,
        "dates": [d for d, t in dt_pairs],
        "hours": [t for d, t in dt_pairs],
        "cells": [{"cell_name": cn, "local_cell_id": lid, "band": b, "sector": sector} for cn, lid, b in cell_keys],
        "panels": [{"panel": f"{scope}Sector {sector} — Last {days} Days", "charts": charts}],
    }

# ---------------------------------------------------------------------------
# Traffic Dip Summary (latest vs previous, or any Pre/Post pair)
# ---------------------------------------------------------------------------
def traffic_dip(date, pre_time, post_time, metric="dl_volume_gb", top_n=15):
    c = conn()
    pre = {r["cell_name"]: r for r in c.execute(
        f"SELECT cell_name, {metric} AS v, radio_network_avail_rate AS avail, erab_failest_tnl AS tnl, ul_interference_avg_dbm AS interf FROM cell_level_hourly WHERE date=? AND time=?",
        (date, pre_time)).fetchall()}
    post = {r["cell_name"]: r for r in c.execute(
        f"SELECT cell_name, {metric} AS v, radio_network_avail_rate AS avail, erab_failest_tnl AS tnl, ul_interference_avg_dbm AS interf FROM cell_level_hourly WHERE date=? AND time=?",
        (date, post_time)).fetchall()}
    c.close()
    diffs = []
    for cell, prow in pre.items():
        qrow = post.get(cell)
        if not qrow:
            continue
        dv = (qrow["v"] or 0) - (prow["v"] or 0)
        if dv < 0:
            diffs.append({
                "cell": cell, "now": round(qrow["v"] or 0, 2), "base": round(prow["v"] or 0, 2),
                "delta": round(dv, 2),
                "avail_now": qrow["avail"], "tnl_now": qrow["tnl"], "interf_now": qrow["interf"],
            })
    total_dip = sum(-d["delta"] for d in diffs) or 1
    diffs.sort(key=lambda d: d["delta"])
    top = diffs[:top_n]
    for d in top:
        d["contrib_pct"] = round(100 * -d["delta"] / total_dip, 1)
        d["avail_ok"] = d["avail_now"] is not None and d["avail_now"] >= 99
        d["tnl_ok"] = d["tnl_now"] is not None and d["tnl_now"] < 5
        d["interf_ok"] = d["interf_now"] is not None and d["interf_now"] <= -105
    return top, round(total_dip, 1)

# ---------------------------------------------------------------------------
# L2600 Analysis (latest hour)
# ---------------------------------------------------------------------------
def _l2600_bucket(vals):
    """<=50 green / 50-75 yellow / >75 red -- the one PRB-congestion
    threshold shared by the headline cards, the per-hour chart and the
    hot-sectors table, for both DL and UL."""
    b = {"le50": 0, "50_75": 0, "gt75": 0}
    for v in vals:
        v = v or 0
        if v <= 50: b["le50"] += 1
        elif v <= 75: b["50_75"] += 1
        else: b["gt75"] += 1
    return b

def l2600_analysis(date, time):
    c = conn()
    rows = c.execute("""
        SELECT cell_name, site_id, sector, dl_prb_util, ul_prb_util, active_user_dl_avg
        FROM cell_level_hourly WHERE date=? AND time=? AND band='L2600'
    """, (date, time)).fetchall()
    c.close()
    cells = [dict(r) for r in rows]
    # L2600 is TDD -- DL and UL share the same carrier via time-slots, so a
    # UL bottleneck is just as real a capacity signal as a DL one. Bucket
    # both directions rather than DL only.
    ranges = {
        "dl": _l2600_bucket([c["dl_prb_util"] for c in cells]),
        "ul": _l2600_bucket([c["ul_prb_util"] for c in cells]),
    }
    return cells, ranges

def l2600_hourly_bands(n=7):
    """DL and UL PRB-utilization distribution (same 3 buckets as
    l2600_analysis) for each of the last n ingested hours -- powers the
    L2600 tab's per-hour DL-vs-UL grouped stacked bar chart. Small (n hours
    x 2 directions x 3 counts), baked into the static bundle."""
    hrs = available_hours()[-n:]
    if not hrs:
        return []
    c = conn()
    out = []
    for date, time in hrs:
        rows = c.execute(
            "SELECT dl_prb_util, ul_prb_util FROM cell_level_hourly WHERE date=? AND time=? AND band='L2600'",
            (date, time)).fetchall()
        dl_vals = [r["dl_prb_util"] for r in rows]
        ul_vals = [r["ul_prb_util"] for r in rows]
        dl = _l2600_bucket(dl_vals); dl["total"] = len(dl_vals)
        ul = _l2600_bucket(ul_vals); ul["total"] = len(ul_vals)
        out.append({"date": date, "time": time, "dl": dl, "ul": ul})
    c.close()
    return out

def l2600_hot_sectors_range(from_date, to_date, from_hour, to_hour):
    """Sector-level (not cell-level) L2600 view for the '>75% either
    direction' table -- averages every L2600 cell sharing a (site,sector)
    (handles CA secondary cells) over a date range + hour-of-day window
    (same semantics as every other range control in the app), and flags
    the sector if EITHER DL or UL PRB utilization is congested, since
    L2600's TDD sharing means a UL bottleneck matters just as much as a DL
    one. Includes DL/UL user throughput so management can see the
    user-facing impact alongside the congestion flag.

    Fetched live (like Traffic Balancing) -- (site,sector) granularity
    over an arbitrary range doesn't scale to the static bundle."""
    c = conn()
    rows = c.execute("""
        SELECT site_id, sector,
               AVG(dl_prb_util) AS dl_prb, AVG(ul_prb_util) AS ul_prb,
               AVG(dl_user_thrp_mbps) AS dl_thrp, AVG(ul_user_thrp_mbps) AS ul_thrp,
               COUNT(*) AS n_cells
        FROM cell_level_hourly
        WHERE band='L2600'
          AND date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
        GROUP BY site_id, sector
    """, (from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()
    out = []
    for r in rows:
        dl_prb = r["dl_prb"] or 0
        ul_prb = r["ul_prb"] or 0
        if dl_prb > 75 or ul_prb > 75:
            out.append({
                "site_id": r["site_id"], "sector": r["sector"],
                "dl_prb": round(dl_prb, 1), "ul_prb": round(ul_prb, 1),
                "dl_thrp": round(r["dl_thrp"] or 0, 2), "ul_thrp": round(r["ul_thrp"] or 0, 2),
                "n_cells": r["n_cells"],
            })
    out.sort(key=lambda x: -max(x["dl_prb"], x["ul_prb"]))
    return out

def l2600_hot_sectors(date, time):
    """Single-hour convenience wrapper around l2600_hot_sectors_range(),
    for the static bundle's latest-hour default (see build_bundle.py)."""
    hour = int(time[:2])
    return l2600_hot_sectors_range(date, date, hour, hour)

def l2600_ta_hourly():
    """Per-hour SUM of the 12 raw ta_idx0..ta_idx11 counters (Huawei
    L.RA.TA.UE.Index0-11 -- UE distance-from-site distribution, derived
    from Timing Advance) across every L2600 cell. One row per ingested
    hour, baked into the static bundle (small: hours x 12 numbers) so the
    browser can sum over ANY selected date+hour-of-day range client-side --
    the same raw-numerator pattern as band_summary_hourly, rather than
    shipping one fixed aggregate or a cell-level live-fetch."""
    ta_cols = [f"ta_idx{i}" for i in range(12)]
    cols_sql = ", ".join(f"SUM(COALESCE({c},0)) AS {c}" for c in ta_cols)
    c = conn()
    rows = c.execute(f"""
        SELECT date, time, {cols_sql}
        FROM cell_level_hourly
        WHERE band='L2600'
        GROUP BY date, time
        ORDER BY date, time
    """).fetchall()
    c.close()
    return [dict(r) for r in rows]

def ta_by_sector_range(site, sector, from_date, to_date, from_hour, to_hour):
    """Per-BAND SUM of the 12 raw ta_idx0..ta_idx11 counters (UE distance-
    from-site distribution, derived from Timing Advance) for every
    carrier/band actually present in one (site,sector) -- TA is a raw
    per-cell counter, not an L2600-specific one, so this powers a "TA
    Distribution Analysis" chart for EACH carrier in the sector (not just
    L2600), matching whatever carriers the sector's own line-chart
    drill-down shows. Uses the same date range + hour-of-day window as
    the L2600 tab's Hot Sectors table Filters, since this is only ever
    called for the one sector currently drilled into from that table."""
    ta_cols = [f"ta_idx{i}" for i in range(12)]
    cols_sql = ", ".join(f"SUM(COALESCE({c},0)) AS {c}" for c in ta_cols)
    c = conn()
    rows = c.execute(f"""
        SELECT band, {cols_sql}
        FROM cell_level_hourly
        WHERE site_id=? AND sector=? AND band NOT IN ('Indoor','Unknown')
          AND date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
        GROUP BY band
    """, (site, sector, from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()
    return [dict(r) for r in rows]

def ta_by_site_range(site, from_date, to_date, from_hour, to_hour):
    """Same per-BAND TA/distance breakdown as ta_by_sector_range, but for
    the WHOLE site (every sector's cells summed together per band) rather
    than one drilled-into sector -- powers the Geo Analysis map's
    click-a-site "TA Distribution" chart, where the other KPI charts
    already show every carrier/sector at the site together."""
    ta_cols = [f"ta_idx{i}" for i in range(12)]
    cols_sql = ", ".join(f"SUM(COALESCE({c},0)) AS {c}" for c in ta_cols)
    c = conn()
    rows = c.execute(f"""
        SELECT band, {cols_sql}
        FROM cell_level_hourly
        WHERE site_id=? AND band NOT IN ('Indoor','Unknown')
          AND date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
        GROUP BY band
    """, (site, from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()
    return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# Busy Hour Report -- per-cell chronic busy-hour underperformance over a
# rolling window (default: last 3 days, 20:00-23:00). Distinct from
# DEGRADE_RULES/degraded_cells (the Data Management "Download Degradations
# Excel" feature) in two ways: that one requires a metric to breach on
# EVERY one of the most recent N actual hours the network has data for,
# here it's a %-of-busy-hours-bad figure the UI applies as a live slider
# over one fetch; and that one looks at whatever hours are most recent,
# here it's specifically the calendar busy-hour window regardless of what
# hour "now" is.
#
# DL-only for now, per explicit request -- no UL throughput/PRB tracked.
# UL interference is kept (it has no DL equivalent being computed, so it
# isn't a "UL calculation" being duplicated for both directions the way
# throughput/PRB were).
# ---------------------------------------------------------------------------
# Kept identical to the thresholds already driving the Geo Analysis map's
# "DL Low Throughput" color mode (GEO_DL_THRP_RANGES in app.js), "DL PRB
# Util" mode (GEO_PRB_RANGES), and "UL Interference" mode
# (GEO_INTERFERENCE_THRESHOLD) -- one set of numbers for "bad" used
# everywhere in the app, rather than each feature inventing its own.
BUSY_HOUR_DL_THRP_THRESHOLD = 1.0    # Mbps, matches GEO_DL_THRP_RANGES' red cutoff
BUSY_HOUR_PRB_CONGESTION_THRESHOLD = 75.0    # %, matches GEO_PRB_RANGES' orange/pink boundary
BUSY_HOUR_INTERFERENCE_THRESHOLD = -95.0    # dBm, matches GEO_INTERFERENCE_THRESHOLD

def busy_hour_report(from_date, to_date, from_hour, to_hour, min_active_users=1.0):
    """Per-cell stats over [from_date,to_date] x [from_hour,to_hour]
    (defaults to the last 3 days, 20:00-23:00 in the UI) -- one row per
    cell, everything the Busy Hour Report tab needs to rank, filter, and
    explain WHY a cell is chronically bad, in one fetch (moving the "% of
    busy hours bad" slider client-side needs no re-query).

    expected_samples = (distinct dates with ANY data in range) x (hours in
    range) -- the denominator every cell's %-bad figure is measured
    against, INCLUDING hours that cell has no row for at all. A missing
    busy-hour sample counts as bad, same weight as an actual breach: a
    cell silently not reporting during busy hour (outage, upload gap) is
    itself worth surfacing, not something a smaller denominator would
    quietly average away.

    Cells with average active users below min_active_users are still
    returned (root_cause='low_traffic') rather than dropped, so the UI
    can choose to exclude them without a second query -- a cell nobody
    was using isn't a capacity problem no matter how low its throughput
    average reads."""
    c = conn()
    n_days = c.execute(
        "SELECT COUNT(DISTINCT date) FROM cell_level_hourly WHERE date BETWEEN ? AND ?",
        (from_date, to_date),
    ).fetchone()[0] or 0
    expected = n_days * max(0, to_hour - from_hour + 1)

    rows = c.execute("""
        SELECT site_id, cell_name, local_cell_id, band, sector,
               COUNT(*) AS n_samples,
               AVG(dl_user_thrp_mbps) AS avg_dl_thrp,
               SUM(CASE WHEN dl_user_thrp_mbps < ? THEN 1 ELSE 0 END) AS dl_bad,
               AVG(dl_prb_util) AS avg_dl_prb,
               AVG(ul_interference_avg_dbm) AS avg_interference,
               AVG(active_user_dl_avg) AS avg_active_users,
               AVG(dl_volume_gb) AS avg_dl_volume,
               AVG(service_drop_rate) AS avg_drop_rate,
               AVG(call_setup_sr) AS avg_cssr,
               AVG(radio_network_avail_rate) AS avg_avail
        FROM cell_level_hourly
        WHERE date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
          AND band NOT IN ('Indoor','Unknown')
        GROUP BY cell_name
    """, (BUSY_HOUR_DL_THRP_THRESHOLD,
          from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()

    out = []
    for r in rows:
        d = dict(r)
        n = d["n_samples"] or 0
        missing = max(0, expected - n)
        dl_bad_total = (d["dl_bad"] or 0) + missing
        d["expected_samples"] = expected
        d["missing_samples"] = missing
        d["pct_dl_bad"] = round(100.0 * dl_bad_total / expected, 1) if expected else None

        avg_active = d["avg_active_users"] or 0
        avg_dl_prb = d["avg_dl_prb"] or 0
        avg_interf = d["avg_interference"]
        avg_avail = d["avg_avail"]
        if avg_active < min_active_users:
            root_cause = "low_traffic"
        elif avg_dl_prb >= BUSY_HOUR_PRB_CONGESTION_THRESHOLD:
            root_cause = "congestion"
        elif avg_interf is not None and avg_interf > BUSY_HOUR_INTERFERENCE_THRESHOLD:
            root_cause = "interference"
        elif missing > 0 or (avg_avail is not None and avg_avail < 99):
            root_cause = "availability"
        else:
            root_cause = "other"
        d["root_cause"] = root_cause
        out.append(d)
    return out

# ---------------------------------------------------------------------------
# TXN Issues (latest hour, site-level rollup)
# ---------------------------------------------------------------------------
def txn_issues(date, time, top_n=15):
    c = conn()
    rows = c.execute("""
        SELECT site_id,
               SUM(dl_volume_gb) AS data_vol,
               SUM(volte_traffic_erl) AS volte,
               SUM(erab_failest_tnl) + SUM(erab_abnormrel_tnl) AS tnl_issues,
               SUM(CASE WHEN radio_network_avail_rate < 99 THEN 1 ELSE 0 END) AS avail_issue_cells,
               SUM(CASE WHEN cell_unavail_dur_sys_s > 0 THEN 1 ELSE 0 END) AS down_cells,
               COUNT(*) AS n_cells
        FROM cell_level_hourly WHERE date=? AND time=? AND band NOT IN ('Indoor')
        GROUP BY site_id
    """, (date, time)).fetchall()
    c.close()
    out = [dict(r) for r in rows]
    for r in out:
        r["tnl_issues"] = round(r["tnl_issues"] or 0, 0)
    out.sort(key=lambda r: (-(r["tnl_issues"] or 0), -(r["down_cells"] or 0)))
    total_vol = sum(r["data_vol"] or 0 for r in out) or 1
    for r in out:
        r["contrib_pct"] = round(100 * (r["data_vol"] or 0) / total_vol, 1)
    return out[:top_n]

def network_totals(date, time):
    c = conn()
    row = c.execute("""
        SELECT SUM(dl_volume_gb) dl_vol, SUM(volte_traffic_erl) volte, COUNT(*) n_cells,
               COUNT(DISTINCT site_id) n_sites
        FROM cell_level_hourly WHERE date=? AND time=?
    """, (date, time)).fetchone()
    c.close()
    return dict(row) if row else {}

def geometry_count():
    c = conn()
    row = c.execute("SELECT COUNT(*) AS n FROM cell_geometry").fetchone()
    c.close()
    return row["n"]

def geo_cells():
    """Every cell with geometry loaded, joined to its band/sector from
    cell_level_hourly (matched by cell_name, the same key cell_geometry
    is stored under) -- powers the Geo Analysis map. One row per cell, no
    time dimension, small enough to bake into the static bundle so the
    map works even without the server running."""
    c = conn()
    rows = c.execute("""
        SELECT g.cell_name, g.site_id, g.latitude, g.longitude, g.azimuth,
               k.band, k.sector
        FROM cell_geometry g
        JOIN (SELECT DISTINCT cell_name, band, sector FROM cell_level_hourly) k
          ON k.cell_name = g.cell_name
        WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL
    """).fetchall()
    c.close()
    return [dict(r) for r in rows]

def geo_congestion_range(from_date, to_date, from_hour, to_hour):
    """Per-cell average DL/UL PRB utilization (%), DL/UL user throughput
    (Mbps), and UL interference (dBm) over a date+hour range -- powers the
    Geo Analysis map's congestion/throughput/interference color overlay.
    Has a time dimension (unlike
    geo_cells, which is geometry only) so this is NOT baked into the
    static bundle -- fetched live for whatever range the map's Filters
    panel has selected, same pattern as l2600_hot_sectors_range /
    traffic_balancing_range. The client joins these rows onto the
    already-baked geo.cells list by cell_name (geometry has no time
    dimension to join through)."""
    c = conn()
    rows = c.execute("""
        SELECT cell_name,
               AVG(dl_prb_util) AS dl_prb_util,
               AVG(ul_prb_util) AS ul_prb_util,
               AVG(dl_user_thrp_mbps) AS dl_thrp,
               AVG(ul_user_thrp_mbps) AS ul_thrp,
               AVG(ul_interference_avg_dbm) AS ul_interference,
               COUNT(*) AS n_samples
        FROM cell_level_hourly
        WHERE date BETWEEN ? AND ?
          AND CAST(SUBSTR(time,1,2) AS INTEGER) BETWEEN ? AND ?
        GROUP BY cell_name
    """, (from_date, to_date, from_hour, to_hour)).fetchall()
    c.close()
    return [dict(r) for r in rows]

def geo_road_hourly(cell_names, date):
    """Per-cell, per-HOUR metrics for exactly the given cell names on one
    date -- powers Geo Video Analysis's Road Analysis mode. Unlike
    geo_congestion_range (which averages the hour dimension away with
    GROUP BY cell_name), this keeps one row per (cell_name, time) so
    client-side playback can step through the day hour by hour. Returns
    all three metrics Geo Video Analysis lets the user color by (DL PRB
    Utilization, DL user throughput, UL interference), in the same
    {dl_prb_util, dl_thrp, ul_interference} shape geoMetricColor()
    already expects on the JS side -- one field set covers whichever
    metric the user picks, no separate query per metric. The cell list is
    typically a road's selected cells (tens, not thousands), so a
    parameterized IN clause against the existing cell_name index is
    cheap -- no need for date+hour range filtering here, the client wants
    every hour of the one chosen date."""
    if not cell_names:
        return []
    c = conn()
    placeholders = ",".join("?" for _ in cell_names)
    rows = c.execute(f"""
        SELECT cell_name, time,
               dl_prb_util,
               dl_user_thrp_mbps AS dl_thrp,
               ul_interference_avg_dbm AS ul_interference
        FROM cell_level_hourly
        WHERE date = ? AND cell_name IN ({placeholders})
    """, (date, *cell_names)).fetchall()
    c.close()
    return [dict(r) for r in rows]

def geo_network_hourly(date):
    """Every cell's per-HOUR metrics for one whole date -- powers Geo
    Video Analysis's Whole Network mode. Unlike geo_road_hourly, no
    cell_name filter: "whole network" means every cell, and ~10,000 cell
    names couldn't reasonably go through a URL query string anyway.
    Grouped by cell_name server-side ({cell_name: {hour: {...}}}) rather
    than one flat row per cell-hour -- at network scale (~244K rows for
    one date) that avoids repeating each ~50-char cell_name 24 times over,
    a meaningful chunk of an otherwise ~39MB response, and hands the
    client the exact shape it stores this in (_roadHourly) directly, no
    client-side grouping pass needed."""
    c = conn()
    rows = c.execute("""
        SELECT cell_name, time,
               dl_prb_util,
               dl_user_thrp_mbps AS dl_thrp,
               ul_interference_avg_dbm AS ul_interference
        FROM cell_level_hourly
        WHERE date = ?
    """, (date,)).fetchall()
    c.close()
    out = {}
    for r in rows:
        hour = int(r["time"][:2])
        out.setdefault(r["cell_name"], {})[hour] = {
            "dl_prb_util": r["dl_prb_util"],
            "dl_thrp": r["dl_thrp"],
            "ul_interference": r["ul_interference"],
        }
    return out

# ---------------------------------------------------------------------------
# Site KPIs (Site-level drill-down tab) -- one site's cells, every KPI
# grouped into panels, one line per LocalCellId. This is per-site detail at
# full cell granularity, which doesn't scale to baking into the static
# bundle for every site (900+ sites x dozens of cells x every hour) -- it's
# fetched live via /api/site_kpis instead, same "requires the server"
# pattern as the upload feature. Only the site LIST (for the dropdown) is
# baked into the bundle.
# ---------------------------------------------------------------------------
SITE_KPI_PANELS = [
    ("Traffic", [
        ("DL Volume", "GB", "dl_volume_gb"),
        ("UL Volume", "GB", "ul_volume_gb"),
        ("VoLTE Traffic", "Erl", "volte_traffic_erl"),
    ]),
    ("Accessibility", [
        ("RRC Setup SR (Service)", "%", "rrc_setup_sr_service"),
        ("E-RAB Setup SR", "%", "erab_setup_sr"),
        ("Call Setup SR (CSSR)", "%", "call_setup_sr"),
    ]),
    ("Retainability", [
        ("Service Drop Rate", "%", "service_drop_rate"),
        # VoLTE Drop Rate (volte_drop_rate) removed from every chart/
        # analysis app-wide -- confirmed wrong values, per explicit request.
    ]),
    ("Mobility / Handover", [
        ("Intra-freq HO Out SR", "%", "intra_freq_ho_out_sr"),
        ("Inter-freq HO Out SR", "%", "inter_freq_ho_out_sr"),
        ("X2 Handover SR", "%", "x2_ho_sr"),
        ("S1 Handover SR", "%", "s1_ho_sr"),
    ]),
    ("Throughput", [
        ("DL User Throughput", "Mbps", "dl_user_thrp_mbps"),
        ("UL User Throughput", "Mbps", "ul_user_thrp_mbps"),
    ]),
    ("PRB Utilization", [
        ("DL PRB Utilization", "%", "dl_prb_util"),
        ("UL PRB Utilization", "%", "ul_prb_util"),
        ("Active Users DL Avg", "users", "active_user_dl_avg"),
    ]),
    ("Interference", [
        ("UL Interference", "dBm", "ul_interference_avg_dbm"),
    ]),
    ("CA (Carrier Aggregation)", [
        ("CA User Throughput", "Mbps", "ca_user_thrp_mbps"),
        ("CA User Avg", "%", "ca_user_avg_pct"),
        ("CA 3CC Users Avg", "users", "traffic_user_pcell_dl_3cc_avg"),
        ("CA 4CC Users Avg", "users", "traffic_user_pcell_dl_4cc_avg"),
    ]),
]

def sites_list():
    """Every site_id + cell count, for the Site KPIs tab's site picker.
    Small enough (one row per site) to bake into the static bundle even
    with 900+ sites."""
    c = conn()
    rows = c.execute("""
        SELECT site_id, COUNT(DISTINCT cell_name) AS n_cells
        FROM cell_level_hourly
        WHERE site_id IS NOT NULL
        GROUP BY site_id
        ORDER BY site_id
    """).fetchall()
    c.close()
    return [{"site": r["site_id"], "n_cells": r["n_cells"]} for r in rows]

def site_kpi_detail(site_id, from_date, to_date, from_hour, to_hour):
    """Every panel/chart in SITE_KPI_PANELS for one site, one line per
    LocalCellId, filtered to [from_date,to_date] and -- like every other
    hour-slider control in this app -- to [from_hour,to_hour] on EVERY
    date in that range, not just the two ends."""
    cols = [col for _, kpis in SITE_KPI_PANELS for _, _, col in kpis]
    c = conn()
    rows = c.execute(f"""
        SELECT date, time, cell_name, local_cell_id, band, sector, {','.join(cols)}
        FROM cell_level_hourly
        WHERE site_id=? AND date BETWEEN ? AND ?
        ORDER BY date, time
    """, (site_id, from_date, to_date)).fetchall()
    c.close()

    rows = [r for r in rows if from_hour <= int(r["time"][:2]) <= to_hour]

    cell_keys = sorted(
        {(r["cell_name"], r["local_cell_id"], r["band"] or "", r["sector"] or "") for r in rows},
        key=lambda x: (x[2], x[3], x[1] if x[1] is not None else 0),
    )
    cell_names = [ck[0] for ck in cell_keys]

    dt_pairs = sorted({(r["date"], r["time"]) for r in rows})
    idx = {dt: i for i, dt in enumerate(dt_pairs)}
    n = len(dt_pairs)

    panels = []
    for panel_name, kpis in SITE_KPI_PANELS:
        charts = []
        for label, unit, col in kpis:
            by_cell = {cn: [None] * n for cn in cell_names}
            for r in rows:
                by_cell[r["cell_name"]][idx[(r["date"], r["time"])]] = r[col]
            charts.append({"label": label, "unit": unit, "col": col, "by_cell": by_cell})
        panels.append({"panel": panel_name, "charts": charts})

    return {
        "site": site_id,
        "dates": [d for d, t in dt_pairs],
        "hours": [t for d, t in dt_pairs],
        "cells": [{"cell_name": cn, "local_cell_id": lid, "band": b, "sector": s} for cn, lid, b, s in cell_keys],
        "panels": panels,
    }
