"""
Backend for the Data Management tab: lists uploads (grouped by the
batch_id assigned at ingest time) and lets one be deleted.

Deletion model: deleting a batch removes every row for the exact hours
that batch touched, from whichever table(s) it touched (Cell_Group ->
cell_group_hourly, Cell_Level -> cell_level_hourly) -- not just the
rows that specific batch added. If a later upload also touched one of
those hours, that hour's current data (regardless of which upload it
came from) is removed too. list_uploads() reports this overlap up
front so it's a visible choice, not a silent side effect.
"""
import json
import sqlite3
from schema import init_db

SHEET_TABLE = {
    "Cell_Group": "cell_group_hourly",
    "Cell_Level": "cell_level_hourly",
}


def _conn():
    # init_db() is idempotent (CREATE TABLE IF NOT EXISTS + additive
    # migration) and cheap to call on every connection -- guarantees
    # ingestion_log has batch_id/hours_touched even if this is the
    # first thing touching the database this run (e.g. opening the
    # Data Management tab before ever uploading).
    c = init_db()
    c.row_factory = sqlite3.Row
    return c


def list_uploads():
    """One row per batch_id, combining its Cell_Group + Cell_Level log
    entries. Flags whether any hour it touched has since been touched
    by a *later* batch too (so deleting this one wouldn't just be
    undoing itself)."""
    c = _conn()
    rows = c.execute("""
        SELECT batch_id, source_file, sheet, rows_loaded, hours_touched, ingested_at, id
        FROM ingestion_log
        WHERE batch_id IS NOT NULL
        ORDER BY ingested_at DESC, id DESC
    """).fetchall()

    batches = {}
    order = []
    for r in rows:
        bid = r["batch_id"]
        if bid not in batches:
            batches[bid] = {
                "batch_id": bid,
                "source_file": r["source_file"].split("/")[-1] if r["source_file"] else "",
                "ingested_at": r["ingested_at"],
                "sheets": [],
                "rows_loaded_total": 0,
                "hours": {},  # sheet -> list of hours
            }
            order.append(bid)
        b = batches[bid]
        b["sheets"].append(r["sheet"])
        b["rows_loaded_total"] += r["rows_loaded"] or 0
        try:
            hrs = json.loads(r["hours_touched"]) if r["hours_touched"] else []
        except (json.JSONDecodeError, TypeError):
            hrs = []
        b["hours"][r["sheet"]] = hrs
        # earliest ingested_at wins if the two sheet-rows differ by a second
        if r["ingested_at"] and (not b["ingested_at"] or r["ingested_at"] < b["ingested_at"]):
            b["ingested_at"] = r["ingested_at"]

    # overlap check: for each batch, has any hour it touched also been
    # touched by a batch ingested *later*?
    result = []
    for bid in order:
        b = batches[bid]
        overlap_sheets = []
        for sheet, hrs in b["hours"].items():
            if not hrs:
                continue
            table = SHEET_TABLE.get(sheet)
            if not table:
                continue
            for h in hrs:
                date_s, time_s = h.split(" ")
                later = c.execute(
                    f"""SELECT COUNT(*) FROM ingestion_log
                        WHERE sheet=? AND batch_id != ? AND hours_touched LIKE ?
                        AND ingested_at > (SELECT MIN(ingested_at) FROM ingestion_log WHERE batch_id=?)""",
                    (sheet, bid, f'%"{date_s} {time_s}"%', bid),
                ).fetchone()[0]
                if later > 0 and sheet not in overlap_sheets:
                    overlap_sheets.append(sheet)
        result.append({
            "batch_id": bid,
            "source_file": b["source_file"],
            "ingested_at": b["ingested_at"],
            "sheets": sorted(set(b["sheets"])),
            "rows_loaded_total": b["rows_loaded_total"],
            "hours_touched": {s: hrs for s, hrs in b["hours"].items() if hrs},
            "overlaps_later_upload": overlap_sheets,
        })
    c.close()
    return result


def delete_upload(batch_id):
    """Delete every row this batch's hours cover, from the tables it
    touched, plus its own log entries. Returns a summary of what was
    removed."""
    c = _conn()
    log_rows = c.execute(
        "SELECT sheet, hours_touched FROM ingestion_log WHERE batch_id=?", (batch_id,)
    ).fetchall()
    if not log_rows:
        c.close()
        return {"error": f"no upload found with batch_id={batch_id}"}

    deleted = {}
    for r in log_rows:
        sheet = r["sheet"]
        table = SHEET_TABLE.get(sheet)
        if not table:
            continue
        try:
            hrs = json.loads(r["hours_touched"]) if r["hours_touched"] else []
        except (json.JSONDecodeError, TypeError):
            hrs = []
        n_deleted = 0
        for h in hrs:
            date_s, time_s = h.split(" ")
            cur = c.execute(
                f"DELETE FROM {table} WHERE date=? AND time=?",
                (date_s, f"{time_s}:00"),
            )
            n_deleted += cur.rowcount
        deleted[sheet] = deleted.get(sheet, 0) + n_deleted

    c.execute("DELETE FROM ingestion_log WHERE batch_id=?", (batch_id,))
    c.commit()
    c.execute("ANALYZE;")
    c.commit()
    c.close()
    return {"batch_id": batch_id, "deleted_rows_by_sheet": deleted}


# Every table that holds ingested data. The header's single "Delete Data"
# button empties all of them -- hourly KPIs, cell geometry, neighbor
# relations and the upload log -- so the dashboard starts from nothing.
# The original Excel files in data/uploads are deliberately NOT touched:
# they're the audit trail, and re-uploading them restores the data.
ALL_DATA_TABLES = [
    "cell_group_hourly",
    "cell_level_hourly",
    "cell_geometry",
    "cells_db",
    "ingestion_log",
]


def delete_all_data():
    """Empty every data table, then VACUUM so the multi-GB database file
    actually shrinks (a plain DELETE only marks pages free). Returns the
    number of rows removed per table."""
    c = _conn()
    deleted = {}
    for table in ALL_DATA_TABLES:
        deleted[table] = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        c.execute(f"DELETE FROM {table}")
    c.commit()
    c.execute("VACUUM;")
    c.execute("ANALYZE;")
    c.commit()
    c.close()
    return {"deleted_rows_by_table": deleted}
