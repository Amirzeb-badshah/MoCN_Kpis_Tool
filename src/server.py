# /// script
# requires-python = ">=3.10"
# dependencies = ["flask>=3.0", "python-calamine>=0.3"]
# ///
"""
Local server for the dashboard. Two things this does that plain
serve.py can't:
  1. Accepts an hourly Excel upload from the browser (POST /api/upload),
     runs it through the same etl.py + rebuild pipeline used by the CLI,
     and returns the fresh summary — all in-process, no subprocess.
  2. Serves the always-current output/network_insight_app.html.

Usage: uv run src/server.py [port]
Then open http://localhost:8000 (or the port you gave) and use the
"Upload Hourly Data" button in the dashboard header.
"""
import os
import sys
import tempfile
import threading
import urllib.request
import webbrowser

from flask import Flask, request, jsonify, send_from_directory, Response

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTPUT_DIR = os.path.join(ROOT, "output")
UPLOADS_DIR = os.path.join(ROOT, "data", "uploads")
TILE_CACHE_DIR = os.path.join(ROOT, "data", "tile_cache")

sys.path.insert(0, HERE)
import pipeline  # noqa: E402
import data_mgmt  # noqa: E402
import geometry_etl  # noqa: E402
import queries  # noqa: E402

app = Flask(__name__)

ALLOWED_EXT = {".xlsx"}


@app.route("/")
def index():
    # This file gets rewritten by every rebuild (upload, or a dev change
    # like the Road Time-Lapse work) while the server keeps running --
    # explicitly forbid caching it, so a plain reload always shows the
    # current build instead of a stale one the browser decided to reuse.
    resp = send_from_directory(OUTPUT_DIR, "network_insight_app.html")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(OUTPUT_DIR, filename)


@app.route("/api/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if f is None or f.filename == "":
        return jsonify({"error": "no file received"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"expected an .xlsx file, got '{ext}'"}), 400

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    # keep every uploaded file for audit/traceability, timestamped so
    # re-uploads of the same hour don't clobber each other on disk
    import datetime
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = f"{stamp}_{os.path.basename(f.filename)}"
    save_path = os.path.join(UPLOADS_DIR, safe_name)
    f.save(save_path)

    try:
        summary = pipeline.rebuild(save_path)
    except Exception as e:
        return jsonify({"error": f"ingestion failed: {e}"}), 500

    return jsonify(summary), 200


@app.route("/api/upload_geometry", methods=["POST"])
def upload_geometry():
    f = request.files.get("file")
    if f is None or f.filename == "":
        return jsonify({"error": "no file received"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"expected an .xlsx file, got '{ext}'"}), 400

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    import datetime
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = f"{stamp}_geometry_{os.path.basename(f.filename)}"
    save_path = os.path.join(UPLOADS_DIR, safe_name)
    f.save(save_path)

    try:
        result = geometry_etl.ingest_geometry(save_path)
    except Exception as e:
        return jsonify({"error": f"ingestion failed: {e}"}), 500

    if "error" in result:
        return jsonify(result), 400
    return jsonify(result), 200


# Customer-specified password for the header's "Delete Data" button.
# Checked here on the server, not just in the page, so the wipe can't be
# triggered by calling the endpoint directly without it.
DELETE_DATA_PASSWORD = "1234"


@app.route("/api/delete_all_data", methods=["POST"])
def delete_all_data():
    body = request.get_json(silent=True) or {}
    if body.get("password") != DELETE_DATA_PASSWORD:
        return jsonify({"error": "incorrect password"}), 403
    try:
        result = data_mgmt.delete_all_data()
        result["rebuild"] = pipeline.rebuild()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(result), 200


@app.route("/api/cell_series", methods=["GET"])
def cell_series():
    # Row-click charts in Cell Level Analysis. The bundle only pre-fetches
    # series for cells flagged under the DEFAULT degradation thresholds;
    # once the thresholds are adjusted in the page, newly flagged cells
    # are fetched from here instead.
    cell = request.args.get("cell")
    if not cell:
        return jsonify({"error": "cell is required"}), 400
    try:
        return jsonify(queries.cell_hourly_series(cell)), 200
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500


@app.route("/api/uploads", methods=["GET"])
def uploads_list():
    try:
        return jsonify(data_mgmt.list_uploads()), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/uploads/<batch_id>/delete", methods=["POST"])
def uploads_delete(batch_id):
    try:
        result = data_mgmt.delete_upload(batch_id)
        if "error" in result:
            return jsonify(result), 404
        rebuild_summary = pipeline.rebuild()
        result["rebuild"] = rebuild_summary
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/site_kpis", methods=["GET"])
def site_kpis():
    site = request.args.get("site")
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not site or not from_date or not to_date:
        return jsonify({"error": "site, from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        data = queries.site_kpi_detail(site, from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify(data), 200


@app.route("/api/sector_kpis", methods=["GET"])
def sector_kpis():
    site = request.args.get("site")
    sector = request.args.get("sector")
    band = request.args.get("band") or None
    if not site or not sector:
        return jsonify({"error": "site and sector are required"}), 400
    try:
        data = queries.sector_kpi_detail(site, sector, days=3, band=band)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify(data), 200


@app.route("/api/traffic_balance", methods=["GET"])
def traffic_balance():
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not from_date or not to_date:
        return jsonify({"error": "from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        rows = queries.traffic_balancing_range(from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/l2600_hot_sectors", methods=["GET"])
def l2600_hot_sectors_endpoint():
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not from_date or not to_date:
        return jsonify({"error": "from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        rows = queries.l2600_hot_sectors_range(from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/ta_by_sector", methods=["GET"])
def ta_by_sector_endpoint():
    site = request.args.get("site")
    sector = request.args.get("sector")
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not site or not sector or not from_date or not to_date:
        return jsonify({"error": "site, sector, from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        rows = queries.ta_by_sector_range(site, sector, from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/ta_by_site", methods=["GET"])
def ta_by_site_endpoint():
    site = request.args.get("site")
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not site or not from_date or not to_date:
        return jsonify({"error": "site, from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        rows = queries.ta_by_site_range(site, from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/busy_hour_report", methods=["GET"])
def busy_hour_report_endpoint():
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "20")
    to_hour = request.args.get("to_hour", "23")
    min_active_users = request.args.get("min_active_users", "1")
    if not from_date or not to_date:
        return jsonify({"error": "from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
        min_active_users = float(min_active_users)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour/min_active_users must be numeric"}), 400
    try:
        rows = queries.busy_hour_report(from_date, to_date, from_hour, to_hour, min_active_users=min_active_users)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/geo_congestion", methods=["GET"])
def geo_congestion_endpoint():
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    from_hour = request.args.get("from_hour", "0")
    to_hour = request.args.get("to_hour", "23")
    if not from_date or not to_date:
        return jsonify({"error": "from_date and to_date are required"}), 400
    try:
        from_hour = int(from_hour)
        to_hour = int(to_hour)
    except ValueError:
        return jsonify({"error": "from_hour/to_hour must be integers"}), 400
    try:
        rows = queries.geo_congestion_range(from_date, to_date, from_hour, to_hour)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/road_hourly", methods=["GET"])
def road_hourly_endpoint():
    date = request.args.get("date")
    cells_param = request.args.get("cells", "")
    cell_names = [c for c in cells_param.split(",") if c]
    if not date:
        return jsonify({"error": "date is required"}), 400
    if not cell_names:
        return jsonify({"error": "cells is required (comma-separated cell names)"}), 400
    if len(cell_names) > 500:
        return jsonify({"error": "too many cells (max 500) -- draw a shorter road or use a tighter buffer"}), 400
    try:
        rows = queries.geo_road_hourly(cell_names, date)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"rows": rows}), 200


@app.route("/api/network_hourly", methods=["GET"])
def network_hourly_endpoint():
    date = request.args.get("date")
    if not date:
        return jsonify({"error": "date is required"}), 400
    try:
        cells = queries.geo_network_hourly(date)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}"}), 500
    return jsonify({"cells": cells}), 200


# Proxies OpenStreetMap raster tiles through OUR OWN origin, on-disk cached.
# The Road Time-Lapse export needs the basemap baked into a <canvas> (so it
# ends up in the recorded video, not just the on-screen preview) --
# drawImage()-ing a tile fetched directly from tile.openstreetmap.org would
# taint the canvas (no CORS headers on that response), which silently
# blocks captureStream()/MediaRecorder from reading it back. Re-serving the
# same bytes from localhost sidesteps that entirely, since the browser then
# sees it as same-origin. The on-disk cache means a re-generated time-lapse
# over the same area doesn't refetch, and a proper User-Agent identifies
# this app to OSM's tile servers, per their usage policy.
@app.route("/api/tile/<int:z>/<int:x>/<int:y>.png")
def tile_proxy(z, x, y):
    cache_path = os.path.join(TILE_CACHE_DIR, str(z), str(x), f"{y}.png")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            return Response(f.read(), mimetype="image/png")
    subdomain = "abc"[(x + y) % 3]
    url = f"https://{subdomain}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers={
        "User-Agent": "network-insight-app/1.0 (internal RF analytics tool -- Road Time-Lapse export)"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
    except Exception as e:
        return jsonify({"error": f"tile fetch failed: {e}"}), 502
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "wb") as f:
        f.write(data)
    return Response(data, mimetype="image/png")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    url = f"http://localhost:{port}/"
    print(f"Serving the dashboard at {url}")
    print("Use the 'Upload Hourly Data' button in the header to ingest a new hourly file.")
    print("Press Ctrl+C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()
