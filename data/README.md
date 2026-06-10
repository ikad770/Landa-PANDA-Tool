# PANDA data directory

- `raw/` is for local uploads copied by the development API.
- `processed/` is for DuckDB databases and generated Parquet partitions.

Runtime data in both folders is ignored by Git. Do not commit `.duckdb`, `.db`, or `.parquet` files.
