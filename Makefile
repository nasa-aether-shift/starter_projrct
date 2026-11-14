.PHONY: setup test api seed web lint

setup:
	pip install numpy scipy pandas pyyaml pymannkendall pytest fastapi "uvicorn[standard]" "pydantic>=2" httpx requests earthaccess xarray h5netcdf netCDF4

test:
	cd packages/stats_engine && python3 -m pytest -q
	cd apps/api && python3 -m pytest -q

api:
	cd apps/api && uvicorn app.main:app --reload --port 8000

seed:
	python3 pipelines/ingest/seed.py

web:
	cd apps/web && npm run dev

lint:
	ruff check packages apps/api pipelines || true
