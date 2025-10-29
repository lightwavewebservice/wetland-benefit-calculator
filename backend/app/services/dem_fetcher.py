"""Utilities for fetching DEM clips from remote image services."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Tuple
from urllib.parse import parse_qsl, urlparse, urlunparse

import requests
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform

logger = logging.getLogger(__name__)


def fetch_dem_from_arcgis(
    *,
    image_service_url: str,
    polygon_geojson: Dict[str, Any],
    output_path: Path,
    width: int = 512,
    height: int = 512,
    target_epsg: int = 2193,
    buffer: float = 0.0,
    format: str | None = "tiff",
    pixel_type: str | None = None,
) -> Path:
    """Fetch a clipped DEM from an ArcGIS ImageServer export endpoint."""

    polygon = _load_polygon(polygon_geojson)
    projected_polygon = _project_polygon(polygon, target_epsg)
    if buffer > 0:
        projected_polygon = projected_polygon.buffer(buffer)

    minx, miny, maxx, maxy = projected_polygon.bounds
    bbox = f"{minx},{miny},{maxx},{maxy}"

    params = {
        "f": "image",
        "bbox": bbox,
        "bboxSR": target_epsg,
        "imageSR": target_epsg,
        "size": f"{width},{height}",
        "interpolation": "BILINEAR",
        "noData": "-9999",
    }

    if format:
        params["format"] = format.lower()

    if pixel_type:
        params["pixelType"] = pixel_type

    base_url, merged_params = _compose_url_and_params(image_service_url, params)

    logger.info(
        "Requesting DEM clip from %s (bbox=%s, size=%s)",
        base_url,
        bbox,
        merged_params.get("size"),
    )

    response = requests.get(base_url, params=merged_params, timeout=60)
    if response.status_code != 200:
        raise ValueError(
            f"Remote service returned status {response.status_code}: {response.text[:200]}"
        )

    content_type = response.headers.get("Content-Type", "").lower()
    if "application/json" in content_type:
        payload = response.json()
        message = payload.get("error", {}).get("message") or payload
        raise ValueError(f"Remote service error: {message}")

    if "image/tiff" not in content_type:
        logger.warning("Unexpected content type for DEM export: %s", content_type)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as destination:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                destination.write(chunk)

    if output_path.stat().st_size == 0:
        raise ValueError("Downloaded DEM file is empty")

    return output_path


def _compose_url_and_params(image_service_url: str, params: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    parsed = urlparse(image_service_url)
    base_params = dict(parse_qsl(parsed.query))

    path = parsed.path.rstrip("/")
    lower_path = path.lower()
    if lower_path.endswith("/exportimage"):
        normalized_path = path[:-len("/exportimage")] + "/exportImage"
    elif lower_path.endswith("/export"):
        normalized_path = path[:-len("/export")] + "/exportImage"
    else:
        normalized_path = f"{path}/exportImage"

    base_url = urlunparse(
        parsed._replace(path=normalized_path, params="", query="", fragment="")
    )

    merged_params = {**base_params, **params}
    return base_url, merged_params


def _load_polygon(polygon_geojson: Dict[str, Any]):
    if polygon_geojson.get("type") == "FeatureCollection":
        features = polygon_geojson.get("features", [])
        if not features:
            raise ValueError("GeoJSON FeatureCollection must contain at least one feature")
        geometry = features[0]["geometry"]
    elif polygon_geojson.get("type") == "Feature":
        geometry = polygon_geojson.get("geometry")
    else:
        geometry = polygon_geojson

    polygon = shape(geometry)
    if polygon.is_empty:
        raise ValueError("GeoJSON polygon is empty")
    if polygon.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Geometry must be Polygon or MultiPolygon")
    return polygon


def _project_polygon(polygon, target_epsg: int):
    if target_epsg == 4326:
        return polygon

    transformer = Transformer.from_crs(
        "EPSG:4326", f"EPSG:{target_epsg}", always_xy=True
    )
    return shapely_transform(transformer.transform, polygon)
