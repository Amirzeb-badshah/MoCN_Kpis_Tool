# /// script
# requires-python = ">=3.10"
# dependencies = ["python-calamine>=0.3"]
# ///
"""
Ingest the cell database / geometry file (cell id, lat/long, azimuth,
beamwidth, antenna height) into cell_geometry.

Two ingestion strategies, tried per sheet:

1. "Smart" match (used when a sheet has eNodeBId + Local Cell ID columns,
   e.g. a network-wide master file like Database.xlsx with one sheet per
   band): identity is resolved via (eNodeBId, Local Cell ID) against the
   REAL cell_name/band already in cell_level_hourly -- NOT the sheet's own
   CellName column, which was found to just repeat the site name (not
   disambiguate cells) in several such files' L2600/L1800/L900 sheets. The
   (eNodeBId, LocalCellId) key was verified collision-free across the
   whole ingested database. A row is only loaded if the resolved cell's
   ACTUAL band (from cell_level_hourly) matches the sheet it came from --
   a mismatch is skipped and reported, never silently reclassified, since
   band_sector() in schema.py is the one place band gets decided and
   changing it needs an explicit confirmed decision, not an inference
   made here.

2. "Simple" fallback (used when a sheet lacks those columns): the header-
   alias matching this module always used -- trusts the sheet's own
   cell-name column directly. For simpler geometry files that aren't
   structured like a multi-band master export.

Every sheet in the workbook is read (not just the first) and each
becomes its own row group in the returned per-sheet report.

L2600 was briefly excluded from the smart path. A dry run (2026-08-31)
found every L2600-sheet row across 215 sites using Local Cell ID 1-4,
which band_sector() classifies as L1800 -- confirmed via DlEarfcn=41090
(Band 41, genuine L2600 spectrum) to be a real, systematic conflict, not
noise. Root cause turned out to be a data-entry shorthand in the source
sheet, not an actual classification conflict: those rows meant Local
Cell ID 161/162/163/164 (1=161, 2=162, 3=163, 4=164), not 1/2/3/4. The
source file has since been corrected to use the real Local Cell IDs, so
L2600 now goes through the same smart (eNodeBId, Local Cell ID) matching
as every other band -- no exclusion needed.

L2100's own "Local Cell ID" column was found (2026-09-03) to disagree
with the Local Cell ID each row's OWN CellName encodes -- e.g. at site
4G-N-111010 (Faizabad), the sheet has six real L2100 cells (CellName
suffixes 81/82/83/91/92/93), but the "Local Cell ID" *column* only ever
contains 81/82/83, cycling: the -81 row and the -92 row both claim
"Local Cell ID"=81. Matching on that column therefore resolved two (or
three) different physical cells to the SAME real cell, and whichever
row got processed last silently overwrote the others' geometry via
INSERT OR REPLACE -- the surviving coordinates belonged to an unrelated
cell, sometimes kilometers away. CellName itself was reliable throughout
(same naming convention every cell_name in this app already uses), so
_ingest_sheet_smart now derives (eNodeBId, Local Cell ID) from each row's
CellName via CELL_NAME_ID_RE first, falling back to the eNodeBId/"Local
Cell ID" columns only when CellName doesn't parse -- trusting the one
field every other band's sheet also happens to agree with, rather than
a column that's now shown to be unreliable for at least one band.

Usage: uv run src/geometry_etl.py path/to/CellDatabase.xlsx
"""
import re
import sys
from python_calamine import CalamineWorkbook
from schema import init_db

EXCLUDED_BANDS = set()  # previously {"L2600"} -- see module docstring

FIELD_ALIASES = {
    "cell_name": ["cellname", "cell_name", "cell", "cellid", "cell_id", "cgi", "eutrancellname"],
    "site_id": ["siteid", "site_id", "site", "sitename", "site_name",
                "enodeb", "enodebname", "enodeb_name", "enodebfunctionname", "enodebfunctionalname"],
    "latitude": ["latitude", "lat"],
    "longitude": ["longitude", "long", "lon", "lng"],
    "azimuth": ["azimuth", "az", "antennaazimuth", "antenna_azimuth"],
    "beamwidth": ["beamwidth", "bw", "beam_width", "horizontalbeamwidth"],
    "antenna_height": ["height", "antennaheight", "antenna_height", "ht", "towerheight"],
}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# Generous bounding box around the Islamabad-Rawalpindi MOCN network this
# app serves (real cell coordinates cluster at lat ~33.1-33.9, lon
# ~71.8-73.6 -- this adds real margin beyond that for future sites, not a
# tight crop). A handful of L2100 rows (2026-09-03) were found with the
# row's OWN Latitude/Longitude cells holding values hundreds of km away
# (e.g. lon 69.5, off in the direction of the Afghan border) -- not a
# matching/collision bug like the Local Cell ID issue above, just bad raw
# values already sitting in the source spreadsheet for those specific
# rows. Silently keeping a wrong-but-plausible-looking coordinate is
# worse than admitting it's missing, so anything outside this box is
# dropped to NULL (counted as out_of_bounds_coords_dropped) rather than trusted.
LAT_BOUNDS = (32.5, 34.5)
LON_BOUNDS = (71.0, 74.5)


def _plausible_latlon(lat, lon):
    if lat is None or lon is None:
        return lat, lon, True
    if LAT_BOUNDS[0] <= lat <= LAT_BOUNDS[1] and LON_BOUNDS[0] <= lon <= LON_BOUNDS[1]:
        return lat, lon, True
    return None, None, False


def _build_db_index(conn):
    """(enodeb_id, local_cell_id) -> (cell_name, band, site_id) for every
    cell already in cell_level_hourly, parsed from the same
    "{eNodeBId}-{LocalCellId}_..." prefix every real cell_name carries."""
    rows = conn.execute(
        "SELECT DISTINCT cell_name, local_cell_id, band, site_id FROM cell_level_hourly"
    ).fetchall()
    index = {}
    for cell_name, lcid, band, site_id in rows:
        if lcid is None:
            continue
        m = re.match(r"^4G-N-(\d+)-" + str(int(lcid)) + r"_", cell_name)
        if not m:
            continue
        index[(int(m.group(1)), int(lcid))] = (cell_name, band, site_id)
    return index


def _map_headers(header_row):
    """Return {field: column_index} for whichever fields a sheet has."""
    normed = [_norm(h) if h is not None else "" for h in header_row]
    mapping = {}
    for field, aliases in FIELD_ALIASES.items():
        for i, h in enumerate(normed):
            if h in aliases:
                mapping[field] = i
                break
    return mapping


def _ingest_sheet_smart(conn, db_index, sheet_name, rows, header):
    i_enb = header.index("eNodeBId")
    i_lcid = header.index("Local Cell ID")
    i_name = header.index("CellName") if "CellName" in header else None
    i_lat = header.index("Latitude")
    i_lon = header.index("Longitude")
    i_az = header.index("Azimuth") if "Azimuth" in header else None
    i_bw = header.index("Beamwidth") if "Beamwidth" in header else None
    i_ht = header.index("Antenna Height") if "Antenna Height" in header else None

    loaded = 0
    skipped_missing_key = 0
    skipped_no_match = 0
    skipped_band_mismatch = 0
    corrected_from_cellname = 0
    out_of_bounds_coords_dropped = 0
    for r in rows:
        enb = r[i_enb] if i_enb < len(r) else None
        lcid = r[i_lcid] if i_lcid < len(r) else None
        # Prefer the (eNodeBId, Local Cell ID) encoded in the row's own
        # CellName over the separate eNodeBId/"Local Cell ID" columns --
        # see the module docstring: L2100's "Local Cell ID" column was
        # found to disagree with what each row's own CellName says,
        # which silently collided different physical cells' geometry
        # together. CellName is the one field this app already treats as
        # ground truth everywhere else, so trust it here whenever it
        # parses; fall back to the raw columns only when it doesn't.
        name_val = r[i_name] if i_name is not None and i_name < len(r) else None
        m = re.match(r"^4G-N-(\d+)-(\d+)_", str(name_val)) if name_val else None
        if m:
            name_enb, name_lcid = int(m.group(1)), int(m.group(2))
            col_enb = int(enb) if isinstance(enb, (int, float)) or (isinstance(enb, str) and enb.strip().lstrip("-").isdigit()) else None
            col_lcid = int(lcid) if isinstance(lcid, (int, float)) or (isinstance(lcid, str) and lcid.strip().lstrip("-").isdigit()) else None
            if (col_enb, col_lcid) != (name_enb, name_lcid):
                corrected_from_cellname += 1
            enb, lcid = name_enb, name_lcid
        if enb in (None, "") or lcid in (None, ""):
            skipped_missing_key += 1
            continue
        key = (int(enb), int(lcid))
        hit = db_index.get(key)
        if not hit:
            skipped_no_match += 1
            continue
        cell_name, real_band, site_id = hit
        if real_band != sheet_name:
            skipped_band_mismatch += 1
            continue
        lat = _num(r[i_lat]) if i_lat < len(r) else None
        lon = _num(r[i_lon]) if i_lon < len(r) else None
        lat, lon, in_bounds = _plausible_latlon(lat, lon)
        if not in_bounds:
            out_of_bounds_coords_dropped += 1
        az = _num(r[i_az]) if i_az is not None and i_az < len(r) else None
        bw = _num(r[i_bw]) if i_bw is not None and i_bw < len(r) else None
        ht = _num(r[i_ht]) if i_ht is not None and i_ht < len(r) else None
        conn.execute(
            """INSERT OR REPLACE INTO cell_geometry
               (cell_name, site_id, latitude, longitude, azimuth, beamwidth, antenna_height)
               VALUES (?,?,?,?,?,?,?)""",
            (cell_name, site_id, lat, lon, az, bw, ht),
        )
        loaded += 1
    return {
        "strategy": "smart (eNodeBId + Local Cell ID matched against ingested data, preferring the ID CellName itself encodes)",
        "rows_in_sheet": len(rows),
        "loaded": loaded,
        "skipped_missing_key": skipped_missing_key,
        "skipped_no_match_in_app_scope": skipped_no_match,
        "out_of_bounds_coords_dropped": out_of_bounds_coords_dropped,
        "skipped_band_mismatch": skipped_band_mismatch,
        "corrected_from_cellname": corrected_from_cellname,
    }


def _ingest_sheet_simple(conn, sheet_name, rows, raw_header):
    mapping = _map_headers(raw_header)
    if "cell_name" not in mapping:
        return {"strategy": "simple", "error": (
            "couldn't find a cell-name column. Looked for headers like "
            "'Cell Name', 'CellID', 'Cell', 'CGI', 'EUtranCellName' "
            f"-- got: {raw_header}"
        )}

    def get(row, field):
        idx = mapping.get(field)
        return row[idx] if idx is not None and idx < len(row) else None

    loaded = 0
    skipped_blank_key = 0
    out_of_bounds_coords_dropped = 0
    for row in rows:
        if mapping["cell_name"] >= len(row):
            continue
        cell_name = row[mapping["cell_name"]]
        if cell_name is None or cell_name == "":
            skipped_blank_key += 1
            continue
        lat, lon, in_bounds = _plausible_latlon(_num(get(row, "latitude")), _num(get(row, "longitude")))
        if not in_bounds:
            out_of_bounds_coords_dropped += 1
        conn.execute(
            """INSERT OR REPLACE INTO cell_geometry
               (cell_name, site_id, latitude, longitude, azimuth, beamwidth, antenna_height)
               VALUES (?,?,?,?,?,?,?)""",
            (
                cell_name, get(row, "site_id"),
                lat, lon,
                _num(get(row, "azimuth")), _num(get(row, "beamwidth")), _num(get(row, "antenna_height")),
            ),
        )
        loaded += 1
    fields_found = sorted(mapping.keys())
    fields_missing = sorted(set(FIELD_ALIASES.keys()) - set(mapping.keys()))
    return {
        "strategy": "simple (trusts the sheet's own cell-name column)",
        "rows_in_sheet": len(rows),
        "loaded": loaded,
        "skipped_blank_key": skipped_blank_key,
        "out_of_bounds_coords_dropped": out_of_bounds_coords_dropped,
        "fields_found": fields_found,
        "fields_missing": fields_missing,
    }


def ingest_geometry(path):
    wb = CalamineWorkbook.from_path(path)
    if not wb.sheet_names:
        return {"error": "file has no sheets"}

    conn = init_db()
    db_index = _build_db_index(conn)

    per_sheet = {}
    total_loaded = 0
    any_rows = False
    for sheet_name in wb.sheet_names:
        rows = wb.get_sheet_by_name(sheet_name).to_python()
        if not rows:
            per_sheet[sheet_name] = {"error": "sheet has no rows"}
            continue
        raw_header = rows[0]
        header = [str(h).strip() if h is not None else "" for h in raw_header]
        body = rows[1:]
        any_rows = True

        if sheet_name in EXCLUDED_BANDS:
            per_sheet[sheet_name] = {
                "skipped": True,
                "reason": "pending RF-team confirmation of a Local Cell ID band conflict -- see geometry_etl.py module docstring",
                "rows_in_sheet": len(body),
            }
            continue

        if "eNodeBId" in header and "Local Cell ID" in header and "Latitude" in header and "Longitude" in header:
            result = _ingest_sheet_smart(conn, db_index, sheet_name, body, header)
        else:
            result = _ingest_sheet_simple(conn, sheet_name, body, raw_header)
        per_sheet[sheet_name] = result
        total_loaded += result.get("loaded", 0)

    if not any_rows:
        conn.close()
        return {"error": "file has no rows in any sheet"}

    conn.commit()
    conn.close()
    return {"sheets": wb.sheet_names, "per_sheet": per_sheet, "total_loaded": total_loaded}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run src/geometry_etl.py path/to/CellDatabase.xlsx")
        sys.exit(1)
    result = ingest_geometry(sys.argv[1])
    import json
    print(json.dumps(result, indent=2, default=str))
