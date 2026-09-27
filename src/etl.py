# /// script
# requires-python = ">=3.10"
# dependencies = ["python-calamine>=0.3"]
# ///
"""
Ingest an hourly MoCN_KPIs.xlsx (Cell_Group + Cell_Level sheets) into the
SQLite backend. Safe to re-run: uses INSERT OR REPLACE keyed on
(date, time, group/cell), so re-uploading the same hour overwrites cleanly
instead of duplicating.

Uses python-calamine (Rust-backed) instead of openpyxl to read the file —
~6-7x faster on large sheets in testing. One behavioural difference from
openpyxl: calamine pads blank cells with '' (empty string) rather than
None, so row-validity checks below treat both as "blank".

Usage: uv run etl.py /path/to/MoCN_KPIs.xlsx
"""
import sys
import time as _time
import json
import uuid
from python_calamine import CalamineWorkbook
from schema import init_db, KPI_COLUMNS, band_sector, derive_site_id, DB_PATH


def _cell(v):
    """Normalize a cell value: datetime.time -> 'HH:MM:SS' str, date -> 'YYYY-MM-DD', else passthrough."""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _blank(v):
    """True for both openpyxl-style None and calamine-style '' blanks."""
    return v is None or v == ""


def _has_date(v):
    return hasattr(v, "isoformat")


def _sanitize_kpi(v):
    """KPI columns are numeric-only. Source exports occasionally bake in
    error markers (e.g. '/0', '#DIV/0!', 'NaN') as text, and blank cells
    arrive as '' from calamine — store all of these as NULL rather than
    corrupting downstream aggregation."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _safe_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def _pad(row, n):
    """calamine gives ragged rows their sheet's full rectangular width in
    practice, but pad defensively in case a row is short."""
    if len(row) < n:
        return list(row) + [None] * (n - len(row))
    return row


def load_cell_group(conn, rows):
    cols = KPI_COLUMNS
    all_cols = ["date", "time", "group_name", "integrity"] + cols
    placeholders = ",".join(["?"] * len(all_cols))
    sql = f"""INSERT OR REPLACE INTO cell_group_hourly ({",".join(all_cols)})
              VALUES ({placeholders})"""
    by_key = {}
    intra_dup_keys = []
    for row in rows[1:]:  # skip header
        row = _pad(row, 4 + len(cols))
        if not _has_date(row[0]) or _blank(row[2]):
            continue  # skip footer/summary rows like "Total 19 Records"
        date_s = _cell(row[0])[:10]
        time_s = _cell(row[1])
        group_name = row[2]
        integrity = row[3]
        kpis = [_sanitize_kpi(x) for x in row[4:4 + len(cols)]]
        kpis = kpis + [None] * (len(cols) - len(kpis))
        key = (date_s, time_s, group_name)
        if key in by_key:
            intra_dup_keys.append(group_name)
        by_key[key] = (date_s, time_s, group_name, integrity, *kpis)

    # Fetch the FULL existing row (every column, not just the key) for every
    # (date,time) this upload touches, so a re-upload can be compared
    # value-for-value against what's already stored -- not just by key.
    # This is what lets a byte-identical re-upload be recognized as a true
    # duplicate and skipped, instead of always blindly overwriting.
    existing = {}
    for date_s, time_s in {(k[0], k[1]) for k in by_key}:
        for r in conn.execute(
            f"SELECT {','.join(all_cols)} FROM cell_group_hourly WHERE date=? AND time=?", (date_s, time_s)
        ):
            existing[(r[0], r[1], r[2])] = tuple(r)

    to_write = []
    dup_keys = []
    new_count = 0
    changed_count = 0
    for key, vals in by_key.items():
        prev = existing.get(key)
        if prev is None:
            new_count += 1
            to_write.append(vals)
        elif prev == vals:
            dup_keys.append(key[2])  # already in the DB, identical -- do NOT write
        else:
            changed_count += 1
            to_write.append(vals)

    if to_write:
        conn.executemany(sql, to_write)
        conn.commit()
    hours_touched = sorted({f"{k[0]} {k[1][:5]}" for k in by_key})
    return {
        "unique_rows": len(by_key),
        "intra_file_duplicates": len(intra_dup_keys),
        "intra_file_duplicate_sample": intra_dup_keys[:5],
        "new_rows": new_count,
        "overwritten_rows": changed_count,
        "duplicate_rows": len(dup_keys),
        "duplicate_sample": dup_keys[:5],
        "hours_touched": hours_touched,
    }


def load_cell_level(conn, rows):
    cols = KPI_COLUMNS
    all_cols = ["date", "time", "enodeb_name", "fdd_tdd", "cell_name", "local_cell_id",
                "site_id", "band", "sector", "integrity"] + cols
    placeholders = ",".join(["?"] * len(all_cols))
    sql = f"""INSERT OR REPLACE INTO cell_level_hourly ({",".join(all_cols)})
              VALUES ({placeholders})"""
    by_key = {}
    intra_dup_keys = []
    for row in rows[1:]:
        row = _pad(row, 8 + len(cols))
        if not _has_date(row[0]) or _blank(row[4]):
            continue
        date_s = _cell(row[0])[:10]
        time_s = _cell(row[1])
        enodeb_name = row[2]
        fdd_tdd = row[3]
        cell_name = row[4]
        local_cell_id = _safe_int(row[5])
        enodeb_function_name = row[6]
        integrity = row[7]
        band, sector, _guess = band_sector(local_cell_id)
        site_id = derive_site_id(enodeb_function_name, enodeb_name)
        kpis = [_sanitize_kpi(x) for x in row[8:8 + len(cols)]]
        kpis = kpis + [None] * (len(cols) - len(kpis))
        key = (date_s, time_s, cell_name)
        if key in by_key:
            intra_dup_keys.append(cell_name)
        by_key[key] = (date_s, time_s, enodeb_name, fdd_tdd, cell_name,
                        local_cell_id, site_id, band, sector, integrity, *kpis)

    # Fetch the FULL existing row (every column) for every (date,time) this
    # upload touches, so a re-upload can be compared value-for-value against
    # what's already stored -- not just by key. A byte-identical re-upload
    # is recognized as a true duplicate and skipped entirely: it never
    # reaches INSERT OR REPLACE, so the database is not touched for it.
    existing = {}
    for date_s, time_s in {(k[0], k[1]) for k in by_key}:
        for r in conn.execute(
            f"SELECT {','.join(all_cols)} FROM cell_level_hourly WHERE date=? AND time=?", (date_s, time_s)
        ):
            existing[(r[0], r[1], r[4])] = tuple(r)  # r[4] = cell_name

    to_write = []
    dup_keys = []
    new_count = 0
    changed_count = 0
    for key, vals in by_key.items():
        prev = existing.get(key)
        if prev is None:
            new_count += 1
            to_write.append(vals)
        elif prev == vals:
            dup_keys.append(key[2])  # already in the DB, identical -- do NOT write
        else:
            changed_count += 1
            to_write.append(vals)

    for i in range(0, len(to_write), 5000):
        conn.executemany(sql, to_write[i:i + 5000])
    conn.commit()
    hours_touched = sorted({f"{k[0]} {k[1][:5]}" for k in by_key})
    return {
        "unique_rows": len(by_key),
        "intra_file_duplicates": len(intra_dup_keys),
        "intra_file_duplicate_sample": intra_dup_keys[:5],
        "new_rows": new_count,
        "overwritten_rows": changed_count,
        "duplicate_rows": len(dup_keys),
        "duplicate_sample": dup_keys[:5],
        "hours_touched": hours_touched,
    }


def ingest(path):
    t0 = _time.time()
    conn = init_db()
    wb = CalamineWorkbook.from_path(path)
    sheet_names = wb.sheet_names
    batch_id = uuid.uuid4().hex[:12]

    empty_stats = {"unique_rows": 0, "new_rows": 0, "overwritten_rows": 0, "duplicate_rows": 0,
                    "duplicate_sample": [], "intra_file_duplicates": 0,
                    "intra_file_duplicate_sample": [], "hours_touched": []}
    group_stats = dict(empty_stats)
    if "Cell_Group" in sheet_names:
        rows = wb.get_sheet_by_name("Cell_Group").to_python()
        group_stats = load_cell_group(conn, rows)
        # Log the upload attempt even when every row turned out to be an
        # already-ingested duplicate (rows_loaded=0) -- that's still useful
        # audit trail ("this was re-uploaded, correctly recognized as a
        # no-op") -- but the DB itself was not touched by those rows.
        conn.execute(
            "INSERT INTO ingestion_log (batch_id, source_file, sheet, rows_loaded, hours_touched) VALUES (?,?,?,?,?)",
            (batch_id, path, "Cell_Group", group_stats["new_rows"] + group_stats["overwritten_rows"],
             json.dumps(group_stats["hours_touched"])),
        )

    level_stats = dict(empty_stats)
    if "Cell_Level" in sheet_names:
        rows = wb.get_sheet_by_name("Cell_Level").to_python()
        level_stats = load_cell_level(conn, rows)
        conn.execute(
            "INSERT INTO ingestion_log (batch_id, source_file, sheet, rows_loaded, hours_touched) VALUES (?,?,?,?,?)",
            (batch_id, path, "Cell_Level", level_stats["new_rows"] + level_stats["overwritten_rows"],
             json.dumps(level_stats["hours_touched"])),
        )
    conn.commit()

    # rebuild query planner stats for the new data
    conn.execute("ANALYZE;")
    conn.commit()
    total_level = conn.execute("SELECT COUNT(*) FROM cell_level_hourly").fetchone()[0]
    conn.close()
    dt = _time.time() - t0

    msg = (f"Ingested {path} in {dt:.2f}s (batch {batch_id}) — "
           f"Cell_Group: {group_stats['new_rows']} new / {group_stats['overwritten_rows']} updated / "
           f"{group_stats['duplicate_rows']} duplicate (skipped, DB unchanged); "
           f"Cell_Level: {level_stats['new_rows']} new / {level_stats['overwritten_rows']} updated / "
           f"{level_stats['duplicate_rows']} duplicate (skipped, DB unchanged) "
           f"(total rows now {total_level})")
    if level_stats["intra_file_duplicates"] or group_stats["intra_file_duplicates"]:
        msg += (f"  [WARNING: {level_stats['intra_file_duplicates']} duplicate cell key(s) and "
                f"{group_stats['intra_file_duplicates']} duplicate group key(s) found WITHIN this "
                f"file — only the last occurrence of each was kept]")
    print(msg)

    return {
        "batch_id": batch_id,
        "rows_group": group_stats["new_rows"],
        "rows_group_overwritten": group_stats["overwritten_rows"],
        "rows_group_duplicate": group_stats["duplicate_rows"],
        "rows_level_total": total_level,
        "rows_level_delta": level_stats["new_rows"],
        "rows_level_overwritten": level_stats["overwritten_rows"],
        "rows_level_duplicate": level_stats["duplicate_rows"],
        "all_duplicate": (
            (group_stats["new_rows"] + group_stats["overwritten_rows"]
             + level_stats["new_rows"] + level_stats["overwritten_rows"]) == 0
            and (group_stats["duplicate_rows"] + level_stats["duplicate_rows"]) > 0
        ),
        "intra_file_duplicates": level_stats["intra_file_duplicates"] + group_stats["intra_file_duplicates"],
        "intra_file_duplicate_sample": (level_stats["intra_file_duplicate_sample"]
                                         or group_stats["intra_file_duplicate_sample"]),
        "seconds": round(dt, 2),
    }



if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run src/etl.py path/to/HourlyExport.xlsx")
        print("       (expects a Cell_Group and/or Cell_Level sheet, same layout as the original file)")
        sys.exit(1)
    ingest(sys.argv[1])
