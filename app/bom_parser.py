"""
BOM Parser Module
Parses CSV, TSV, and Excel (XLSX, XLS) Bill of Materials files.
Includes Smart Header-Offset Detection, Multi-Row Title Scanning,
Fuzzy Column Mapping, Safe Cell Extraction, and Query Generation.
"""

import os
import re
import csv
import io
from typing import Optional, List, Dict, Any
import pandas as pd


def normalize_header(header: str) -> str:
    """Normalizes header string for fuzzy column mapping."""
    return re.sub(r'[^a-zA-Z0-9]', '', str(header).lower())


def map_column_types(headers: List[str]) -> Dict[str, Optional[str]]:
    """
    Maps actual BOM column names to standard keys:
    designator, description, footprint, quantity, mpn, value.
    Distinguishes item counter columns (e.g. 'Item #', 'Sl No') from component descriptions.
    """
    mapping: Dict[str, Optional[str]] = {
        'designator': None,
        'description': None,
        'footprint': None,
        'quantity': None,
        'mpn': None,
        'value': None
    }

    def is_item_index_col(norm_hdr: str) -> bool:
        if norm_hdr in ['item', 'itemno', 'itemnum', 'itemnumber', 'slno', 'sno', 'srno', 'lineno', 'line', 'row', 'no', 'num', 'idx', 'index']:
            return True
        if norm_hdr.startswith('item') and any(s in norm_hdr for s in ['no', 'num', 'id', 'count', 'idx']):
            return True
        return False

    cleaned_headers = [str(h).strip() for h in headers if str(h).strip()]

    # First pass: High-priority matches
    for col in cleaned_headers:
        norm = normalize_header(col)
        if not norm:
            continue

        # Designator / Reference
        if mapping['designator'] is None and any(k in norm for k in ['designator', 'refdes', 'reference', 'ref', 'parts', 'component', 'location']):
            mapping['designator'] = col
            continue

        # Quantity
        if mapping['quantity'] is None and any(k in norm for k in ['quantity', 'qty', 'count', 'total', 'pcs', 'pieces']):
            mapping['quantity'] = col
            continue

        # Footprint / Package
        if mapping['footprint'] is None and any(k in norm for k in ['footprint', 'package', 'case', 'pattern', 'housing', 'encapsulation', 'size']):
            mapping['footprint'] = col
            continue

        # MPN / Part Number / SKU / Order Code
        if mapping['mpn'] is None and any(k in norm for k in ['mpn', 'mfgpart', 'partnumber', 'mfrpart', 'supplierandref', 'ordercode', 'mfgpn', 'pn', 'partno', 'sku', 'supplierpart']):
            mapping['mpn'] = col
            continue

        # Value
        if mapping['value'] is None and any(k in norm for k in ['value', 'val']):
            mapping['value'] = col
            continue

        # Description / Value (excluding item counter columns)
        if mapping['description'] is None and not is_item_index_col(norm) and any(k in norm for k in ['description', 'designation', 'value', 'comment', 'spec', 'partname', 'componentname', 'itemdescription', 'itemname', 'val']):
            mapping['description'] = col
            continue

    # Second pass: Secondary description words if not yet found
    if mapping['description'] is None:
        for col in cleaned_headers:
            if col in [mapping['designator'], mapping['quantity'], mapping['footprint'], mapping['mpn'], mapping['value']]:
                continue
            norm = normalize_header(col)
            if not is_item_index_col(norm) and any(k in norm for k in ['name', 'title', 'summary', 'device', 'comment']):
                mapping['description'] = col
                break

    # If description is still None but value is found, use value as description
    if mapping['description'] is None and mapping['value'] is not None:
        mapping['description'] = mapping['value']

    # Third pass fallback: Take the first unassigned non-numeric, non-index column
    if mapping['description'] is None:
        for col in cleaned_headers:
            if col in [mapping['designator'], mapping['quantity'], mapping['footprint'], mapping['mpn'], mapping['value']]:
                continue
            norm = normalize_header(col)
            if not is_item_index_col(norm) and norm and not norm.isdigit() and 'unnamed' not in norm:
                mapping['description'] = col
                break

    return mapping


def safe_cell_str(row: Any, col_name: Optional[str]) -> str:
    """Safely extracts and cleans a string value from a pandas row without Series ambiguity."""
    if not col_name:
        return ""
    try:
        val = row.get(col_name)
    except Exception:
        return ""

    if val is None:
        return ""
    if isinstance(val, pd.Series):
        non_null = val.dropna()
        val = non_null.iloc[0] if not non_null.empty else ""
    if pd.isna(val):
        return ""
    s = str(val).strip()
    return "" if s.lower() in ["nan", "none", "null", "undefined"] else s


def generate_search_query(description: str, footprint: str, mpn: str = "") -> str:
    """Generates an intelligent, clean search query for electronics distributors."""
    if mpn and len(mpn.strip()) > 3 and not mpn.strip().isdigit():
        clean_mpn = re.sub(r'[\(\)\[\]]', ' ', mpn).strip()
        # If supplier SKU has prefix like ROBU- or SR-, use the part suffix or full code
        return clean_mpn.split()[0]

    desc = str(description).strip() if description else ""
    fp = str(footprint).strip() if footprint else ""

    desc_clean = re.sub(r'\(.*?\)', '', desc).strip()
    if not desc_clean:
        desc_clean = desc

    # Extract standard package sizes from footprint: handles KiCad R_0603_1608Metric, SOT-23-5, etc.
    pkg_match = re.search(r'(?:^|[^a-zA-Z0-9])(0201|0402|0603|0805|1206|1210|2512|SOT-?23(?:-\d)?|SOD-?123[A-Z]?|SOD-?323|LQFP-?\d+|QFN-?\d+|SOIC-?\d+|TSSOP-?\d+)(?:$|[^a-zA-Z0-9])', fp, re.IGNORECASE)
    pkg_str = pkg_match.group(1).upper() if pkg_match else ""

    # Identify component category (check potentiometer/trimmer before general resistor)
    cat_str = ""
    desc_lower = desc.lower()
    fp_lower = fp.lower()

    if 'potentiometer' in desc_lower or 'bourns' in fp_lower or '3296' in fp_lower:
        cat_str = "potentiometer"
        if not pkg_str and '3296' in fp:
            pkg_str = "3296"
    elif re.search(r'(\b\d+(?:\.\d+)?[kKmMrR]\b|\bohm\b|\bresistor\b)', desc_lower):
        cat_str = "resistor"
    elif re.search(r'(\b\d+(?:\.\d+)?[pnuU]?[fF]\b|\bcapacitor\b|\bcap\b)', desc_lower):
        cat_str = "capacitor"
    elif re.search(r'(\b\d+(?:\.\d+)?[uUnN]?[hH]\b|\binductor\b)', desc_lower):
        cat_str = "inductor"
    elif 'led' in desc_lower or 'led' in fp_lower:
        cat_str = "LED"
    elif 'diode' in desc_lower or 'zener' in desc_lower or 'zenor' in desc_lower:
        cat_str = "diode"
    elif 'jumper' in desc_lower or 'testpoint' in desc_lower:
        cat_str = "jumper"

    # If desc has STM32 / ESP32 / IC part number, use it directly (strip trailing KiCad 'x' wildcard)
    if re.search(r'\b(STM32|ESP32|ATMEGA|RP2040|AP7366|LM\d+|AMS1117)\w*', desc_clean, re.IGNORECASE):
        ic_match = re.search(r'\b([A-Za-z0-9\-_]{5,})\b', desc_clean)
        if ic_match:
            ic_part = ic_match.group(1)
            if re.search(r'[A-Za-z0-9][xX]$', ic_part):
                ic_part = ic_part[:-1]
            return ic_part

    # Assemble query terms
    parts = []
    if desc_clean:
        parts.append(desc_clean)

    if pkg_str and pkg_str not in desc_clean.upper():
        parts.append(pkg_str)

    if cat_str and cat_str.lower() not in desc_clean.lower():
        parts.append(cat_str)

    query = " ".join(parts).strip()
    query = re.sub(r'\s+', ' ', query)
    return query if query else desc


def find_best_header_row(raw_df: pd.DataFrame) -> tuple:
    """
    Scans the first 25 rows of a dataframe to find the row most likely
    to be the column header row (e.g. containing 'Designator', 'Quantity', etc.).
    Returns (best_row_idx, max_score). If max_score <= 0, no valid header was found.
    """
    best_row_idx = 0
    max_score = 0

    keywords = [
        'designator', 'reference', 'refdes', 'ref', 'parts', 'component',
        'description', 'designation', 'value', 'comment',
        'footprint', 'package', 'case', 'pattern', 'housing',
        'quantity', 'qty', 'count', 'total',
        'mpn', 'mfgpart', 'partnumber', 'mfrpart', 'ordercode', 'sku'
    ]

    scan_limit = min(25, len(raw_df))
    for r_idx in range(scan_limit):
        row_vals = raw_df.iloc[r_idx].dropna().astype(str).tolist()
        row_text = " ".join([v.lower() for v in row_vals])

        score = sum(1 for kw in keywords if re.search(r'\b' + kw, row_text))
        if score > max_score:
            max_score = score
            best_row_idx = r_idx

    return best_row_idx, max_score


def infer_columns_from_content(df: pd.DataFrame) -> Dict[str, Optional[Any]]:
    """
    Intelligently determines which column maps to designator, quantity,
    footprint, description, value, and mpn by inspecting cell contents
    when explicit headers are missing (headerless BOMs) or ambiguous.
    """
    mapping: Dict[str, Optional[Any]] = {
        'designator': None,
        'description': None,
        'footprint': None,
        'quantity': None,
        'mpn': None,
        'value': None
    }
    col_scores: Dict[str, Dict[Any, float]] = {k: {} for k in mapping}
    item_index_cols = set()

    des_pat = re.compile(r'^[A-Za-z]{1,4}\d+([,\s\-/]+[A-Za-z]{1,4}\d+)*$', re.IGNORECASE)
    des_token = re.compile(r'\b[A-Za-z]{1,4}\d+\b')
    val_pat = re.compile(r'^\s*\d+(?:\.\d+)?\s*(?:[pnuU]?[fF]|[kKmMgG]?[oO]?[hH][mM]?|[kKmMrReE]|[uUnNmMgG]?[hH]|[vV]|[mM][hH][zZ]|%)\s*$', re.IGNORECASE)
    fp_keywords = [
        '01005', '0201', '0402', '0603', '0805', '1206', '1210', '1812', '2010', '2512',
        'sot', 'sod', 'qfn', 'qfp', 'lqfp', 'tqfp', 'dip', 'soic', 'sop', 'tssop', 'msop', 'ssop',
        'to-220', 'to-92', 'to-247', 'to-252', 'to-263', 'd-pak', 'dpak', 'd2pak',
        'axial', 'radial', 'smd', 'smt', 'tht', 'pitch', 'pin', 'header', 'socket', 'plug',
        'connector', 'strip', 'pad', 'terminal', 'through_hole'
    ]

    sample_limit = min(50, len(df))
    sample_df = df.iloc[:sample_limit]

    for col in df.columns:
        vals = [
            str(v).strip()
            for v in sample_df[col].dropna()
            if str(v).strip() and str(v).lower() not in ['nan', 'none', 'null', '', 'undefined']
        ]
        if not vals:
            continue
        n_vals = len(vals)

        # Check if strictly sequential integers (item_index / S.No: 1, 2, 3...)
        try:
            num_series = pd.to_numeric(pd.Series(vals))
            if len(num_series) >= 3 and (num_series.diff().iloc[1:] == 1).all() and num_series.iloc[0] in [0, 1]:
                item_index_cols.add(col)
                continue
        except Exception:
            pass

        # Designator scoring
        des_full_matches = sum(1 for v in vals if des_pat.match(v))
        des_token_matches = sum(1 for v in vals if len(des_token.findall(v)) >= 1 and len(v.split()) <= 1)
        col_scores['designator'][col] = (max(des_full_matches, des_token_matches) / n_vals) * 100

        # Quantity scoring
        qty_count = 0
        for v in vals:
            try:
                flt = float(v)
                if 1 <= flt <= 10000 and flt == int(flt):
                    qty_count += 1
            except Exception:
                pass
        col_scores['quantity'][col] = (qty_count / n_vals) * 90 if col not in item_index_cols else 0

        # Value scoring
        val_matches = sum(1 for v in vals if val_pat.match(v))
        col_scores['value'][col] = (val_matches / n_vals) * 100

        # Footprint scoring
        fp_matches = sum(1 for v in vals if any(k in v.lower() for k in fp_keywords))
        col_scores['footprint'][col] = (fp_matches / n_vals) * 85

        # MPN scoring (alphanumeric, has letters and digits, uppercase, len >= 5, no spaces)
        mpn_matches = sum(
            1 for v in vals
            if len(v) >= 5 and re.search(r'[A-Za-z]', v) and re.search(r'\d', v)
            and ' ' not in v and not val_pat.match(v) and not des_pat.match(v)
        )
        col_scores['mpn'][col] = (mpn_matches / n_vals) * 75

        # Description scoring (longer text, multiple words)
        desc_matches = sum(1 for v in vals if ' ' in v or '_' in v or len(v) > 8)
        col_scores['description'][col] = (desc_matches / n_vals) * 60

    # Greedily assign best distinct columns
    used_cols = set(item_index_cols)
    for role in ['designator', 'quantity', 'mpn', 'value', 'footprint', 'description']:
        ranked = sorted(col_scores[role].items(), key=lambda x: x[1], reverse=True)
        for c, score in ranked:
            if c not in used_cols and score >= 20:
                mapping[role] = c
                used_cols.add(c)
                break

    # Fallback for description if not assigned: pick any remaining non-used column
    if mapping['description'] is None:
        rem = [c for c in df.columns if c not in used_cols]
        if rem:
            mapping['description'] = rem[0]
            used_cols.add(rem[0])

    return mapping


def deduplicate_headers(headers: List[Any]) -> List[str]:
    """Ensures all column headers are strings and uniquely named."""
    seen: Dict[str, int] = {}
    result: List[str] = []
    for h in headers:
        base = str(h).strip()
        if not base or base.lower() == 'nan':
            base = 'unnamed'
        if base in seen:
            seen[base] += 1
            result.append(f"{base}_{seen[base]}")
        else:
            seen[base] = 0
            result.append(base)
    return result



def detect_delimiter(raw_text: str) -> str:
    """Intelligently detects delimiter (comma, semicolon, tab, pipe) even if commas exist inside quotes."""
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    if not lines:
        return ','

    first_few = "\n".join(lines[:10])
    try:
        dialect = csv.Sniffer().sniff(first_few, delimiters=[',', ';', '\t', '|'])
        if dialect and dialect.delimiter:
            return dialect.delimiter
    except Exception:
        pass

    first_line = lines[0]
    if first_line.count(';') >= 2 and first_line.count(';') >= first_line.count(','):
        return ';'
    if first_line.count('\t') >= 2:
        return '\t'
    if first_line.count('|') >= 2:
        return '|'

    return ','


def parse_bom_file(file_content_or_path, filename: str = "") -> Dict[str, Any]:
    """
    Parses BOM from file path or bytes buffer.
    Supports CSV, TSV, XLSX, and XLS with automated header-row detection.
    """
    if isinstance(file_content_or_path, str) and not filename:
        filename = os.path.basename(file_content_or_path)
    ext = os.path.splitext(filename.lower())[1] if filename else ""
    is_bytes = isinstance(file_content_or_path, bytes)

    # Detect file type via extension or magic bytes (PK\x03\x04 for .xlsx, \xd0\xcf\x11\xe0 for .xls)
    is_excel = ext in ['.xlsx', '.xls', '.xlsm']
    if is_bytes and len(file_content_or_path) >= 4:
        if file_content_or_path.startswith(b'PK\x03\x04') or file_content_or_path.startswith(b'\xd0\xcf\x11\xe0'):
            is_excel = True
    elif isinstance(file_content_or_path, str) and os.path.exists(file_content_or_path):
        try:
            with open(file_content_or_path, 'rb') as f_head:
                magic = f_head.read(8)
            if magic.startswith(b'PK\x03\x04') or magic.startswith(b'\xd0\xcf\x11\xe0'):
                is_excel = True
        except Exception:
            pass

    df = None
    has_header = True
    if is_excel:
        try:
            stream = io.BytesIO(file_content_or_path) if is_bytes else file_content_or_path
            raw_excel = pd.read_excel(stream, header=None)
            if not raw_excel.empty:
                header_idx, score = find_best_header_row(raw_excel)
                if score > 0:
                    raw_headers = deduplicate_headers(raw_excel.iloc[header_idx].tolist())
                    data_rows = raw_excel.iloc[header_idx + 1:].copy()
                    data_rows.columns = raw_headers
                    df = data_rows
                else:
                    has_header = False
                    data_rows = raw_excel.copy()
                    data_rows.columns = [f"col_{i}" for i in range(data_rows.shape[1])]
                    df = data_rows
        except Exception as excel_err:
            return {"status": "error", "message": f"Excel parsing failed: {str(excel_err)}", "items": []}
    else:
        # CSV or plain text
        raw_text = ""
        if isinstance(file_content_or_path, str):
            for enc in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
                try:
                    with open(file_content_or_path, 'r', encoding=enc, errors='ignore') as f:
                        raw_text = f.read()
                    break
                except Exception:
                    continue
        elif is_bytes:
            for enc in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
                try:
                    raw_text = file_content_or_path.decode(enc)
                    break
                except Exception:
                    continue
            if not raw_text:
                raw_text = file_content_or_path.decode('utf-8', errors='ignore')
        else:
            raw_text = str(file_content_or_path)

        delimiter = detect_delimiter(raw_text)

        try:
            reader = csv.reader(io.StringIO(raw_text), delimiter=delimiter)
            raw_rows = [row for row in reader if any(cell.strip() for cell in row)]
            if not raw_rows:
                return {"status": "error", "message": "Empty BOM file", "items": []}

            raw_df = pd.DataFrame(raw_rows)
            header_idx, score = find_best_header_row(raw_df)
            if score > 0:
                raw_headers = deduplicate_headers(raw_df.iloc[header_idx].tolist())
                data_rows = raw_df.iloc[header_idx + 1:].copy()
                data_rows.columns = raw_headers
                df = data_rows
            else:
                has_header = False
                data_rows = raw_df.copy()
                data_rows.columns = [f"col_{i}" for i in range(data_rows.shape[1])]
                df = data_rows
        except Exception as csv_err:
            return {"status": "error", "message": f"CSV parsing failed: {str(csv_err)}", "items": []}

    if df is None or df.empty:
        return {"status": "error", "message": "No data rows found in BOM.", "items": []}

    # Clean and map headers
    df.columns = [str(c).strip() for c in df.columns]
    mapping = map_column_types(list(df.columns)) if has_header else {
        'designator': None,
        'description': None,
        'footprint': None,
        'quantity': None,
        'mpn': None,
        'value': None
    }

    # If headerless OR critical columns missing, infer from content
    if not has_header or mapping.get('designator') is None or (mapping.get('footprint') is None and mapping.get('description') is None):
        inferred = infer_columns_from_content(df)
        for key in ['designator', 'description', 'footprint', 'quantity', 'mpn', 'value']:
            if mapping.get(key) is None and inferred.get(key) is not None:
                mapping[key] = inferred[key]

    des_col = mapping.get('designator')
    val_col = mapping.get('value')
    desc_col = mapping.get('description')
    fp_col = mapping.get('footprint')
    qty_col = mapping.get('quantity')
    mpn_col = mapping.get('mpn')

    items = []
    item_id = 1
    total_components = 0

    for idx, row in df.iterrows():
        designator = safe_cell_str(row, des_col)
        raw_val = safe_cell_str(row, val_col)
        raw_desc = safe_cell_str(row, desc_col)
        footprint = safe_cell_str(row, fp_col)
        mpn = safe_cell_str(row, mpn_col)

        # Merge value with description if value is distinct
        if raw_val and raw_desc:
            description = f"{raw_val} {raw_desc}".strip() if raw_val not in raw_desc else raw_desc
        elif raw_val:
            description = raw_val
        else:
            description = raw_desc

        # Skip rows where both designator and description are blank
        if not designator and not description:
            continue

        # Skip rows that repeat headers or are summary footers
        full_row_text = f"{designator} {description} {footprint} {mpn}".lower()
        if 'designator' in full_row_text and ('description' in full_row_text or 'refdes' in full_row_text):
            continue
        if any(term in full_row_text for term in ['total bom cost', 'grand total', 'total components', 'total parts', 'line count', 'summary:']):
            continue

        # Quantity calculation
        qty = 1
        raw_qty = safe_cell_str(row, qty_col)
        if raw_qty:
            try:
                qty = max(1, int(float(raw_qty)))
            except Exception:
                val_clean = re.sub(r'[^\d]', '', raw_qty)
                if val_clean:
                    qty = max(1, int(val_clean))
        elif designator:
            # Count comma/semicolon/space separated references
            refs = [r.strip() for r in re.split(r'[,;\s]+', designator) if r.strip() and re.match(r'^[A-Za-z]', r)]
            if refs:
                qty = max(1, len(refs))

        # Check for virtual components (testpoints, fiducials, jumpers, mounting holes)
        is_virtual = False
        norm_check = f"{description} {footprint}".lower()
        if any(v in norm_check for v in ['testpoint', 'jumper_2_open', 'fiducial', 'logo', 'mounting hole', 'virtual', 'n/a (virtual)']):
            is_virtual = True

        query = generate_search_query(description, footprint, mpn)

        items.append({
            "id": item_id,
            "designator": designator,
            "description": description,
            "footprint": footprint,
            "quantity": qty,
            "mpn": mpn,
            "search_query": query,
            "is_virtual": is_virtual
        })
        item_id += 1
        total_components += qty

    # Enrich items with intelligent pad estimation
    from app.bom_pad_calculator import calculate_bom_pads
    pad_calc = calculate_bom_pads(items)

    return {
        "status": "success",
        "total_line_items": len(items),
        "total_components": total_components,
        "items": pad_calc["items"],
        "pad_analysis": pad_calc["summary"],
        "unresolved_items": pad_calc["unresolved_items"]
    }
