# Dataset verification (DATA fills this in on Saturday morning)

Check each dataset in NASA's CMR (https://cmr.earthdata.nasa.gov) or Earthdata Search before ingesting. Record what you actually found.

| Variable id | Short name (planned) | Short name (verified) | Version | Variable name | Units | Time range | Access used | Checked by / when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| merra2_t2m | M2TMNXSLV | M2TMNXSLV 5.12.4 | 5.12.4 | T2M (2 m air temperature) | K | 2005-01 to 2025-12 | Giovanni area-averaged export | Backend team / 2026-11-14 |
| gpm_precip | GPM_3IMERGM | | | precipitation? | mm/hr? | | | |
| modis_ndvi | MOD13C2 | | | | | | | |
| (SHOULD) modis_lst | MOD11C3 | | | | | | | |
| (SHOULD) omi_no2 | OMNO2d | | | | | | | |
| fallback | NASA POWER T2M / PRECTOTCORR | | n/a | | | | | |

## Ground-station check (SHOULD)

Nearest NOAA Climate Data Online station to Kumasi: name, ID, years available, and how its trend compares with MERRA-2.

## NASA metadata checked

- The NASA Earthdata landing page identifies collection M2TMNXSLV as MERRA-2 monthly mean single-level diagnostics, version 5.12.4, and lists T2M units as K. Source: https://doi.org/10.5067/AP1B0BA5PD2K (checked 2026-11-14).
- The provided Giovanni export identifies the requested variable as `M2TMNXSLV_5_12_4_T2M` and records the user bounding box `-1.8,6.55,-1.45,6.85`; its reproducibility URL is in the CSV metadata. File supplied by the human and retrieved 2026-11-14. NASA Giovanni documents the bbox order as west, south, east, north: https://giovanni.gsfc.nasa.gov/giovanni/doc/UsersManualworkingdocument.docx.html (checked 2026-11-14).
