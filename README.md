# CIRCUIT IQ // Turnkey PCBA Studio & Smart BOM Sourcing Engine

An AI-powered engineering platform for electronics hardware engineers and PCB assembly teams. It provides comprehensive **Gerber analysis**, **assembly complexity evaluation (0 - 100%)**, **interactive 2D PCB rendering**, **assembly cost estimation (Prototype vs. Production)**, and **smart BOM component sourcing** across preferred supplier websites (**Robu.in**, **Sunrom Electronics**, **ElectronicsComp**, **Mouser**, **DigiKey**, **LCSC**).

---

## 🌟 Key Features

### 1. 📐 PCB Gerber File Analysis & Assembly Cost Calculator
- **Automated Layer Stackup Recognition**:
  - Classifies RS-274X Gerber and Excellon drill files.
  - Automatically identifies Copper Layers (Top, Bottom, Inners), Solder Mask, Solder Paste, Silkscreen, Board Outline (Edge Cuts), and Drill files (PTH & NPTH).
  - Accurate **Layer Count** detection (e.g. 2-layer, 4-layer, 6-layer).
- **Accurate Pad & Hole Counting**:
  - **SMD Pads** count: Top SMD and Bottom SMD pads (from solder paste stencil apertures/flashes).
  - **Through-Hole (THT) Component Pins** count (from plated drill hits $\ge 0.6\text{ mm}$).
  - **Via Holes** count (signal & stitching vias $< 0.6\text{ mm}$).
  - **Non-Plated Through-Hole (NPTH)** mounting holes.
  - Total Pads count and Assembly Pad Density ($\text{pads}/\text{cm}^2$).
  - Auto-detection of **Single-Sided** vs **Double-Sided** SMT assembly.
- **Board Dimensions & Geometry**:
  - Exact board dimensions: Width $\times$ Height in millimeters ($\text{mm}$) and inches ($\text{in}$).
  - Board Surface Area ($\text{cm}^2$ and $\text{sq in}$).
- **🤖 AI-Driven Assembly Complexity Evaluation (0 - 100%)**:
  - Analyzes pad geometry, package clusters, and pitches.
  - Detects **Fine-Pitch Packages** ($\le 0.5\text{ mm}$, $0.4\text{ mm}$, e.g. LQFP, TSSOP).
  - Detects **QFN / DFN Packages** (perimeter pad arrays with central exposed thermal ground pads).
  - Detects **BGA (Ball Grid Array)** matrix patterns (2D equidistant grid matrix arrays).
  - Detects **Miniature Passives** (0402, 0201 pad signatures).
  - Scores assembly complexity from **0 to 100%** with radial gauge and risk breakdown.
  - Provides specific manufacturing recommendations:
    - Stencil thickness & aperture sizing (e.g. 0.12mm laser-cut electropolished with nano-coating).
    - Inspection protocols (Automated Optical Inspection AOI, Automated X-Ray AXI for BGA).
    - Thermal reflow profiling (dual-pass reflow, bottom glue dispensing).
    - Secondary hand-soldering / wave-soldering requirements for THT pins.
- **🗺️ Interactive 2D Gerber Canvas Viewer**:
  - Hardware-accelerated vector rendering of the PCB board outline, SMD copper pads, and drill cutouts directly in the browser with Zoom, Pan, and Reset controls.
- **⚙️ Dynamic Assembly Cost Calculator**:
  - User can adjust **Number of Boards** ($Q$) with instant presets (5, 10, 50, 100, 500 pcs).
  - User-editable **Cost Per Pad** (in ₹ INR or $ USD).
  - **Order Type Toggle**:
    - **Prototype Mode**: Base pad rates, individual optical inspection, prototype stencil setup fee, calibration fee.
    - **Production Mode**: Amortized stencil cost, volume discount curves (up to 50% discount on pad rates), high-speed pick-and-place line setup.
  - **AI Complexity Surcharge Multiplier**: Automatically applied based on the 0-100% complexity index.
  - Real-time cost breakdown: SMT Placement Cost, THT Hand Soldering Cost, Laser Stencil Fee, SMT Machine Calibration Fee, Complexity Surcharge, and Unit Cost Per Board.

---

### 2. 📋 Smart BOM Sourcing & Lowest Price Matcher
- **Multi-Format BOM Parser**:
  - Accepts CSV, TSV, XLSX, XLS.
  - Intelligent header detection for Designator, Description/Value, Footprint/Package, Quantity, and MPN.
  - Cleans and builds search-optimized queries (e.g. `10k 0603 resistor`, `STM32F446RET6 LQFP-64`).
- **Preferred Websites & Keywords Filter**:
  - Interactive selection chips for:
    - **Robu.in**
    - **Sunrom Electronics**
    - **ElectronicsComp**
    - **Mouser Electronics**
    - **DigiKey**
    - **LCSC Electronics**
  - Custom keyword text input (e.g. `robu, sunrom`).
- **Multi-Source Sourcing Engine**:
  - Live querying and parallel searching across selected websites.
  - Automatically selects the **Lowest Cost Part** matching the component description.
  - Extracts and displays:
    - **Selected Supplier Badge** (e.g. `[SUNROM]`, `[ROBU.IN]`, `[ELECTRONICSCOMP]`)
    - **Website Part Number / SKU**
    - **Lowest Unit Price**
    - **Line Total** ($\text{Quantity} \times \text{Unit Price}$)
    - **Direct Clickable Product Link** ("View Part ↗" opens the exact store page)
- **Interactive Data Table & Comparison Modal**:
  - Search and filter by reference designator, description, package, or SKU.
  - Inline editable unit prices for custom negotiated rates.
  - "Compare" button on any row opens a modal displaying alternative offers from other preferred stores, allowing one-click swapping of parts!
- **📥 Enriched Excel Export (.xlsx)**:
  - Generates downloadable formatted Excel workbook with custom theme styling, native clickable hyperlinks to product pages, supplier SKUs, and Excel formulas (`=Qty*Price`).

---

### 3. 💰 Turnkey PCBA Project Rollup
- Consolidates **Bare PCB Fabrication Cost** + **SMT/THT Assembly Cost** + **Component BOM Sourcing Cost**.
- Computes Turnkey Unit Cost per Board and Total Project Budget.
- Interactive color distribution bar showing cost percentages.

---

## 🚀 Quick Start Guide

### Prerequisites
- Python 3.10+ (tested on Python 3.11)

### Installation
```bash
# Clone or navigate to the repository
cd BOM_PCB_analyser

# Install dependencies
python -m pip install -r requirements.txt
```

### Running the Application
```bash
python run.py
```
This automatically launches the server on `http://127.0.0.1:8000` and opens your default browser!

---

## 📁 Project Structure

```
BOM_PCB_analyser/
├── app/
│   ├── __init__.py
│   ├── main.py                # FastAPI endpoints & static routing
│   ├── gerber_analyzer.py     # Gerber RS-274X/Excellon parser, layer classifier, pad counter, AI complexity
│   ├── assembly_calculator.py # Assembly cost models (Prototype vs. Production, volume discounts)
│   ├── bom_parser.py          # CSV & Excel BOM parser and query normalizer
│   ├── component_sourcer.py   # Multi-vendor search engine (Sunrom, ElectronicsComp, Robu)
│   └── excel_exporter.py      # Styled Excel workbook generator with clickable links
├── static/
│   ├── index.html             # Engineering dashboard UI
│   ├── css/
│   │   └── style.css          # Glassmorphism dark/light engineering stylesheet
│   └── js/
│       └── app.js             # Client application logic & interactive 2D canvas
├── sample_gerber_AX60.zip     # Sample 4-layer medical audiometer Gerber archive
├── sample_bom_AX60.csv        # Sample 102-line BOM
├── run.py                     # One-click startup script
├── requirements.txt           # Dependencies
└── README.md                  # Documentation
```
