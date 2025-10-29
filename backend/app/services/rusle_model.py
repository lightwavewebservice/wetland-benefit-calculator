"""RUSLE-based sediment and nutrient reduction modelling utilities."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import numpy as np
import rasterio
from pydantic import BaseModel, Field

from .terrain import TerrainAnalysisResult

NITROGEN_LOAD_PER_TONNE = 1.5  # kg of N per tonne of delivered sediment
PHOSPHORUS_LOAD_PER_TONNE = 0.4  # kg of P per tonne of delivered sediment


class RusleInputs(BaseModel):
    """Parameters supplied by the user or defaults for the RUSLE workflow."""

    rainfall_factor: float = Field(..., description="R factor")
    soil_erodibility: float = Field(..., description="K factor")
    ls_factor: float = Field(..., description="Average LS factor derived from DEM")
    cover_before: float = Field(..., description="C factor before fencing")
    cover_after: float = Field(..., description="C factor after fencing")
    support_before: float = Field(..., description="P factor before fencing")
    support_after: float = Field(..., description="P factor after fencing")
    sediment_delivery_ratio: float = Field(..., ge=0, le=1)
    efficiencies: Dict[str, float] = Field(default_factory=dict)


class ScenarioTotals(BaseModel):
    """Aggregated totals for a specific scenario (before/after)."""

    soil_loss_tonnes: float
    delivered_sediment_tonnes: float
    nitrogen_load_kg: float
    phosphorus_load_kg: float


class RusleResult(BaseModel):
    """Summary of the modelling outcomes."""

    before: ScenarioTotals
    after: ScenarioTotals
    sediment_reduction_tonnes: float
    sediment_reduction_delivered_tonnes: float
    nitrogen_reduction_kg: float
    phosphorus_reduction_kg: float
    output_raster: str

    @property
    def summary(self) -> Dict[str, float]:
        """Dictionary representation used by downstream layers."""

        return {
            "before": self.before.model_dump(),
            "after": self.after.model_dump(),
            "sediment_reduction_tonnes": self.sediment_reduction_tonnes,
            "sediment_reduction_delivered_tonnes": self.sediment_reduction_delivered_tonnes,
            "nitrogen_reduction_kg": self.nitrogen_reduction_kg,
            "phosphorus_reduction_kg": self.phosphorus_reduction_kg,
            "output_raster": self.output_raster,
        }


@dataclass(slots=True)
class _ScenarioArrays:
    soil_loss: np.ndarray
    delivered_sediment: np.ndarray
    nitrogen_load: np.ndarray
    phosphorus_load: np.ndarray


def calculate_rusle(
    terrain: TerrainAnalysisResult,
    inputs: RusleInputs,
    *,
    job_id: str,
    output_dir: Path,
) -> RusleResult:
    """Compute RUSLE soil loss and nutrient reductions for before/after scenarios."""

    eff_sediment = inputs.efficiencies.get("sediment", 0.7)
    eff_nitrogen = inputs.efficiencies.get("nitrogen", 0.4)
    eff_phosphorus = inputs.efficiencies.get("phosphorus", 0.5)

    cell_area_ha = (terrain.cell_size ** 2) / 10_000.0
    mask = terrain.mask_array
    ls_array = np.where(mask, np.nan, terrain.ls_array)

    before_arrays = _compute_scenario_arrays(
        terrain=terrain,
        ls_array=ls_array,
        cell_area_ha=cell_area_ha,
        cover=inputs.cover_before,
        support=inputs.support_before,
        efficiencies=(0.0, 0.0, 0.0),
        inputs=inputs,
    )

    after_base_arrays = _compute_scenario_arrays(
        terrain=terrain,
        ls_array=ls_array,
        cell_area_ha=cell_area_ha,
        cover=inputs.cover_after,
        support=inputs.support_after,
        efficiencies=(eff_sediment, eff_nitrogen, eff_phosphorus),
        inputs=inputs,
    )

    before_totals = _aggregate_totals(before_arrays)
    after_totals = _aggregate_totals(after_base_arrays)

    sediment_reduction = max(before_totals.soil_loss_tonnes - after_totals.soil_loss_tonnes, 0.0)
    delivered_reduction = max(
        before_totals.delivered_sediment_tonnes - after_totals.delivered_sediment_tonnes,
        0.0,
    )
    nitrogen_reduction = max(before_totals.nitrogen_load_kg - after_totals.nitrogen_load_kg, 0.0)
    phosphorus_reduction = max(
        before_totals.phosphorus_load_kg - after_totals.phosphorus_load_kg,
        0.0,
    )

    reduction_raster = (
        before_arrays.delivered_sediment - after_base_arrays.delivered_sediment
    )
    reduction_raster = np.where(np.isnan(reduction_raster), 0.0, np.maximum(reduction_raster, 0.0))

    raster_path = output_dir / f"{job_id}_benefits.tif"
    _write_raster(
        path=raster_path,
        data=reduction_raster.astype("float32"),
        terrain=terrain,
    )

    return RusleResult(
        before=before_totals,
        after=after_totals,
        sediment_reduction_tonnes=sediment_reduction,
        sediment_reduction_delivered_tonnes=delivered_reduction,
        nitrogen_reduction_kg=nitrogen_reduction,
        phosphorus_reduction_kg=phosphorus_reduction,
        output_raster=str(raster_path),
    )


def _compute_scenario_arrays(
    *,
    terrain: TerrainAnalysisResult,
    ls_array: np.ndarray,
    cell_area_ha: float,
    cover: float,
    support: float,
    efficiencies: tuple[float, float, float],
    inputs: RusleInputs,
) -> _ScenarioArrays:
    """Return soil loss, delivered sediment, and nutrient loads for a scenario."""

    eff_sediment, eff_nitrogen, eff_phosphorus = efficiencies

    a_factor = inputs.rainfall_factor * inputs.soil_erodibility * ls_array * cover * support
    soil_loss = a_factor * cell_area_ha  # tonnes per pixel per year

    delivered = soil_loss * inputs.sediment_delivery_ratio * (1 - eff_sediment)

    nitrogen_load = delivered * NITROGEN_LOAD_PER_TONNE * (1 - eff_nitrogen)
    phosphorus_load = delivered * PHOSPHORUS_LOAD_PER_TONNE * (1 - eff_phosphorus)

    soil_loss = np.where(np.isnan(soil_loss), 0.0, np.maximum(soil_loss, 0.0))
    delivered = np.where(np.isnan(delivered), 0.0, np.maximum(delivered, 0.0))
    nitrogen_load = np.where(np.isnan(nitrogen_load), 0.0, np.maximum(nitrogen_load, 0.0))
    phosphorus_load = np.where(np.isnan(phosphorus_load), 0.0, np.maximum(phosphorus_load, 0.0))

    return _ScenarioArrays(
        soil_loss=soil_loss,
        delivered_sediment=delivered,
        nitrogen_load=nitrogen_load,
        phosphorus_load=phosphorus_load,
    )


def _aggregate_totals(arrays: _ScenarioArrays) -> ScenarioTotals:
    """Aggregate per-pixel arrays into scalar totals."""

    return ScenarioTotals(
        soil_loss_tonnes=float(np.nansum(arrays.soil_loss)),
        delivered_sediment_tonnes=float(np.nansum(arrays.delivered_sediment)),
        nitrogen_load_kg=float(np.nansum(arrays.nitrogen_load)),
        phosphorus_load_kg=float(np.nansum(arrays.phosphorus_load)),
    )


def _write_raster(*, path: Path, data: np.ndarray, terrain: TerrainAnalysisResult) -> None:
    """Persist a single-band GeoTIFF using metadata from the source DEM."""

    path.parent.mkdir(parents=True, exist_ok=True)
    filled = np.where(np.isnan(data), -9999.0, data).astype("float32")

    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        transform=terrain.transform,
        crs=terrain.crs,
        nodata=-9999.0,
    ) as dst:
        dst.write(filled, 1)

    # No mask written for simplicity; consumers should treat -9999 as nodata.
