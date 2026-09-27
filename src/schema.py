"""
SQLite schema + band/sector derivation for the Network Insight app.

Backend DB: network_insight.db
Tables:
  cell_group_hourly   - one row per (date, time, group) from Cell_Group sheet
  cell_level_hourly   - one row per (date, time, cell) from Cell_Level sheet, enriched with band/site/sector
  cell_geometry       - lat/long/azimuth/beamwidth per cell (empty until customer provides it)
  cells_db            - neighbor relations / cell master data (empty until customer provides it)
  ingestion_log       - audit trail of every hourly file ingested (idempotency + traceability)
"""
import sqlite3
import re

import os
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "network_insight.db")

# --- KPI columns shared by both sheets (order matches the source Excel) ---
KPI_COLUMNS = [
    "dl_volume_gb", "ul_volume_gb", "volte_traffic_erl", "rrc_setup_sr_service",
    "rrc_setup_sr_signaling", "erab_setup_sr", "call_setup_sr", "service_drop_rate",
    "volte_drop_rate", "csfb_sr_ho", "csfb_prep_sr", "dl_prb_util",
    "ul_prb_util", "traffic_user_avg", "active_user_dl_avg", "active_user_ul_avg",
    "inter_freq_ho_out_sr", "radio_res_congestion_rate", "intra_freq_ho_in_sr", "intra_freq_ho_out_sr",
    "x2_ho_sr", "s1_ho_sr", "dl_user_thrp_mbps", "ul_user_thrp_mbps",
    "rrc_connreq_att", "rrc_connreq_succ", "rrc_connreq_att_mosig", "rrc_connreq_att_mt",
    "rrc_reestfail_rej", "rrc_reestfail_noreply", "rrc_reestfail_resfail", "erab_abnormrel",
    "erab_abnormrel_radio", "erab_abnormrel_tnl", "erab_abnormrel_mme", "erab_abnormrel_cong",
    "erab_abnormrel_cong_load", "erab_abnormrel_cong_load_voip", "erab_abnormrel_cong_other", "erab_abnormrel_radio_drbreset",
    "erab_abnormrel_radio_srbreset", "erab_abnormrel_radio_ulsyncfail", "erab_abnormrel_radio_uunoreply", "erab_abnormrel_radio_voip",
    "erab_abnormrel_tnl_load", "erab_rel_mme", "erab_failest_noradiores", "erab_failest_tnl",
    "erab_failest_rnl", "prb_dl_avail", "prb_dl_used_avg", "prb_ul_avail",
    "prb_ul_used_avg", "thrp_bits_dl", "thrp_bits_ul", "thrp_time_dl_ms",
    "csfb_prepatt", "csfb_prepsucc", "csfb_e2g", "csfb_e2w",
    "pktuuloss_tot", "pktuuloss_loss", "radio_network_avail_rate", "cell_avail_dur_s",
    "cell_unavail_dur_sys_s", "cell_unavail_dur_manual_s", "rrc_connreq_att_modata", "ul_interference_avg_dbm",
    "dl_sch_qpsk_tb", "dl_sch_16qam_tb", "dl_sch_64qam_tb", "cqi_dl_0",
    "cqi_dl_1", "cqi_dl_10", "cqi_dl_11", "cqi_dl_12",
    "cqi_dl_13", "cqi_dl_14", "cqi_dl_15", "cqi_dl_2",
    "cqi_dl_3", "cqi_dl_4", "cqi_dl_5", "cqi_dl_6",
    "cqi_dl_7", "cqi_dl_8", "cqi_dl_9", "cqi_0_6_pct",
    "cqi_10_15_pct", "cqi_7_9_pct", "ta_idx0", "ta_idx1",
    "ta_idx10", "ta_idx11", "ta_idx2", "ta_idx3",
    "ta_idx4", "ta_idx5", "ta_idx6", "ta_idx7",
    "ta_idx8", "ta_idx9", "ca_user_thrp_mbps", "ca_user_avg_pct",
    "ca_dlscell_act_att", "ca_dlscell_act_succ", "ca_dlscell_add_blind_att", "ca_dlscell_add_blind_succ",
    "ca_dlscell_add_meas_att", "ca_dlscell_add_meas_succ", "ca_dlscell_add_succ", "ca_dlscell_deact_att",
    "ca_dlscell_deact_cqi_att", "ca_dlscell_deact_cqi_succ", "cc3_dl_avg_thrp_per_user_mb", "ca_dl_pcell_3cc_act_dur_ms",
    "erab_normrel_causer_3cc", "erab_abnormrel_causer_3cc", "srvcc_sr", "srvcc_exec_sr",
    "srvcc_prep_sr", "srvcc_prep_fails_e2g", "srvcc_exec_fails_e2g", "iratho_prep_failout_mme",
    "iratho_prep_failout_noreply", "iratho_prep_failout_prepfailure", "mlb_prb_ho_prep_rate", "mlb_prb_ho_exec_success",
    "mlb_prb_ho_exec_att", "traffic_user_pcell_dl_3cc_avg", "traffic_user_pcell_dl_4cc_avg", "traffic_user_pcell_dl_5cc_avg",
    "erab_failest_noradiores_rrcuserlic",
]

assert len(KPI_COLUMNS) == 133, len(KPI_COLUMNS)  # sanity: Cell_Group/Cell_Level KPI portion is 133 cols wide

SCHEMA = """
CREATE TABLE IF NOT EXISTS cell_group_hourly (
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    group_name TEXT NOT NULL,
    integrity INTEGER,
    {kpi_cols},
    PRIMARY KEY (date, time, group_name)
);
CREATE INDEX IF NOT EXISTS idx_cgh_datetime ON cell_group_hourly(date, time);

CREATE TABLE IF NOT EXISTS cell_level_hourly (
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    enodeb_name TEXT,
    fdd_tdd TEXT,
    cell_name TEXT NOT NULL,
    local_cell_id INTEGER,
    site_id TEXT,
    band TEXT,
    sector TEXT,
    integrity INTEGER,
    {kpi_cols},
    PRIMARY KEY (date, time, cell_name)
);
CREATE INDEX IF NOT EXISTS idx_clh_datetime ON cell_level_hourly(date, time);
CREATE INDEX IF NOT EXISTS idx_clh_band ON cell_level_hourly(band);
CREATE INDEX IF NOT EXISTS idx_clh_site ON cell_level_hourly(site_id);
CREATE INDEX IF NOT EXISTS idx_clh_datetime_band ON cell_level_hourly(date, time, band);
CREATE INDEX IF NOT EXISTS idx_clh_datetime_site ON cell_level_hourly(date, time, site_id);
CREATE INDEX IF NOT EXISTS idx_clh_cellname ON cell_level_hourly(cell_name);
-- Covering index for the Geo Analysis map's congestion overlay
-- (geo_congestion_range): that query aggregates 5 REAL columns across the
-- WHOLE date range for EVERY cell, unfiltered by band/site. Every other
-- range query narrows by band or site_id first, so a row-lookup against
-- the (very wide, ~90-column) main table per matching row is cheap; this
-- one has no such filter, so without a covering index SQLite must fetch
-- the full wide row (2GB+ file) ~1.9M times -- ~20s. With this index,
-- the whole query is satisfied from the narrow index alone, no table
-- row-lookups at all.
CREATE INDEX IF NOT EXISTS idx_clh_geo_metrics ON cell_level_hourly(date, time, cell_name, dl_prb_util, ul_prb_util, dl_user_thrp_mbps, ul_user_thrp_mbps, ul_interference_avg_dbm);

CREATE TABLE IF NOT EXISTS cell_geometry (
    cell_name TEXT PRIMARY KEY,
    site_id TEXT,
    latitude REAL,
    longitude REAL,
    azimuth REAL,
    beamwidth REAL,
    antenna_height REAL
);

CREATE TABLE IF NOT EXISTS cells_db (
    cell_name TEXT,
    neighbor_cell_name TEXT,
    relation_type TEXT,
    PRIMARY KEY (cell_name, neighbor_cell_name)
);
CREATE INDEX IF NOT EXISTS idx_cellsdb_cell ON cells_db(cell_name);
CREATE INDEX IF NOT EXISTS idx_cellsdb_neighbor ON cells_db(neighbor_cell_name);

CREATE TABLE IF NOT EXISTS ingestion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT,
    source_file TEXT,
    sheet TEXT,
    rows_loaded INTEGER,
    hours_touched TEXT,
    ingested_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

def kpi_cols_ddl():
    return ",\n    ".join(f"{c} REAL" for c in KPI_COLUMNS)

def _migrate(conn):
    """Additive-only migration: add columns a previously-created database
    might be missing (new KPI columns from an updated source template,
    or columns from a feature added after the database was first
    created). Never drops or renames anything, so existing data is
    never at risk -- old rows just read back NULL for a column that
    didn't exist yet when they were ingested."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(ingestion_log)")}
    if "batch_id" not in cols:
        conn.execute("ALTER TABLE ingestion_log ADD COLUMN batch_id TEXT")
    if "hours_touched" not in cols:
        conn.execute("ALTER TABLE ingestion_log ADD COLUMN hours_touched TEXT")

    # idx_clh_geo_metrics gained ul_interference_avg_dbm (Geo Analysis map's
    # interference color overlay) after some databases already had the
    # 4-column version -- CREATE INDEX IF NOT EXISTS above is a no-op for
    # those, so rebuild it here when its definition is stale. Dropping and
    # recreating an INDEX touches no data, unlike the additive-only column
    # migration below.
    idx_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_clh_geo_metrics'"
    ).fetchone()
    if idx_row and idx_row[0] and "ul_interference_avg_dbm" not in idx_row[0]:
        conn.execute("DROP INDEX idx_clh_geo_metrics")
        conn.execute(
            "CREATE INDEX idx_clh_geo_metrics ON cell_level_hourly"
            "(date, time, cell_name, dl_prb_util, ul_prb_util, dl_user_thrp_mbps, ul_user_thrp_mbps, ul_interference_avg_dbm)"
        )

    for table in ("cell_group_hourly", "cell_level_hourly"):
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for col in KPI_COLUMNS:
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} REAL")
    conn.commit()

def init_db(path=DB_PATH):
    # data/ is not in git (see .gitignore) -- a fresh clone has no folder
    # for SQLite to create the database file in.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA.format(kpi_cols=kpi_cols_ddl()))
    _migrate(conn)
    # PRAGMAs for fast bulk load + fast read later
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Band / sector derivation from LocalCell Id
# Best-effort mapping based on the nomenclature confirmed earlier in this
# project. IDs outside the confirmed ranges are bucketed on the closest
# pattern and flagged 'band_guess'=1 so they can be audited later.
# ---------------------------------------------------------------------------
def band_sector(local_id):
    if local_id is None:
        return "Unknown", "?", 0
    lid = int(local_id)
    guess = 0
    if lid in (1, 2, 3):
        band, sector = "L1800", f"S{lid}"
    elif lid in (4, 5, 6):
        band, sector = "L1800", f"S{lid-3}"
    elif lid == 7:
        band, sector = "L1800", "S1"; guess = 1
    elif lid == 14:
        band, sector = "L1800", "S4"; guess = 1
    elif 11 <= lid <= 33 and lid % 10 in (1, 2, 3):
        band, sector = "L1800", f"S{lid // 10}"
    elif lid in (171, 181):
        band, sector = "L1800", "S1"; guess = 1
    elif lid in (101, 102, 103):
        band, sector = "L1800", f"S{lid-100}"; guess = 1
    elif lid in (111, 112, 113):
        band, sector = "L1800", f"S{lid-110}"; guess = 1
    elif lid == 41:
        band, sector = "L900", "S1"
    elif lid in (42, 43):
        band, sector = "L900", "S2"
    elif lid == 44:
        band, sector = "L900", "S4"
    elif 45 <= lid <= 49:
        band, sector = "L900", "IN"
    elif 51 <= lid <= 53:
        band, sector = "L900", f"S{lid-50}"
    elif lid == 81:
        band, sector = "L2100", "S1"
    elif lid == 82:
        band, sector = "L2100", "S2"
    elif lid == 83:
        band, sector = "L2100", "S3"
    elif lid == 84:
        band, sector = "L2100", "S4"
    elif 85 <= lid <= 89:
        band, sector = "L2100", "IN"
    elif 91 <= lid <= 93:
        band, sector = "L2100", f"S{lid-90}"
    elif 161 <= lid <= 164:
        band, sector = "L2600", f"S{lid-160}"
    elif 121 <= lid <= 124:
        # Confirmed nomenclature: Sector 1/2/3/4 -> LocalCell Id 121-124.
        band, sector = "L850", f"S{lid-120}"
    elif lid in (202, 204):
        band, sector = "Indoor", "IN"
    else:
        band, sector = "Unknown", "?"
        guess = 1
    return band, sector, guess


def derive_site_id(enodeb_function_name, enodeb_name):
    """Site id = eNodeB Function Name (shared across a site's sectors/bands),
    falling back to eNodeB Name if missing."""
    return enodeb_function_name or enodeb_name
