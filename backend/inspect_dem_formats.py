import requests

DEM_INFO_URL = "https://maps.es.govt.nz/image/rest/services/LiDAR/Southland_2021_2023_NZVD2016_DEM/ImageServer?f=json"

resp = requests.get(DEM_INFO_URL, timeout=30)
resp.raise_for_status()
info = resp.json()
print("supportedImageFormatTypes:", info.get("supportedImageFormatTypes"))
print("defaultMosaicMethod:", info.get("defaultMosaicMethod"))
print("singleFusedMapCache:", info.get("singleFusedMapCache"))
