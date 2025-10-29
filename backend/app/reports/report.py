"""PDF reporting utilities for the Wetland Benefit Calculator."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle


def generate_report(
    *,
    job_id: str,
    wetland_name: str,
    user_name: Optional[str],
    terrain,
    rusle,
    summary_json: Path,
    output_dir: Path,
) -> Path:
    """Generate a lightweight PDF summarising the scenario."""

    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / f"{job_id}_summary.pdf"

    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    width, height = A4

    styles = getSampleStyleSheet()
    title_style = styles["Title"]
    normal_style = styles["BodyText"]

    y = height - 2 * cm

    title_para = Paragraph("Wetland Benefit Calculator Report", title_style)
    title_para.wrapOn(c, width - 4 * cm, y)
    title_para.drawOn(c, 2 * cm, y)
    y -= 2 * cm

    subtitle = f"Wetland: {wetland_name}"
    if user_name:
        subtitle += f" | Analyst: {user_name}"
    subtitle += f" | Date: {datetime.utcnow().strftime('%Y-%m-%d')}"

    subtitle_para = Paragraph(subtitle, normal_style)
    subtitle_para.wrapOn(c, width - 4 * cm, y)
    subtitle_para.drawOn(c, 2 * cm, y)
    y -= 1.5 * cm

    terrain_table = Table(
        [
            ["Wetland Area (ha)", f"{terrain.wetland_area_ha:.2f}"],
            ["Catchment Area (ha)", f"{terrain.catchment_area_ha:.2f}"],
            ["Average Slope (°)", f"{terrain.mean_slope_deg:.2f}"],
            ["Max Slope (°)", f"{terrain.max_slope_deg:.2f}"],
        ]
    )
    terrain_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ]
        )
    )
    terrain_table.wrapOn(c, width - 4 * cm, y)
    terrain_table.drawOn(c, 2 * cm, y - terrain_table._height)
    y -= terrain_table._height + 1.5 * cm

    summary = rusle.summary
    table_data = [
        ["Metric", "Before", "After", "Reduction"],
        [
            "Sediment (t/yr)",
            f"{summary['before']['soil_loss_tonnes']:.2f}",
            f"{summary['after']['soil_loss_tonnes']:.2f}",
            f"{summary['sediment_reduction_tonnes']:.2f}",
        ],
        [
            "Delivered Sediment (t/yr)",
            f"{summary['before']['delivered_sediment_tonnes']:.2f}",
            f"{summary['after']['delivered_sediment_tonnes']:.2f}",
            f"{summary['sediment_reduction_delivered_tonnes']:.2f}",
        ],
        [
            "Nitrogen (kg/yr)",
            f"{summary['before']['nitrogen_load_kg']:.2f}",
            f"{summary['after']['nitrogen_load_kg']:.2f}",
            f"{summary['nitrogen_reduction_kg']:.2f}",
        ],
        [
            "Phosphorus (kg/yr)",
            f"{summary['before']['phosphorus_load_kg']:.2f}",
            f"{summary['after']['phosphorus_load_kg']:.2f}",
            f"{summary['phosphorus_reduction_kg']:.2f}",
        ],
    ]

    results_table = Table(table_data)
    results_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2F855A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ]
        )
    )

    results_table.wrapOn(c, width - 4 * cm, y)
    results_table.drawOn(c, 2 * cm, y - results_table._height)
    y -= results_table._height + 1 * cm

    source_para = Paragraph(
        f"Generated from job ID {job_id}. See JSON summary: {summary_json.name}",
        styles["Italic"],
    )
    source_para.wrapOn(c, width - 4 * cm, y)
    source_para.drawOn(c, 2 * cm, y)

    c.showPage()
    c.save()

    return pdf_path
