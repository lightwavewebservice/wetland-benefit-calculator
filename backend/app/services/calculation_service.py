"""Service layer that orchestrates terrain analysis, RUSLE modelling, and reporting."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from pydantic import BaseModel

from ..reports.report import generate_report
from .terrain import TerrainAnalysisResult, analyze_terrain
from .rusle_model import RusleInputs, RusleResult, calculate_rusle
from .dem_fetcher import fetch_dem_from_arcgis


class CalculationResult(BaseModel):
    """Container for the full calculation output passed back to the API layer."""

    wetland_name: str
    user_name: str | None
    area_hectares: float
    catchment_hectares: float
    average_slope: float
    summary: Dict[str, Any]
    efficiency_settings: Dict[str, float]
    output_raster_path: str
    report_path: str


@dataclass
class CalculationContext:
    """Internal scratchpad for sharing data between terrain, modelling, and reporting."""

    job_id: str
    dem_reference: str
    polygon_geojson: Dict[str, Any]
    output_dir: Path
    wetland_name: str
    user_name: str | None
    rainfall_factor: float
    soil_erodibility: float
    cover_before: float
    cover_after: float
    support_before: float
    support_after: float
    sediment_delivery_ratio: float
    efficiencies: Dict[str, float]


def run_wetland_calculation(
    *,
    job_id: str,
    dem_reference: str,
    polygon_geojson: Dict[str, Any],
    rainfall_factor: float,
    soil_erodibility: float,
    cover_before: float,
    cover_after: float,
    support_before: float,
    support_after: float,
    sediment_delivery_ratio: float,
    efficiencies: Dict[str, float],
    wetland_name: str,
    user_name: str | None,
    output_dir: Path,
) -> CalculationResult:
    """Execute the analysis pipeline and return the aggregated result."""

    ctx = CalculationContext(
        job_id=job_id,
        dem_reference=dem_reference,
        polygon_geojson=polygon_geojson,
        output_dir=output_dir,
        wetland_name=wetland_name,
        user_name=user_name,
        rainfall_factor=rainfall_factor,
        soil_erodibility=soil_erodibility,
        cover_before=cover_before,
        cover_after=cover_after,
        support_before=support_before,
        support_after=support_after,
        sediment_delivery_ratio=sediment_delivery_ratio,
        efficiencies=efficiencies,
    )

    try:
        dem_source_path = _prepare_dem(ctx)
        logger.info(f"Successfully prepared DEM at: {dem_source_path}")

        terrain = analyze_terrain(
            dem_source_path,
            ctx.polygon_geojson,
            job_id=ctx.job_id,
            output_dir=ctx.output_dir,
        )
        logger.info(f"Completed terrain analysis for job {ctx.job_id}")

        rusle_inputs = RusleInputs(
            rainfall_factor=ctx.rainfall_factor,
            soil_erodibility=ctx.soil_erodibility,
            ls_factor=terrain.ls_factor,
            cover_management_before=ctx.cover_before,
            cover_management_after=ctx.cover_after,
            support_practices_before=ctx.support_before,
            support_practices_after=ctx.support_after,
            sediment_delivery_ratio=ctx.sediment_delivery_ratio,
        )
        logger.info("Running RUSLE calculation...")

        rusle_result = calculate_rusle(
            rusle_inputs,
            ctx.efficiencies,
            output_dir=ctx.output_dir,
            job_id=ctx.job_id,
        )
        logger.info("RUSLE calculation completed successfully")

        summary_path = _write_summary(ctx, terrain, rusle_inputs, rusle_result)
        logger.info(f"Summary written to: {summary_path}")

        report_path = generate_report(
            template_name="wetland_report.html",
            output_dir=ctx.output_dir,
            job_id=ctx.job_id,
            wetland_name=ctx.wetland_name,
            user_name=ctx.user_name,
            summary_path=summary_path,
            output_raster=rusle_result.output_raster,
        )
        logger.info(f"Report generated at: {report_path}")

    except Exception as e:
        logger.exception(f"Error in run_wetland_calculation for job {ctx.job_id}")
        raise RuntimeError(f"Failed to complete calculation: {str(e)}") from e

    return CalculationResult(
        wetland_name=ctx.wetland_name,
        user_name=ctx.user_name,
        area_hectares=terrain.wetland_area_ha,
        catchment_hectares=terrain.catchment_area_ha,
        average_slope=terrain.mean_slope_deg,
        summary=rusle_result.summary,
        efficiency_settings=ctx.efficiencies,
        output_raster_path=rusle_result.output_raster,
        report_path=str(report_path),
    )


def _write_summary(
    ctx: CalculationContext,
    terrain: TerrainAnalysisResult,
    rusle_inputs: RusleInputs,
    rusle_result: RusleResult,
) -> Path:
    """Persist a JSON summary for report templating and front-end consumption."""

    summary_payload = {
        "job_id": ctx.job_id,
        "wetland_name": ctx.wetland_name,
        "user_name": ctx.user_name,
        "terrain": terrain.summary(),
        "rusle_inputs": rusle_inputs.model_dump(),
        "rusle_result": rusle_result.summary,
    }

    summary_path = ctx.output_dir / f"{ctx.job_id}_summary.json"
    summary_path.write_text(json.dumps(summary_payload, indent=2))
    return summary_path


def _prepare_dem(ctx: CalculationContext) -> Path:
    """Ensure a usable DEM exists locally, fetching from remote services when required."""

    dem_str = ctx.dem_reference
    dem_path = Path(dem_str)
    if dem_path.exists():
        return dem_path

    if dem_str.startswith("http://") or dem_str.startswith("https://"):
        target_path = ctx.output_dir / f"{ctx.job_id}_remote_dem.tif"
        logger.info("Fetching remote DEM from %s", dem_str)
        fetch_dem_from_arcgis(
            image_service_url=dem_str,
            polygon_geojson=ctx.polygon_geojson,
            output_path=target_path,
        )
        return target_path

    raise ValueError("DEM path does not exist and is not a recognized URL")
