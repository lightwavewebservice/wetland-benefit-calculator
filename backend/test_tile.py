import requests

urls = {
    "imagery": "https://maps.es.govt.nz/arcgis/rest/services/Imagery/ImageCache2023/MapServer/tile/12/1980/3983",
    "slope": "https://maps.es.govt.nz/arcgis/rest/services/LiDAR/LiDAR_2021_2023_Southland_SLOPE/ImageServer/tile/12/1980/3983",
    "landuse": "https://maps.es.govt.nz/server/rest/services/Public/Landuse/MapServer/tile/12/1980/3983",
    "general": "https://maps.es.govt.nz/server/rest/services/Public/General/MapServer/tile/12/1980/3983",
}

for name, url in urls.items():
    try:
        resp = requests.get(url, timeout=30)
        print(name, resp.status_code, resp.headers.get("Content-Type"))
        print(resp.text[:100])
    except Exception as exc:
        print(name, "error", exc)
