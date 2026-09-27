# /// script
# requires-python = ">=3.10"
# dependencies = ["python-calamine>=0.3"]
# ///
"""
Rebuilds the dashboard from whatever is currently in the database
(re-runs every aggregation query, re-assembles the HTML). Run this
after ingesting new hourly data:

    uv run src/etl.py path/to/NewHourly.xlsx
    uv run src/build.py

Or skip both steps and use the upload button instead:

    uv run src/server.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pipeline  # noqa: E402


def main():
    print("Rebuilding output/bundle.json and output/network_insight_app.html...")
    result = pipeline.rebuild()
    print(f"Done. Latest hour: {result['latest_hour']} — {result['n_sites']} sites, {result['n_cells']} cells.")
    print("Open output/network_insight_app.html or run: uv run src/serve.py")


if __name__ == "__main__":
    main()
