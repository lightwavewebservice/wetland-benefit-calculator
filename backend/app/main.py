"""FastAPI application entrypoint for the Wetland Benefit Calculator backend."""

from __future__ import annotations

import json
import logging
import uuid
from tempfile import TemporaryDirectory
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from .services.calculation_service import CalculationResult, run_wetland_calculation
from .services.dem_fetcher import fetch_dem_from_arcgis

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "data" / "outputs"


logger = logging.getLogger(__name__)


def ensure_directories() -> None:
    """Ensure upload and output directories exist."""

    for directory in (OUTPUT_DIR,):
        directory.mkdir(parents=True, exist_ok=True)


ensure_directories()


app = FastAPI(title="Wetland Benefit Calculator API", version="0.1.0")


# Allow local dev frontends by default; adjust origins as required.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EfficiencyModel(BaseModel):
    """Nutrient trapping efficiencies expressed as fractions (0–1)."""

    sediment: float = Field(0.7, ge=0, le=1)
    nitrogen: float = Field(0.4, ge=0, le=1)
    phosphorus: float = Field(0.5, ge=0, le=1)


class CalculationRequest(BaseModel):
    """Request payload for the wetland benefit calculation."""

    dem_url: str = Field(
        ...,
        description=(
            "ArcGIS ImageServer export URL (including query params) used to retrieve the DEM clip"
        ),
    )
    wetland_name: str = Field(..., description="Label for the wetland/polygon")
    user_name: str | None = Field(None, description="Name of the analyst running the scenario")
    polygon_geojson: Dict[str, Any] = Field(..., description="GeoJSON Feature or geometry for the wetland polygon")
    rainfall_factor: float = Field(600.0, description="R factor (MJ mm ha-1 h-1 year-1)")
    soil_erodibility: float = Field(0.28, description="K factor (t ha h ha-1 MJ-1 mm-1)")
    cover_management_before: float = Field(0.3, description="C factor before fencing")
    cover_management_after: float = Field(0.05, description="C factor after fencing")
    support_practices_before: float = Field(0.5, description="P factor before fencing")
    support_practices_after: float = Field(0.2, description="P factor after fencing")
    sediment_delivery_ratio: float = Field(0.6, ge=0, le=1, description="Sediment delivery ratio applied to sediment yield")
    efficiencies: EfficiencyModel = Field(default_factory=EfficiencyModel)

    @field_validator("polygon_geojson")
    def _ensure_geojson(cls, value: Dict[str, Any]) -> Dict[str, Any]:  # noqa: D401
        """Validate that the payload resembles a GeoJSON geometry."""

        if not isinstance(value, dict):
            raise ValueError("polygon_geojson must be a GeoJSON dictionary")
        if "type" not in value:
            raise ValueError("GeoJSON must include a 'type' field")
        return value


CALCULATION_STORE: Dict[str, CalculationResult] = {}


class DemTestRequest(BaseModel):
    dem_url: str
    polygon_geojson: Dict[str, Any]

    @field_validator("polygon_geojson")
    def _ensure_geojson(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(value, dict) or "type" not in value:
            raise ValueError("polygon_geojson must be a GeoJSON dictionary")
        return value


@app.post("/calculate")
async def calculate_benefits(payload: CalculationRequest) -> Dict[str, Any]:
    """Execute the terrain analysis and nutrient reduction workflow."""

    job_id = str(uuid.uuid4())
    try:
        result = run_wetland_calculation(
            job_id=job_id,
            dem_reference=payload.dem_url,
            polygon_geojson=payload.polygon_geojson,
            rainfall_factor=payload.rainfall_factor,
            soil_erodibility=payload.soil_erodibility,
            cover_before=payload.cover_management_before,
            cover_after=payload.cover_management_after,
            support_before=payload.support_practices_before,
            support_after=payload.support_practices_after,
            sediment_delivery_ratio=payload.sediment_delivery_ratio,
            efficiencies=payload.efficiencies.model_dump(),
            wetland_name=payload.wetland_name,
            user_name=payload.user_name,
            output_dir=OUTPUT_DIR,
        )
    except ValueError as exc:  # Validation or geometry issues
        logger.exception("Calculation failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface to caller while logging
        logger.exception("Unexpected calculation failure")
        raise HTTPException(status_code=500, detail="Failed to complete calculation") from exc

    CALCULATION_STORE[job_id] = result
    response = result.model_dump()
    response["job_id"] = job_id
    response["raster_download_url"] = f"/raster/{job_id}"
    response["report_download_url"] = f"/report/{job_id}"

    return response


@app.post("/dem/test")
async def test_dem_endpoint(payload: DemTestRequest) -> Dict[str, Any]:
    """Attempt to fetch a small DEM clip to validate the remote export URL."""

    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir) / "dem_test_clip.tif"
        try:
            fetch_dem_from_arcgis(
                image_service_url=payload.dem_url,
                polygon_geojson=payload.polygon_geojson,
                output_path=temp_path,
                width=256,
                height=256,
            )
            size = temp_path.stat().st_size
        except Exception as exc:  # noqa: BLE001
            logger.exception("DEM test failed: %s", exc)
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"status": "ok", "message": "DEM export succeeded", "bytes": size}


@app.get("/raster/{job_id}")
async def download_raster(job_id: str) -> FileResponse:
    """Return the GeoTIFF with spatial distribution of reductions."""

    result = CALCULATION_STORE.get(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    raster_path = Path(result.output_raster_path)
    if not raster_path.exists():
        raise HTTPException(status_code=404, detail="Raster output unavailable")

    return FileResponse(raster_path, media_type="image/tiff", filename=raster_path.name)


@app.get("/report/{job_id}")
async def download_report(job_id: str) -> FileResponse:
    """Return the PDF report summarising the scenario."""

    result = CALCULATION_STORE.get(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    report_path = Path(result.report_path)
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report has not been generated")

    return FileResponse(report_path, media_type="application/pdf", filename=report_path.name)
@app.get("/")
async def root() -> Dict[str, Any]:
    """Simple health endpoint."""

    return {
        "status": "ok",
        "message": "Wetland Benefit Calculator backend is running",
        "available_jobs": len(CALCULATION_STORE),
    }


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    """Retrieve previously computed job metadata."""

    result = CALCULATION_STORE.get(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    payload = result.model_dump()
    payload["job_id"] = job_id
    return payload


@app.post("/jobs/{job_id}/export")
async def export_job(job_id: str) -> Dict[str, Any]:
    """Return calculation payload for client-side persistence."""

    result = CALCULATION_STORE.get(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    payload = result.model_dump()
    payload["job_id"] = job_id
    return json.loads(json.dumps(payload, default=str))
