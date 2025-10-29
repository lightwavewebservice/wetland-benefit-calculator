from pathlib import Path

from app.services.dem_fetcher import fetch_dem_from_arcgis, _compose_url_and_params

polygon = {
    "type": "Polygon",
    "coordinates": [
        [
            [168.32, -46.14],
            [168.34, -46.14],
            [168.34, -46.13],
            [168.32, -46.13],
            [168.32, -46.14],
        ]
    ],
}

if __name__ == "__main__":
    url = "https://maps.es.govt.nz/image/rest/services/LiDAR/Southland_2021_2023_NZVD2016_DEM/ImageServer/export"
    base_url, params = _compose_url_and_params(url, {})
    print("Base URL:", base_url)
    print("Params:", params)

    try:
        out_path = fetch_dem_from_arcgis(
            image_service_url=url,
            polygon_geojson=polygon,
            output_path=Path("sample_data/test_remote_dem.tif"),
            width=512,
            height=512,
        )
        print(f"Fetched DEM to: {out_path}")
    except Exception as exc:
        print(f"Fetch failed: {exc}")
