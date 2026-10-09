"""
Gerber and Drill Analyzer Module
Parses RS-274X Gerber and Excellon drill files.
Extracts PCB layer count, SMD/THT pad counts, board dimensions,
AI-driven Assembly Complexity score (0-100%), and interactive 2D geometry.
"""

import os
import re
import math
import json
import zipfile
import tempfile
import shutil
from collections import defaultdict, Counter

def check_file_function_attribute(filepath: str) -> str:
    """Reads the initial block of a Gerber file to check for standard Gerber X2 %TF.FileFunction."""
    try:
        if not os.path.isfile(filepath):
            return ''
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            header = f.read(4096)
        match = re.search(r'%TF\.FileFunction,([^%*]+)\*%', header)
        if match:
            fn = match.group(1).lower()
            if 'profile' in fn:
                return 'outline'
            if 'soldermask' in fn:
                return 'mask_top' if 'top' in fn else 'mask_bottom'
            if 'paste' in fn:
                return 'paste_top' if 'top' in fn else 'paste_bottom'
            if 'legend' in fn:
                return 'silk_top' if 'top' in fn else 'silk_bottom'
            if 'copper' in fn:
                if 'top' in fn or 'l1' in fn:
                    return 'copper_top'
                elif 'bot' in fn or 'l2' in fn:
                    return 'copper_bottom'
                else:
                    return 'copper_inner'
    except Exception:
        pass
    return ''


def classify_layer_filename(filename: str) -> str:
    """Classifies a gerber/drill file by its filename, extension, or Gerber X2 metadata."""
    f = filename.lower()
    base = os.path.basename(f)
    ext = os.path.splitext(f)[1]

    # Exclude non-gerber/drill documentation and map files
    if ext in ['.pdf', '.png', '.jpg', '.jpeg', '.svg', '.html', '.htm', '.md', '.doc', '.docx', '.csv', '.xlsx']:
        return 'other'

    # 1. Try Gerber X2 attribute if file exists on disk
    if os.path.isfile(filename):
        x2_type = check_file_function_attribute(filename)
        if x2_type:
            return x2_type

    clean = re.sub(r'[^a-z0-9]', '', base)

    # 2. Drills
    if ext in ['.drl', '.txt', '.xln', '.exc', '.drd'] or 'drill' in clean or 'drl' in clean:
        if 'npth' in clean:
            return 'drill_npth'
        return 'drill_pth'

    # 3. Outline / Edge Cuts
    if any(k in clean for k in ['edgecuts', 'edgecut', 'outline', 'boardoutline', 'profile', 'border', 'gm1', 'gml', 'gko']) or ext in ['.gko', '.gm1', '.gml']:
        return 'outline'

    # 4. Solder Paste
    if any(k in clean for k in ['pastetop', 'toppaste', 'paste1', 'fpaste', 'gtp', 'tpm', 'crc']) or ext in ['.gtp', '.tpm', '.crc']:
        return 'paste_top'
    if any(k in clean for k in ['pastebottom', 'pastebot', 'bottompaste', 'botpaste', 'bpaste', 'gbp', 'bpm', 'crs']) or ext in ['.gbp', '.bpm', '.crs']:
        return 'paste_bottom'

    # 5. Solder Mask
    if any(k in clean for k in ['masktop', 'topmask', 'mask1', 'fmask', 'gts', 'tsm', 'stc']) or ext in ['.gts', '.tsm', '.stc']:
        return 'mask_top'
    if any(k in clean for k in ['maskbottom', 'maskbot', 'bottommask', 'botmask', 'bmask', 'gbs', 'bsm', 'sts']) or ext in ['.gbs', '.bsm', '.sts']:
        return 'mask_bottom'

    # 6. Silkscreen
    if any(k in clean for k in ['silktop', 'topsilk', 'silk1', 'fsilk', 'gto', 'tsk', 'plc', 'sst']) or ext in ['.gto', '.tsk', '.plc', '.sst']:
        return 'silk_top'
    if any(k in clean for k in ['silkbottom', 'silkbot', 'bottomsilk', 'botsilk', 'bsilk', 'gbo', 'bsk', 'pls', 'ssb']) or ext in ['.gbo', '.bsk', '.pls', '.ssb']:
        return 'silk_bottom'

    # 7. Copper Layers
    if any(k in clean for k in ['in1cu', 'in2cu', 'in3cu', 'in4cu', 'inner', 'in1', 'in2', 'in3', 'in4', 'gp1', 'gp2', 'g1', 'g2']) or ext in ['.g1', '.g2', '.gp1', '.gp2', '.in1', '.in2']:
        return 'copper_inner'
    if any(k in clean for k in ['cutop', 'topcu', 'coppertop', 'topcopper', 'fcu', 'layer1', 'l1', 'gtl', 'cmp']) or ext in ['.gtl', '.top', '.cmp']:
        return 'copper_top'
    if any(k in clean for k in ['cubottom', 'cubot', 'bottomcu', 'botcu', 'copperbottom', 'bottomcopper', 'bcu', 'layer2', 'l2', 'gbl', 'sol']) or ext in ['.gbl', '.sol', '.bot']:
        return 'copper_bottom'

    if ext == '.gbrjob':
        return 'gbrjob'

    return 'other'


def normalize_polylines(polylines: list, min_x: float, min_y: float) -> list:
    """Normalizes polyline coordinates relative to PCB min_x and min_y."""
    norm = []
    for line in polylines:
        if len(line) < 4:
            continue
        norm_line = []
        for i in range(0, len(line), 2):
            norm_line.append(round(line[i] - min_x, 2))
            norm_line.append(round(line[i+1] - min_y, 2))
        norm.append(norm_line)
    return norm


def extract_gerber_polylines(filepath: str, max_polylines: int = 25000, filter_aps: set = None) -> list:
    """
    Extracts 2D vector strokes / polylines from a Gerber RS-274X layer (Edge Cuts, Silkscreen, Copper).
    Returns list of polylines: [[x1, y1, x2, y2, ...], ...]
    """
    if not os.path.exists(filepath):
        return []

    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception:
        return []

    is_metric = '%MOIN*%' not in content
    fs_match = re.search(r'%FS[LT]A[XID]+(\d)(\d)Y[XID]*(\d)(\d)', content)
    if fs_match:
        coord_divisor = float(10 ** int(fs_match.group(2)))
    elif is_metric:
        coord_divisor = 1000000.0
    else:
        coord_divisor = 100000.0
    scale = 1.0 if is_metric else 25.4

    body = re.sub(r'%.*?%', '', content, flags=re.DOTALL)
    body = re.sub(r'G04.*?\*', '', body)

    polylines = []
    cur_line = []
    cur_x, cur_y = 0.0, 0.0
    cur_ap = None

    for match in re.finditer(r'(?:X(-?\d+))?(?:Y(-?\d+))?(?:D(01|02|03)|\b(D\d+)\b)?\*', body):
        x_str, y_str, d_code, ap_select = match.groups()
        if ap_select and ap_select.startswith('D') and ap_select not in ('D01', 'D02', 'D03'):
            cur_ap = ap_select

        if x_str is not None:
            cur_x = round((int(x_str) / coord_divisor) * scale, 3)
        if y_str is not None:
            cur_y = round((int(y_str) / coord_divisor) * scale, 3)

        if filter_aps and cur_ap in filter_aps:
            continue

        if d_code == '02':
            if len(cur_line) >= 4:
                polylines.append(cur_line)
                if len(polylines) >= max_polylines:
                    break
            cur_line = [cur_x, cur_y]
        elif d_code == '01':
            if not cur_line:
                cur_line = [cur_x, cur_y]
            else:
                if len(cur_line) < 2 or cur_line[-2] != cur_x or cur_line[-1] != cur_y:
                    cur_line.extend([cur_x, cur_y])

    if len(cur_line) >= 4 and len(polylines) < max_polylines:
        polylines.append(cur_line)

    return polylines


def parse_gerber_file_stats(filepath: str):
    """
    Parses a single Gerber RS-274X file directly for flashes, apertures, and accurate bounding box.
    Returns primitives count, flashes count, pad positions, and bounding coordinates.
    """
    flashes = 0
    draws = 0
    pad_positions = []
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')

    # Aperture dictionary: code -> {type, shape, w, h, r, params}
    apertures = {}
    current_aperture = None
    cur_x, cur_y = 0.0, 0.0

    # Scale factor (default metric mm or inch)
    is_metric = True
    coord_divisor = 1000000.0  # default 4.6 or KiCad format

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # Detect unit
    if '%MOIN*%' in content:
        is_metric = False
    elif '%MOMM*%' in content:
        is_metric = True

    # Detect format specification e.g. %FSLAX46Y46*%
    fs_match = re.search(r'%FS[LT]A[XID]+(\d)(\d)Y[XID]*(\d)(\d)', content)
    if fs_match:
        dec = int(fs_match.group(2))
        coord_divisor = float(10 ** dec)
    elif is_metric:
        coord_divisor = 1000000.0  # KiCad default mm format (4.6)
    else:
        coord_divisor = 100000.0   # Inch default (2.5)

    # Parse apertures: %ADD10C,0.300*% or %ADD11R,1.500X0.600*%
    for match in re.finditer(r'%ADD(\d+)([A-Za-z0-9_]+),?([^%*]*)\*%', content):
        code = 'D' + match.group(1)
        ap_type = match.group(2)
        params = [float(p) for p in match.group(3).split('X') if p]

        shape = 'rect'
        w = 1.0
        h = 1.0
        r = 0.0

        if ap_type == 'C' and params:
            shape = 'circle'
            w = h = params[0]
        elif ap_type == 'R' and params:
            shape = 'rect'
            w = params[0]
            h = params[1] if len(params) > 1 else params[0]
        elif ap_type == 'O' and params:
            shape = 'obround'
            w = params[0]
            h = params[1] if len(params) > 1 else params[0]
        elif 'Round' in ap_type and len(params) >= 9:
            shape = 'roundrect'
            r = params[0]
            xs = [params[1], params[3], params[5], params[7]]
            ys = [params[2], params[4], params[6], params[8]]
            w = (max(xs) - min(xs)) + 2 * r
            h = (max(ys) - min(ys)) + 2 * r
        elif params:
            w = params[0]
            h = params[1] if len(params) > 1 else params[0]

        apertures[code] = {
            'type': ap_type,
            'params': params,
            'shape': shape,
            'w': round(max(0.05, w), 3),
            'h': round(max(0.05, h), 3),
            'r': round(max(0.0, r), 3)
        }

    # CRITICAL: Clean body to avoid matching coordinate tokens inside headers (%...%) or comments (G04...*)
    body = re.sub(r'%.*?%', '', content, flags=re.DOTALL)
    body = re.sub(r'G04.*?\*', '', body)

    # Count D03 (flash), D01 (draw), D02 (move) and extract coordinates
    command_pattern = re.compile(r'(?:X(-?\d+))?(?:Y(-?\d+))?(?:D(01|02|03)|\b(D\d+)\b)?\*')

    for match in command_pattern.finditer(body):
        x_str, y_str, d_code, ap_select = match.groups()
        if ap_select and ap_select.startswith('D') and ap_select not in ('D01', 'D02', 'D03'):
            current_aperture = ap_select

        has_coord = False
        if x_str is not None:
            cur_x = int(x_str) / coord_divisor
            if not is_metric:
                cur_x *= 25.4
            has_coord = True
        if y_str is not None:
            cur_y = int(y_str) / coord_divisor
            if not is_metric:
                cur_y *= 25.4
            has_coord = True

        if d_code == '03':
            flashes += 1
            ap_info = apertures.get(current_aperture, {'shape': 'rect', 'w': 1.0, 'h': 1.0, 'r': 0.0})
            pad_positions.append((
                cur_x,
                cur_y,
                current_aperture,
                ap_info['shape'],
                ap_info['w'],
                ap_info['h'],
                ap_info.get('r', 0.0)
            ))
            min_x = min(min_x, cur_x)
            max_x = max(max_x, cur_x)
            min_y = min(min_y, cur_y)
            max_y = max(max_y, cur_y)
        elif d_code in ('01', '02') or has_coord:
            if d_code == '01':
                draws += 1
            min_x = min(min_x, cur_x)
            max_x = max(max_x, cur_x)
            min_y = min(min_y, cur_y)
            max_y = max(max_y, cur_y)

    # Polygons G36 ... G37
    polygons = len(re.findall(r'G36\*', body))

    bounds = None
    if min_x != float('inf') and max_x != float('-inf'):
        bounds = (min_x, max_x, min_y, max_y)

    return {
        'flashes': flashes,
        'draws': draws,
        'polygons': polygons,
        'total_pads': flashes + polygons,
        'apertures': apertures,
        'pad_positions': pad_positions,
        'bounds': bounds
    }


def parse_excellon_file(filepath: str):
    """
    Parses Excellon drill file for tools (diameters) and drill hits.
    Distinguishes component through-holes from vias.
    """
    tools = {}  # tool_id -> diameter_mm
    hits = []   # list of (x, y, tool_id, diameter)
    current_tool = None
    is_metric = True
    divisor = 1000.0

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()

    for line in lines:
        line = line.strip()
        if 'INCH' in line:
            is_metric = False
        elif 'METRIC' in line:
            is_metric = True

        # Tool definition: e.g. T1C0.300 or T01C0.0315
        t_def = re.match(r'T(\d+)C([\d\.]+)', line)
        if t_def:
            tid = 'T' + str(int(t_def.group(1)))
            dia = float(t_def.group(2))
            if not is_metric:
                dia *= 25.4
            tools[tid] = dia

        # Tool selection: T1 or T01
        t_sel = re.match(r'T(\d+)(?!C)', line)
        if t_sel:
            current_tool = 'T' + str(int(t_sel.group(1)))

        # Drill hit: X12345Y67890
        hit = re.search(r'X(-?[\d\.]+)Y(-?[\d\.]+)', line)
        if hit:
            x_raw = hit.group(1)
            y_raw = hit.group(2)
            if '.' in x_raw:
                x = float(x_raw)
            else:
                x = float(x_raw) / (1000.0 if is_metric else 10000.0)
            if '.' in y_raw:
                y = float(y_raw)
            else:
                y = float(y_raw) / (1000.0 if is_metric else 10000.0)

            if not is_metric:
                x *= 25.4
                y *= 25.4

            dia = tools.get(current_tool, 0.8)
            hits.append((x, y, current_tool, dia))

    # Classify hits:
    # Vias: Plated holes with diameter <= 0.45mm
    # Component Through-Hole: Plated holes with diameter > 0.45mm
    vias = [h for h in hits if h[3] <= 0.45]
    tht_pins = [h for h in hits if h[3] > 0.45]

    return {
        'total_holes': len(hits),
        'vias_count': len(vias),
        'tht_pins_count': len(tht_pins),
        'tools': tools,
        'hits': hits
    }


def analyze_assembly_complexity(
    pad_positions_top,
    pad_positions_bot,
    tht_count,
    layer_count,
    width_mm,
    height_mm,
    apertures
):
    """
    AI / Heuristic Assembly Complexity Evaluation (0 - 100%)
    Analyzes:
    - Fine pitch ICs / QFN / DFN packages
    - BGA grid matrix arrays
    - Miniature 0402/0201 passives
    - Double-sided assembly requirement
    - High pad density
    - Mixed SMT + Through-Hole assembly
    """
    all_pads = pad_positions_top + pad_positions_bot
    total_smd = len(all_pads)
    board_area_cm2 = max(1.0, (width_mm * height_mm) / 100.0)
    density = total_smd / board_area_cm2

    complexity_score = 0.0
    factors = []
    detected_packages = []
    manufacturing_notes = []

    # 1. Base complexity from board layers
    if layer_count <= 2:
        base = 10.0
        factors.append(f"Standard {layer_count}-Layer PCB base baseline (+10%)")
    elif layer_count == 4:
        base = 18.0
        factors.append("4-Layer Multilayer Stackup (+18%)")
    else:
        base = 25.0
        factors.append(f"High-Density {layer_count}-Layer Multilayer Stackup (+25%)")
    complexity_score += base

    # 2. Check for Fine Pitch (< 0.55mm) & QFN / DFN packages
    # We sort pads and inspect distances between nearest neighbors
    fine_pitch_count = 0
    pitch_distribution = Counter()
    qfn_candidates = 0

    if len(pad_positions_top) > 1:
        # Sample coordinates to calculate minimum distances
        sample_pts = sorted(pad_positions_top[:1500], key=lambda pt: (pt[0], pt[1]))
        for i in range(len(sample_pts) - 1):
            dx = sample_pts[i+1][0] - sample_pts[i][0]
            dy = sample_pts[i+1][1] - sample_pts[i][1]
            dist = math.hypot(dx, dy)
            if 0.15 <= dist <= 1.27:
                p_round = round(dist, 2)
                pitch_distribution[p_round] += 1
                if dist <= 0.55:
                    fine_pitch_count += 1

    # Check for fine pitch <= 0.5mm (QFN, LQFP, TSSOP)
    has_ultra_fine_pitch = fine_pitch_count >= 10
    if fine_pitch_count >= 50:
        complexity_score += 24.0
        detected_packages.append("QFN / Fine-Pitch ICs (0.50mm / 0.40mm pitch detected)")
        factors.append(f"High-density fine-pitch components ({fine_pitch_count}+ pad pairs <= 0.5mm) (+24%)")
        manufacturing_notes.append("High-precision laser-cut electropolished stencil (0.12mm / 4mil) recommended to prevent solder bridging on 0.5mm pitch leads.")
    elif fine_pitch_count >= 10:
        complexity_score += 15.0
        detected_packages.append("Fine-Pitch ICs (0.5mm - 0.65mm pitch detected)")
        factors.append(f"Fine-pitch ICs detected ({fine_pitch_count} pads <= 0.55mm) (+15%)")
        manufacturing_notes.append("Automated Optical Inspection (AOI) required for fine-pitch lead inspection.")
    else:
        factors.append("Standard pitch components (> 0.65mm pitch) (+0%)")

    # 3. Check for BGA (Ball Grid Array) Matrix Signatures
    # Regular 2D grids of small circular/square pads with pitch 0.4mm - 1.0mm
    bga_detected = False
    for p, count in pitch_distribution.items():
        if p in [0.4, 0.5, 0.65, 0.8, 1.0] and count >= 36:
            # High occurrence of identical equidistant grid spacing
            bga_detected = True
            break

    if bga_detected and has_ultra_fine_pitch:
        complexity_score += 20.0
        detected_packages.append("BGA (Ball Grid Array) Matrix Footprint Signature")
        factors.append("BGA grid matrix array detected (+20%)")
        manufacturing_notes.append("Automated X-ray Inspection (AXI) recommended for hidden solder ball joint integrity.")
    else:
        factors.append("No large BGA array detected")

    # 4. Small Passives (0402 / 0201) Detection
    small_pads = 0
    for ap_code, ap_data in apertures.items():
        if ap_data['type'] in ['R', 'Rectangle']:
            dims = ap_data['params']
            if len(dims) >= 2 and min(dims[0], dims[1]) <= 0.6:
                small_pads += 1

    if small_pads > 0:
        complexity_score += 10.0
        detected_packages.append("Miniature 0402 / 0201 SMD Passives")
        factors.append(f"Micro-aperture passives detected (pad width <= 0.6mm) (+10%)")
        manufacturing_notes.append("Controlled solder paste volume required to prevent component tombstoning.")

    # 5. Double-Sided SMT
    is_double_sided = len(pad_positions_bot) > 0
    if is_double_sided:
        complexity_score += 18.0
        factors.append(f"Double-Sided SMT Assembly ({len(pad_positions_bot)} bottom pads) (+18%)")
        manufacturing_notes.append("Dual-pass reflow process required. Heavier bottom components require glue dispensing or surface tension profiling.")
    else:
        factors.append("Single-Sided SMT Assembly (+0%)")

    # 6. Pad Density
    if density > 25.0:
        complexity_score += 10.0
        factors.append(f"High Component Density ({density:.1f} pads/cm²) (+10%)")
    elif density > 10.0:
        complexity_score += 5.0
        factors.append(f"Moderate Component Density ({density:.1f} pads/cm²) (+5%)")
    else:
        factors.append(f"Standard Component Density ({density:.1f} pads/cm²) (+0%)")

    # 7. Mixed Assembly (SMT + Through Hole)
    if tht_count > 0:
        complexity_score += 8.0
        factors.append(f"Mixed Assembly: {tht_count} THT Pins require secondary soldering (+8%)")
        manufacturing_notes.append(f"Secondary manual hand-soldering or selective wave soldering line required for {tht_count} through-hole pins.")

    # Final clamping to 0 - 100%
    final_score = round(max(5.0, min(100.0, complexity_score)), 1)

    if final_score < 30.0:
        complexity_level = "Low (Standard Assembly)"
        complexity_color = "#00e676"  # Emerald
    elif final_score < 60.0:
        complexity_level = "Moderate (Industrial Grade)"
        complexity_color = "#ffab00"  # Amber
    elif final_score < 80.0:
        complexity_level = "High (Dense QFN / Fine-Pitch)"
        complexity_color = "#ff5252"  # Coral Red
    else:
        complexity_level = "Extreme (High-Density BGA / Micro-Pitch)"
        complexity_color = "#d500f9"  # Purple

    return {
        "score": final_score,
        "level": complexity_level,
        "color": complexity_color,
        "factors": factors,
        "detected_packages": detected_packages if detected_packages else ["Standard SMT Packages (0603, 0805, SOT-23, SOIC)"],
        "manufacturing_notes": manufacturing_notes,
        "density_pads_per_cm2": round(density, 1),
        "is_double_sided": is_double_sided
    }


def analyze_gerber_archive(archive_path_or_dir: str):
    """
    Main entry point: Analyzes a zip file or directory of Gerber files.
    Returns complete structured metrics, complexity rating, and canvas geometry.
    """
    temp_dir = None
    if os.path.isfile(archive_path_or_dir) and zipfile.is_zipfile(archive_path_or_dir):
        temp_dir = tempfile.mkdtemp(prefix='gerber_')
        with zipfile.ZipFile(archive_path_or_dir, 'r') as zf:
            zf.extractall(temp_dir)
        target_dir = temp_dir
    elif os.path.isdir(archive_path_or_dir):
        target_dir = archive_path_or_dir
    else:
        raise ValueError("Invalid Gerber archive path or directory.")

    try:
        # Collect all files
        all_files = []
        for root, dirs, files in os.walk(target_dir):
            for f in files:
                all_files.append(os.path.join(root, f))

        classified_files = defaultdict(list)
        for filepath in all_files:
            layer_type = classify_layer_filename(filepath)
            classified_files[layer_type].append(filepath)

        # 1. Copper Layer Count
        copper_layers = classified_files['copper_top'] + classified_files['copper_bottom'] + classified_files['copper_inner']
        layer_count = len(copper_layers)
        if layer_count == 0:
            # Fallback
            layer_count = 2

        # 2. Check KiCad Job File if available
        job_specs = {}
        if classified_files['gbrjob']:
            try:
                with open(classified_files['gbrjob'][0], 'r', encoding='utf-8') as jf:
                    job_data = json.load(jf)
                    job_specs = job_data.get('GeneralSpecs', {})
                    if 'LayerNumber' in job_specs:
                        layer_count = job_specs['LayerNumber']
            except Exception:
                pass

        # 3. Parse Solder Paste Layers for SMD Pads
        top_smd_pads = 0
        bot_smd_pads = 0
        pad_positions_top = []
        pad_positions_bot = []
        all_apertures = {}

        if classified_files['paste_top']:
            top_paste_res = parse_gerber_file_stats(classified_files['paste_top'][0])
            top_smd_pads = top_paste_res['total_pads']
            pad_positions_top = top_paste_res['pad_positions']
            all_apertures.update(top_paste_res['apertures'])

        if classified_files['paste_bottom']:
            bot_paste_res = parse_gerber_file_stats(classified_files['paste_bottom'][0])
            bot_smd_pads = bot_paste_res['total_pads']
            pad_positions_bot = bot_paste_res['pad_positions']
            all_apertures.update(bot_paste_res['apertures'])

        # Fallback if paste layers are missing: check top copper flashes
        if top_smd_pads == 0 and classified_files['copper_top']:
            top_cu_res = parse_gerber_file_stats(classified_files['copper_top'][0])
            top_smd_pads = top_cu_res['flashes']
            pad_positions_top = top_cu_res['pad_positions']
            all_apertures.update(top_cu_res['apertures'])

        # 4. Parse Drill Files (Excellon)
        tht_pins = 0
        vias_count = 0
        npth_count = 0
        all_drill_hits = []

        for pth_file in classified_files['drill_pth']:
            try:
                pth_res = parse_excellon_file(pth_file)
                tht_pins += pth_res['tht_pins_count']
                vias_count += pth_res['vias_count']
                all_drill_hits.extend([(h[0], h[1], h[2], h[3], True) for h in pth_res['hits']])
            except Exception:
                pass

        for npth_file in classified_files['drill_npth']:
            try:
                npth_res = parse_excellon_file(npth_file)
                npth_count += npth_res['total_holes']
                all_drill_hits.extend([(h[0], h[1], h[2], h[3], False) for h in npth_res['hits']])
            except Exception:
                pass

        # 5. Board Dimensions & Area
        width_mm = 0.0
        height_mm = 0.0
        board_bounds = None

        # Check job specs first
        if 'Size' in job_specs:
            width_mm = float(job_specs['Size'].get('X', 0.0))
            height_mm = float(job_specs['Size'].get('Y', 0.0))

        # Check outline layer for accurate board bounds & dimensions
        if classified_files['outline']:
            try:
                outline_res = parse_gerber_file_stats(classified_files['outline'][0])
                if outline_res['bounds']:
                    b = outline_res['bounds']
                    board_bounds = b
                    if width_mm == 0.0 or height_mm == 0.0:
                        width_mm = round(b[1] - b[0], 2)
                        height_mm = round(b[3] - b[2], 2)
            except Exception:
                pass

        # Fallback to copper bounds
        if width_mm == 0.0 or height_mm == 0.0:
            for cu_file in (classified_files['copper_top'] + classified_files['copper_bottom']):
                try:
                    cu_res = parse_gerber_file_stats(cu_file)
                    if cu_res['bounds']:
                        b = cu_res['bounds']
                        width_mm = round(b[1] - b[0], 2)
                        height_mm = round(b[3] - b[2], 2)
                        board_bounds = b
                        break
                except Exception:
                    pass

        # Final default fallback
        if width_mm <= 0.0:
            width_mm = 100.0
        if height_mm <= 0.0:
            height_mm = 80.0

        area_cm2 = round((width_mm * height_mm) / 100.0, 2)
        area_sq_in = round(area_cm2 / 6.4516, 2)
        width_inch = round(width_mm / 25.4, 2)
        height_inch = round(height_mm / 25.4, 2)

        total_smd_pads = top_smd_pads + bot_smd_pads
        total_pads = total_smd_pads + tht_pins

        # 6. Assembly Complexity AI Analysis
        complexity = analyze_assembly_complexity(
            pad_positions_top,
            pad_positions_bot,
            tht_pins,
            layer_count,
            width_mm,
            height_mm,
            all_apertures
        )

        # 7. Prepare Vector Canvas Geometry (Engineering-grade client-side 2D viewer)
        # Normalize coordinates relative to min_x, min_y
        min_x = board_bounds[0] if board_bounds else (min([p[0] for p in pad_positions_top], default=0.0))
        min_y = board_bounds[2] if board_bounds else (min([p[1] for p in pad_positions_top], default=0.0))

        # Extract true board contour polylines from Edge_Cuts
        outline_polylines = []
        if classified_files['outline']:
            raw_outline = extract_gerber_polylines(classified_files['outline'][0], max_polylines=15000)
            outline_polylines = normalize_polylines(raw_outline, min_x, min_y)

        # Extract silkscreen vectors (component outlines, text labels, pin 1 markers)
        silk_top_polylines = []
        if classified_files['silk_top']:
            raw_silk_top = extract_gerber_polylines(classified_files['silk_top'][0], max_polylines=25000)
            silk_top_polylines = normalize_polylines(raw_silk_top, min_x, min_y)

        silk_bot_polylines = []
        if classified_files['silk_bottom']:
            raw_silk_bot = extract_gerber_polylines(classified_files['silk_bottom'][0], max_polylines=15000)
            silk_bot_polylines = normalize_polylines(raw_silk_bot, min_x, min_y)

        # Extract top copper traces (filtering out huge ground plane hatch lines e.g. D146)
        copper_top_lines = []
        if classified_files['copper_top']:
            raw_cu = extract_gerber_polylines(classified_files['copper_top'][0], max_polylines=3500, filter_aps={'D146'})
            copper_top_lines = normalize_polylines(raw_cu, min_x, min_y)

        # Full aperture-accurate pads (circle, rect, roundrect, obround with exact W and H)
        canvas_pads = []
        for p in pad_positions_top[:2500]:
            shape = p[3] if len(p) > 3 else 'rect'
            w = p[4] if len(p) > 4 else 1.2
            h = p[5] if len(p) > 5 else 1.2
            r = p[6] if len(p) > 6 else 0.0
            canvas_pads.append({
                'x': round(p[0] - min_x, 2),
                'y': round(p[1] - min_y, 2),
                'aperture': p[2] if len(p) > 2 else '',
                'shape': shape,
                'w': round(w, 2),
                'h': round(h, 2),
                'r': round(r, 2),
                'side': 'top'
            })
        for p in pad_positions_bot[:1000]:
            shape = p[3] if len(p) > 3 else 'rect'
            w = p[4] if len(p) > 4 else 1.2
            h = p[5] if len(p) > 5 else 1.2
            r = p[6] if len(p) > 6 else 0.0
            canvas_pads.append({
                'x': round(p[0] - min_x, 2),
                'y': round(p[1] - min_y, 2),
                'aperture': p[2] if len(p) > 2 else '',
                'shape': shape,
                'w': round(w, 2),
                'h': round(h, 2),
                'r': round(r, 2),
                'side': 'bot'
            })

        # Accurate drill holes (diameter, PTH plated rings vs NPTH mounting holes)
        canvas_drills = []
        for h in all_drill_hits[:1500]:
            dx, dy, tid, dia = h[0], h[1], h[2], h[3]
            is_pth = h[4] if len(h) > 4 else (dia <= 0.45)
            canvas_drills.append({
                'x': round(dx - min_x, 2),
                'y': round(dy - min_y, 2),
                'dia': round(dia, 2),
                'r': round(dia / 2.0, 2),
                'pth': is_pth,
                'is_via': dia <= 0.45
            })

        # Stackup details
        layers_detail = []
        for ltype in ['copper_top', 'copper_inner', 'copper_bottom', 'mask_top', 'mask_bottom', 'paste_top', 'paste_bottom', 'silk_top', 'silk_bottom', 'drill_pth', 'drill_npth', 'outline']:
            for f in classified_files[ltype]:
                layers_detail.append({
                    'name': os.path.basename(f),
                    'type': ltype,
                    'size_kb': round(os.path.getsize(f) / 1024, 1)
                })

        return {
            "status": "success",
            "layer_count": layer_count,
            "dimensions": {
                "width_mm": round(width_mm, 2),
                "height_mm": round(height_mm, 2),
                "width_inch": width_inch,
                "height_inch": height_inch,
                "area_cm2": area_cm2,
                "area_sq_in": area_sq_in
            },
            "pads": {
                "smd_top": top_smd_pads,
                "smd_bottom": bot_smd_pads,
                "smd_total": total_smd_pads,
                "tht_pins": tht_pins,
                "vias": vias_count,
                "npth_holes": npth_count,
                "total_pads": total_pads,
                "is_double_sided": bot_smd_pads > 0
            },
            "complexity": complexity,
            "layers_detail": layers_detail,
            "canvas_geometry": {
                "width": round(width_mm, 2),
                "height": round(height_mm, 2),
                "outline": outline_polylines,
                "silk_top": silk_top_polylines,
                "silk_bot": silk_bot_polylines,
                "copper_top": copper_top_lines,
                "pads": canvas_pads,
                "drills": canvas_drills
            }
        }

    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
