# Dataset verification (DATA fills this in on Saturday morning)

Check each dataset in NASA's CMR (https://cmr.earthdata.nasa.gov) or Earthdata Search before ingesting. Record what you actually found.

| Variable id | Short name (planned) | Short name (verified) | Version | Variable name | Units | Time range | Access used | Checked by / when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| merra2_t2m | M2TMNXSLV | M2TMNXSLV 5.12.4 | 5.12.4 | T2M (2 m air temperature) | K | Kumasi series 2005-01 to 2025-12; collection 1980-01 to 2025-12 (552 monthly granules in CMR) | Giovanni area-averaged export (Kumasi); Earthdata cloud OPeNDAP subset (West Africa grid) | Backend team / 2026-11-14 |
| gpm_precip | GPM_3IMERGM | GPM_3IMERGM | 07 | precipitation (`/Grid/precipitation`, dimensions time, lon, lat) | mm/hr | 2000-06 to 2025-09 (304 monthly granules in CMR on 2026-11-14; later Final Run months not yet published) | Earthdata cloud OPeNDAP subset (West Africa grid) | Backend / 2026-11-14 |
| modis_ndvi | MOD13C2 | | | | | | | |
| (SHOULD) modis_lst | MOD11C3 | | | | | | | |
| (SHOULD) omi_no2 | OMNO2d | | | | | | | |
| fallback | NASA POWER T2M / PRECTOTCORR | | n/a | | | | | |

## Ground-station check (SHOULD)

Nearest NOAA Climate Data Online station to Kumasi: name, ID, years available, and how its trend compares with MERRA-2.

## NASA metadata checked

- The NASA Earthdata landing page identifies collection M2TMNXSLV as MERRA-2 monthly mean single-level diagnostics, version 5.12.4, and lists T2M units as K. Source: https://doi.org/10.5067/AP1B0BA5PD2K (checked 2026-11-14).
- MERRA-2 OPeNDAP metadata (DMR) for one granule: `T2M` is Float32 with dimensions (time 1, lat 361, lon 576), units `K`, `_FillValue` and `missing_value` 9.99999987e+14. Source: https://opendap.earthdata.nasa.gov/collections/C1276812859-GES_DISC/granules/M2TMNXSLV.5.12.4%3AMERRA2_200.tavgM_2d_slv_Nx.200001.nc4.dmr (checked 2026-11-14).
- GPM IMERG OPeNDAP metadata (DMR) for one granule: `/Grid/precipitation` is Float32 with dimensions (time 1, lon 3600, lat 1800), units `mm/hr`, `_FillValue` -9999.9, LongName "Merged microwave-infrared-gauge precipitation estimate". Source: https://opendap.earthdata.nasa.gov/collections/C2723754851-GES_DISC/granules/GPM_3IMERGM.07%3A3B-MO.MS.MRG.3IMERG.20000601-S000000-E235959.06.V07B.HDF5.dmr (checked 2026-11-14).
- CMR collection GPM_3IMERGM version 07: "GPM IMERG Final Precipitation L3 1 month 0.1 degree x 0.1 degree V07 (GPM_3IMERGM)", DOI 10.5067/GPM/IMERG/3B-MONTH/07. Source: https://cmr.earthdata.nasa.gov/search/collections.umm_json?short_name=GPM_3IMERGM&version=07 (checked 2026-11-14).
- CMR granule counts and sizes: M2TMNXSLV 5.12.4 has 552 monthly granules for 1980-01 to 2025-12 (about 30.8 GB as whole files); GPM_3IMERGM 07 has 304 monthly granules, 2000-06 to 2025-09, when queried for 2000-06 to 2025-12 (about 5.3 GB). Source: https://cmr.earthdata.nasa.gov/search/granules.json (checked 2026-11-14).
- **Not verified:** whether the monthly GPM `precipitation` value is a mean rate over the month. Neither the DMR nor the CMR abstract says so, so it is not converted to mm/month. The grid uses mm/day (the same rate multiplied by 24); see DECISIONS #30.
- The provided Giovanni export identifies the requested variable as `M2TMNXSLV_5_12_4_T2M` and records the user bounding box `-1.8,6.55,-1.45,6.85`; its reproducibility URL is in the CSV metadata. File supplied by the human and retrieved 2026-11-14. NASA Giovanni documents the bbox order as west, south, east, north: https://giovanni.gsfc.nasa.gov/giovanni/doc/UsersManualworkingdocument.docx.html (checked 2026-11-14).
