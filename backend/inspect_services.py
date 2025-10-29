import json
import requests

SERVICES = {
    "imagery2023": "https://maps.es.govt.nz/arcgis/rest/services/Imagery/ImageCache2023/MapServer?f=json",
    "slope": "https://maps.es.govt.nz/arcgis/rest/services/LiDAR/LiDAR_2021_2023_Southland_SLOPE/ImageServer?f=json",
    "landuse": "https://maps.es.govt.nz/server/rest/services/Public/Landuse/MapServer?f=json",
    "general": "https://maps.es.govt.nz/server/rest/services/Public/General/MapServer?f=json"
}

for name, url in SERVICES.items():
    print("Checking", name)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    print("singleFusedMapCache:", data.get("singleFusedMapCache"))
    print("tileInfo present:", "tileInfo" in data)
    if "tileInfo" in data:
        print(" first LOD entries:")
        for lod in data["tileInfo"].get("lods", [])[:3]:
            print("  ", lod)
    else:
        print(" supportedImageFormatTypes:", data.get("supportedImageFormatTypes"))
    print("---")
