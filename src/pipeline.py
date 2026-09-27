"""
Single place that knows how to go from "a new hourly Excel file" to
"the dashboard is up to date". Used by:
  - build.py          (CLI: uv run src/build.py)
  - server.py          (the /api/upload endpoint, in-process, no subprocess)
"""
import json
import os

import etl
import build_bundle
import build_html
import queries
from schema import init_db

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTPUT_DIR = os.path.join(ROOT, "output")


def rebuild(xlsx_path=None):
    """If xlsx_path is given, ingest it first. Either way, re-run every
    aggregation query and regenerate the dashboard HTML. Returns a small
    summary dict describing what happened (used for the upload API
    response and for CLI logging)."""
    ingest_summary = None
    if xlsx_path:
        ingest_summary = etl.ingest(xlsx_path)

    # After "Delete Data" (or on a brand-new install) there are no hours at
    # all -- every query in build_bundle assumes at least one, so render a
    # dedicated empty page (header + upload buttons) instead.
    init_db().close()
    if queries.available_hours():
        bundle = build_bundle.build()
        render = build_html.render
    else:
        bundle = {"meta": {"empty": True, "latest_date": None, "latest_time": "",
                           "n_sites": 0, "n_cells": 0}}
        render = build_html.render_empty
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    # encoding="utf-8" is required here, not optional -- Python's default
    # text-mode open() on Windows uses the system codepage (cp1252 for a
    # typical Western install), not UTF-8. Both files legitimately contain
    # multi-byte UTF-8 characters (em/en dashes, >=/<=, cell/site names),
    # and writing/reading those through the wrong codepage silently mangles
    # them into mojibake (e.g. an em dash "—" becomes "â€"") rather than
    # raising an error -- this was live and visible throughout the app.
    with open(os.path.join(OUTPUT_DIR, "bundle.json"), "w", encoding="utf-8") as f:
        json.dump(bundle, f, default=str)

    html = render(bundle)
    with open(os.path.join(OUTPUT_DIR, "network_insight_app.html"), "w", encoding="utf-8") as f:
        f.write(html)

    summary = {
        "latest_hour": f"{bundle['meta']['latest_date']} {bundle['meta']['latest_time'][:5]}" if bundle["meta"]["latest_date"] else None,
        "n_sites": bundle["meta"]["n_sites"],
        "n_cells": bundle["meta"]["n_cells"],
    }
    if ingest_summary:
        summary.update(ingest_summary)
    else:
        summary.update({
            "rows_group": None, "rows_group_overwritten": None, "rows_group_duplicate": None,
            "rows_level_delta": None, "rows_level_overwritten": None, "rows_level_duplicate": None,
            "all_duplicate": False,
            "intra_file_duplicates": 0, "intra_file_duplicate_sample": [],
        })
    return summary


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else None
    result = rebuild(path)
    print("Rebuild complete:", result)
