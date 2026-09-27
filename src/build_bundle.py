# /// script
# requires-python = ">=3.10"
# ///
"""
Runs every aggregation query and assembles one compact JSON bundle that the
static app embeds directly — no client-side fetch, no client-side
aggregation over raw rows. This is what keeps the app fast: SQLite (with
indices) does the heavy lifting at build time; the browser only ever
receives small pre-aggregated summaries.
"""
import json
import queries as q

def build():
    hours = q.available_hours()
    ghours = q.available_group_hours()
    date, latest_t = q.latest_hour()
    _, prev_t = q.prev_hour()
    g_date, g_latest_t = q.latest_hour_group()

    bundle = {
        "meta": {
            "latest_date": date, "latest_time": latest_t,
            "prev_time": prev_t,
            "cell_hours_available": [f"{d} {t[:5]}" for d, t in hours],
            "group_hours_available": [f"{d} {t[:5]}" for d, t in ghours],
            "n_sites": None, "n_cells": None,
        },
        "major": {},
        "layerwise": {},
        "cell": {},
        "balance": {},
        "dip": {},
        "l2600": {},
        "txn": {},
        "mlbsrvccca": {},
        "sitekpi": {},
        "geo": {},
    }

    nt = q.network_totals(date, latest_t)
    bundle["meta"]["n_sites"] = nt.get("n_sites")
    bundle["meta"]["n_cells"] = nt.get("n_cells")
    bundle["meta"]["n_cells_with_geometry"] = q.geometry_count()

    # ---- Geo Analysis (map) ----
    bundle["geo"]["cells"] = q.geo_cells()

    # ---- Major KPIs ----
    bundle["major"]["lines"] = q.major_kpi_series()
    # per-hour raw band components, in the same (date,time) order as
    # cell_level_hourly's `hours` list -- which is identical to the
    # cell_group_hourly hours major.lines is indexed by, so the browser can
    # reuse the exact fromI/toI it already gets from the majorFrom/majorTo
    # selects to sum this over any selected range.
    band_hourly = q.band_summary_hourly()
    bundle["major"]["band_hourly"] = [band_hourly.get((d, t), []) for d, t in hours]
    bundle["major"]["latest_group_row"] = {
        k: v for k, v in q.latest_group_row().items()
        # volte_drop_rate excluded app-wide -- confirmed wrong values
        if k not in ("date", "time", "group_name", "volte_drop_rate")
    }

    # ---- MLB / SRVCC / CA ----
    bundle["mlbsrvccca"]["lines"] = q.mlb_srvcc_ca_series()
    bundle["mlbsrvccca"]["card_cols"] = q.MLB_SRVCC_CA_CARDS
    bundle["mlbsrvccca"]["no_ca_sites"] = q.no_ca_sites()

    # ---- LayerWise (aggregated over the selected date+hour range -- no
    # more Pre/Post snapshot comparison, per customer request. It reuses
    # major.band_hourly (already bundled for Traffic Split per Carrier)
    # client-side instead of shipping a second, much heavier per-hour
    # by_hour structure -- that also removes the old failure mode where a
    # selected date/hour didn't exactly match one ingested hour and the
    # Pre/Post lookup silently fell back or came up empty.) ----
    bundle["layerwise"]["available_dates"] = sorted({d for d, _ in hours})
    bundle["layerwise"]["rejections_last4"] = q.rejections_last_n_hours(4)

    # ---- Cell Level ----
    zero_cells = q.zero_traffic_cells(date, latest_t)
    degraded = q.degraded_cells(date, latest_t)
    bundle["cell"]["zero_traffic"] = zero_cells
    bundle["cell"]["degraded"] = degraded
    bundle["cell"]["degraded_raw"] = q.degraded_cells_raw(date, latest_t)
    bundle["cell"]["n_hours_available_for_trend"] = len(hours)
    # pre-fetch hourly series only for cells actually shown (keeps payload small)
    shown_cells = set(c["cell"] for c in zero_cells)
    for cat in degraded.values():
        shown_cells.update(c["cell"] for c in cat["cells"])
    series_map = {}
    for cell in shown_cells:
        series_map[cell] = q.cell_hourly_series(cell)
    bundle["cell"]["series"] = series_map

    # ---- Traffic Balancing ----
    # No longer baked into the bundle: the tab now has its own From/To +
    # hour-range controls and fetches /api/traffic_balance live for
    # whatever range is selected (see queries.traffic_balancing_range).

    # ---- Traffic Dip Summary ----
    dip_vol, total_vol_dip = q.traffic_dip(date, prev_t, latest_t, "dl_volume_gb")
    dip_volte, total_volte_dip = q.traffic_dip(date, prev_t, latest_t, "volte_traffic_erl")
    bundle["dip"]["data_volume"] = dip_vol
    bundle["dip"]["data_volume_total_dip"] = total_vol_dip
    bundle["dip"]["volte"] = dip_volte
    bundle["dip"]["volte_total_dip"] = total_volte_dip
    bundle["dip"]["pre_time"] = prev_t
    bundle["dip"]["post_time"] = latest_t

    # ---- L2600 ----
    l2600_cells, l2600_ranges = q.l2600_analysis(date, latest_t)
    bundle["l2600"]["cells"] = l2600_cells
    bundle["l2600"]["ranges"] = l2600_ranges
    bundle["l2600"]["hourly_bands"] = q.l2600_hourly_bands(7)
    bundle["l2600"]["hot_sectors"] = q.l2600_hot_sectors(date, latest_t)
    bundle["l2600"]["ta_hourly"] = q.l2600_ta_hourly()

    # ---- TXN ----
    bundle["txn"]["rows"] = q.txn_issues(date, latest_t)

    # ---- Site KPIs (site picker only -- per-site detail is fetched live
    # via /api/site_kpis; baking full cell-level history for every site
    # into this static bundle doesn't scale) ----
    bundle["sitekpi"]["sites"] = q.sites_list()
    bundle["sitekpi"]["panel_defs"] = [
        {"panel": name, "charts": [{"label": l, "unit": u, "col": c} for l, u, c in kpis]}
        for name, kpis in q.SITE_KPI_PANELS
    ]

    return bundle


if __name__ == "__main__":
    import os
    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output", "bundle.json")
    b = build()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(b, f, default=str)
    print(f"{out_path} written,", len(json.dumps(b, default=str)), "bytes")
