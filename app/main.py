"""
Turnkey PCB Gerber Analyzer & Smart BOM Sourcing Tool
FastAPI Server Backend
"""

import os
import shutil
import tempfile
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.gerber_analyzer import analyze_gerber_archive
from app.assembly_calculator import calculate_assembly_cost
from app.bom_parser import parse_bom_file
from app.component_sourcer import source_entire_bom
from app.excel_exporter import export_bom_to_excel

app = FastAPI(
    title="Turnkey PCBA Analyzer & Smart BOM Sourcing Engine",
    description="Analyzes PCB Gerbers (layers, SMD/THT pads, dimensions, AI complexity 0-100%, assembly cost) and sources BOMs for lowest cost parts across preferred suppliers.",
    version="1.0.0"
)

# Enable CORS for seamless client-server interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
SAMPLE_GERBER_PATH = os.path.join(BASE_DIR, "sample_gerber_AX60.zip")
SAMPLE_BOM_PATH = os.path.join(BASE_DIR, "sample_bom_AX60.csv")


class AssemblyCostRequest(BaseModel):
    num_boards: int = 10
    cost_per_pad: float = 0.35
    smd_pads: int = 1317
    tht_pads: int = 178
    assembly_type: str = "prototype"
    complexity_score: float = 50.0
    is_double_sided: bool = False
    currency: str = "INR"


class SourceBOMRequest(BaseModel):
    items: List[dict]
    preferred_keywords: List[str] = ["robu", "sunrom", "electronicscomp"]
    currency: str = "INR"


class ExportBOMRequest(BaseModel):
    sourced_data: dict
    project_name: str = "PCBA Project"


@app.post("/api/analyze-gerber")
def analyze_gerber_endpoint(file: UploadFile = File(...)):
    """Uploads and analyzes a Gerber ZIP archive or file."""
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    try:
        content = file.file.read()
        temp_file.write(content)
        temp_file.close()

        result = analyze_gerber_archive(temp_file.name)
        result["filename"] = file.filename
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze Gerber files: {str(e)}")
    finally:
        if os.path.exists(temp_file.name):
            try:
                os.remove(temp_file.name)
            except Exception:
                pass


@app.get("/api/sample-gerber")
def get_sample_gerber():
    """Loads and analyzes the built-in sample Gerber (AX60 4-layer board)."""
    if not os.path.exists(SAMPLE_GERBER_PATH):
        raise HTTPException(status_code=404, detail="Sample Gerber archive not found.")

    try:
        result = analyze_gerber_archive(SAMPLE_GERBER_PATH)
        result["filename"] = "AX60_V1_GERBER.zip (Built-in Sample)"
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calculate-assembly")
def calculate_assembly_endpoint(req: AssemblyCostRequest):
    """Calculates assembly cost with prototype/production curves and AI complexity."""
    try:
        result = calculate_assembly_cost(
            num_boards=req.num_boards,
            cost_per_pad=req.cost_per_pad,
            smd_pads=req.smd_pads,
            tht_pads=req.tht_pads,
            assembly_type=req.assembly_type,
            complexity_score=req.complexity_score,
            is_double_sided=req.is_double_sided,
            currency=req.currency
        )
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/parse-bom")
def parse_bom_endpoint(file: UploadFile = File(...)):
    """Parses uploaded BOM (CSV or Excel) and normalizes columns."""
    try:
        content = file.file.read()
        result = parse_bom_file(content, filename=file.filename)
        result["filename"] = file.filename
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse BOM: {str(e)}")


@app.get("/api/sample-bom")
def get_sample_bom():
    """Loads and parses the built-in sample BOM (AX60 project)."""
    if not os.path.exists(SAMPLE_BOM_PATH):
        raise HTTPException(status_code=404, detail="Sample BOM file not found.")

    try:
        result = parse_bom_file(SAMPLE_BOM_PATH, filename="Audio_Meter_Basic_BOM.csv")
        result["filename"] = "Audio_Meter_Basic_BOM.csv (Built-in Sample)"
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/source-bom")
def source_bom_endpoint(req: SourceBOMRequest):
    """Sources components across preferred supplier websites and finds lowest cost part."""
    try:
        result = source_entire_bom(
            items=req.items,
            preferred_keywords=req.preferred_keywords,
            currency=req.currency
        )
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to source components: {str(e)}")


@app.post("/api/export-bom")
def export_bom_endpoint(req: ExportBOMRequest):
    """Exports enriched BOM to downloadable Excel file with hyperlinks."""
    try:
        excel_bytes = export_bom_to_excel(
            sourced_bom_data=req.sourced_data,
            project_name=req.project_name
        )
        filename = f"{req.project_name.replace(' ', '_')}_Enriched_BOM.xlsx"
        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export Excel: {str(e)}")


# Mount static directory for frontend
if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
