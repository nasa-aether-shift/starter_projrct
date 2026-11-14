.PHONY: setup test api seed web lint

VENV ?= $(HOME)/.venvs/earth-data-detective
PYTHON ?= $(shell if [ -x $(VENV)/bin/python3 ]; then echo $(VENV)/bin/python3; else which python3; fi)

setup:
	pip install numpy scipy pandas pyyaml pymannkendall pytest fastapi "uvicorn[standard]" "pydantic>=2" httpx requests earthaccess xarray h5netcdf netCDF4

test:
	cd packages/stats_engine && $(PYTHON) -m pytest -q
	cd apps/api && $(PYTHON) -m pytest -q

api:
	cd apps/api && uvicorn app.main:app --reload --port 8000

seed:
	$(PYTHON) pipelines/ingest/seed.py

web:
	cd apps/web && npm run dev

lint:
	ruff check packages apps/api pipelines || true
