"""Terrain analysis utilities for the Wetland Benefit Calculator."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

import geopandas as gpd
import numpy as np
import rasterio
from affine import Affine
from rasterio import mask as rio_mask
from shapely.geometry import mapping, shape

logger = logging.getLogger(__name__)


D8_DIRECTIONS: Tuple[Tuple[int, int, float], ...] = (
    (-1, 0, 1.0),  # N
    (-1, 1, 2 ** 0.5),  # NE
    (0, 1, 1.0),  # E
    (1, 1, 2 ** 0.5),  # SE
    (1, 0, 1.0),  # S
    (1, -1, 2 ** 0.5),  # SW
    (0, -1, 1.0),  # W
    (-1, -1, 2 ** 0.5),  # NW
)


@dataclass(slots=True)
class TerrainAnalysisResult:
    """Collection of intermediate terrain layers and statistics."""

    wetland_area_ha: float
    catchment_area_ha: float
    mean_slope_deg: float
    max_slope_deg: float
    ls_factor: float
    cell_size: float
    transform: Affine
    crs: str
    dem_array: np.ndarray
    slope_array: np.ndarray
    flow_accum_array: np.ndarray
    ls_array: np.ndarray
    mask_array: np.ndarray
    clipped_dem_path: Path
    slope_raster_path: Path
    flow_accum_raster_path: Path

    def summary(self) -> Dict[str, Any]:
        """Return a JSON-serialisable summary, excluding heavy arrays."""

        return {
            "wetland_area_ha": self.wetland_area_ha,
            "catchment_area_ha": self.catchment_area_ha,
            "mean_slope_deg": self.mean_slope_deg,
            "max_slope_deg": self.max_slope_deg,
            "ls_factor": self.ls_factor,
            "cell_size": self.cell_size,
            "crs": self.crs,
            "clipped_dem_path": str(self.clipped_dem_path),
            "slope_raster_path": str(self.slope_raster_path),
            "flow_accum_raster_path": str(self.flow_accum_raster_path),
        }


def analyze_terrain(
    dem_path: Path,
    polygon_geojson: Dict[str, Any],
    *,
    job_id: str,
    output_dir: Path,
) -> TerrainAnalysisResult:
    """Clip DEM to wetland polygon, derive slope, flow accumulation, and LS factors."""

    polygon = _load_polygon(polygon_geojson)

    with rasterio.open(dem_path) as src:
        dem_crs = src.crs
        if dem_crs is None:
            raise ValueError("DEM is missing CRS information")

        gdf = gpd.GeoDataFrame(geometry=[polygon], crs="EPSG:4326")
        if gdf.crs != dem_crs:
            gdf = gdf.to_crs(dem_crs)

        polygon_dem = gdf.geometry.iloc[0]
        clipped_array, clipped_transform = rio_mask.mask(
            src,
            [mapping(polygon_dem)],
            crop=True,
            filled=True,
            nodata=src.nodata if src.nodata is not None else float(np.nan),
        )

        dem_data = clipped_array.astype("float64")[0]
        nodata = src.nodata if src.nodata is not None else np.nan
        mask_array = np.isnan(dem_data) if np.isnan(nodata) else dem_data == nodata

    cell_size = float(abs(clipped_transform.a))

    clipped_path = output_dir / f"{job_id}_dem.tif"
    slope_path = output_dir / f"{job_id}_slope.tif"
    flow_path = output_dir / f"{job_id}_flow_accum.tif"

    _write_raster(clipped_path, dem_data, clipped_transform, dem_crs, mask_array)

    slope_array, flow_accum_array = _derive_surface_metrics(
        dem_data=dem_data,
        mask_array=mask_array,
        cell_size=cell_size,
        transform=clipped_transform,
        crs=dem_crs,
        clipped_path=clipped_path,
        slope_path=slope_path,
        flow_path=flow_path,
    )

    ls_array = _compute_ls_factor(slope_array, flow_accum_array, cell_size)

    mean_slope = float(np.nanmean(np.where(mask_array, np.nan, slope_array)))
    max_slope = float(np.nanmax(np.where(mask_array, np.nan, slope_array)))
    ls_factor = float(np.nanmean(np.where(mask_array, np.nan, ls_array)))

    wetland_area_ha = float(gdf.to_crs(epsg=3857).area.iloc[0] / 10_000)
    catchment_area_ha = float(
        gdf.buffer(50).to_crs(epsg=3857).area.iloc[0] / 10_000
    )  # heuristic buffer-based catchment

    return TerrainAnalysisResult(
        wetland_area_ha=wetland_area_ha,
        catchment_area_ha=catchment_area_ha,
        mean_slope_deg=mean_slope,
        max_slope_deg=max_slope,
        ls_factor=ls_factor,
        cell_size=cell_size,
        transform=clipped_transform,
        crs=str(dem_crs),
        dem_array=dem_data,
        slope_array=slope_array,
        flow_accum_array=flow_accum_array,
        ls_array=ls_array,
        mask_array=mask_array,
        clipped_dem_path=clipped_path,
        slope_raster_path=slope_path,
        flow_accum_raster_path=flow_path,
    )


def _load_polygon(polygon_geojson: Dict[str, Any]):
    if polygon_geojson.get("type") == "FeatureCollection":
        if not polygon_geojson["features"]:
            raise ValueError("GeoJSON FeatureCollection must contain at least one feature")
        geometry = polygon_geojson["features"][0]["geometry"]
    elif polygon_geojson.get("type") == "Feature":
        geometry = polygon_geojson["geometry"]
    else:
        geometry = polygon_geojson

    geom = shape(geometry)
    if geom.is_empty:
        raise ValueError("Wetland polygon is empty")
    if geom.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Wetland geometry must be a Polygon")
    return geom


def _compute_slope(dem: np.ndarray, cell_size: float, mask: np.ndarray) -> np.ndarray:
    gy, gx = np.gradient(np.where(mask, np.nan, dem), cell_size)
    slope_rad = np.arctan(np.sqrt(gx ** 2 + gy ** 2))
    slope_deg = np.degrees(slope_rad)
    slope_deg[mask] = np.nan
    return slope_deg


def _compute_flow_accumulation(dem: np.ndarray, mask: np.ndarray) -> np.ndarray:
    dem_copy = np.where(mask, np.nan, dem)
    nrows, ncols = dem_copy.shape

    flow_dir = np.full((nrows, ncols), -1, dtype=np.int8)
    for r in range(nrows):
        for c in range(ncols):
            if np.isnan(dem_copy[r, c]):
                continue
            best_drop = 0.0
            best_dir = -1
            current = dem_copy[r, c]
            for idx, (dr, dc, dist) in enumerate(D8_DIRECTIONS):
                rr, cc = r + dr, c + dc
                if rr < 0 or cc < 0 or rr >= nrows or cc >= ncols:
                    continue
                if np.isnan(dem_copy[rr, cc]):
                    continue
                drop = (current - dem_copy[rr, cc]) / dist
                if drop > best_drop:
                    best_drop = drop
                    best_dir = idx
            flow_dir[r, c] = best_dir

    flat_indices = np.argsort(np.nan_to_num(dem_copy, nan=-np.inf).ravel())[::-1]
    flow_accum = np.ones_like(dem_copy)

    for index in flat_indices:
        r, c = divmod(index, ncols)
        if np.isnan(dem_copy[r, c]):
            flow_accum[r, c] = np.nan
            continue
        direction = flow_dir[r, c]
        if direction == -1:
            continue
        dr, dc, _ = D8_DIRECTIONS[direction]
        rr, cc = r + dr, c + dc
        if 0 <= rr < nrows and 0 <= cc < ncols and not np.isnan(dem_copy[rr, cc]):
            flow_accum[rr, cc] += flow_accum[r, c]

    flow_accum[mask] = np.nan
    return flow_accum


def _compute_ls_factor(slope_array: np.ndarray, flow_accum_array: np.ndarray, cell_size: float) -> np.ndarray:
    slope_rad = np.radians(slope_array)
    contributing_area = np.where(np.isnan(flow_accum_array), np.nan, flow_accum_array * cell_size)

    m = 0.4
    n = 1.3

    with np.errstate(divide="ignore", invalid="ignore"):
        ls = ((contributing_area / 22.13) ** m) * ((np.sin(slope_rad) / 0.0896) ** n)

    ls = np.where(np.isnan(slope_array), np.nan, ls)
    ls = np.clip(ls, 0, 1000)
    return ls


def _derive_surface_metrics(
    *,
    dem_data: np.ndarray,
    mask_array: np.ndarray,
    cell_size: float,
    transform: Affine,
    crs,
    clipped_path: Path,
    slope_path: Path,
    flow_path: Path,
) -> tuple[np.ndarray, np.ndarray]:
    """Derive slope and flow accumulation rasters using WhiteboxTools with numpy fallback."""

    if _run_whitebox(clipped_path=clipped_path, slope_path=slope_path, flow_path=flow_path):
        slope_array = _read_raster(slope_path)
        flow_array = _read_raster(flow_path)
        slope_array = np.where(mask_array, np.nan, slope_array)
        flow_array = np.where(mask_array, np.nan, flow_array)
        _write_raster(slope_path, slope_array, transform, crs, mask_array)
        _write_raster(flow_path, flow_array, transform, crs, mask_array)
        return slope_array, flow_array

    slope_array = _compute_slope(dem_data, cell_size, mask_array)
    flow_array = _compute_flow_accumulation(dem_data, mask_array)
    _write_raster(slope_path, slope_array, transform, crs, mask_array)
    _write_raster(flow_path, flow_array, transform, crs, mask_array)
    return slope_array, flow_array


def _run_whitebox(*, clipped_path: Path, slope_path: Path, flow_path: Path) -> bool:
    try:
        from whitebox import WhiteboxTools
    except ImportError:  # pragma: no cover - dependency optional in some environments
        logger.info("WhiteboxTools not available; falling back to numpy implementation")
        return False

    try:
        wbt = WhiteboxTools()
        wbt.set_working_dir(str(clipped_path.parent))
        wbt.set_verbose_mode(False)
        wbt.slope(dem=str(clipped_path), output=str(slope_path), units="degrees")
        wbt.d8_flow_accumulation(
            dem=str(clipped_path),
            output=str(flow_path),
            out_type="cells",
        )
        return slope_path.exists() and flow_path.exists()
    except Exception:  # pragma: no cover - not easily reproducible in tests
        logger.exception("WhiteboxTools slope/flow derivation failed; using numpy fallback")
        return False


def _read_raster(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        data = src.read(1).astype("float64")
        nodata = src.nodata

    if nodata is not None:
        data = np.where(data == nodata, np.nan, data)
    return data


def _write_raster(path: Path, data: np.ndarray, transform: Affine, crs, mask: np.ndarray) -> None:
    nan_mask = np.isnan(data)
    filled = np.where(nan_mask, -9999.0, data).astype("float32")

    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        transform=transform,
        crs=crs,
        nodata=-9999.0,
    ) as dst:
        dst.write(filled, 1)
        dst.write_mask((mask | nan_mask).astype("uint8") * 255)

    logger.debug("Wrote raster to %s", path)
