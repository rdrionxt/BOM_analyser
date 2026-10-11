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
    designator, description, footprint, quantity, mpn.
    Distinguishes item counter columns (e.g. 'Item #', 'Sl No') from component descriptions.
    """
    mapping: Dict[str, Optional[str]] = {
        'designator': None,
        'description': None,
        'footprint': None,
        'quantity': None,
        'mpn': None
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

        # Description / Value (excluding item counter columns)
        if mapping['description'] is None and not is_item_index_col(norm) and any(k in norm for k in ['description', 'designation', 'value', 'comment', 'spec', 'partname', 'componentname', 'itemdescription', 'itemname', 'val']):
            mapping['description'] = col
            continue

    # Second pass: Secondary description words if not yet found
    if mapping['description'] is None:
        for col in cleaned_headers:
            if col in [mapping['designator'], mapping['quantity'], mapping['footprint'], mapping['mpn']]:
                continue
            norm = normalize_header(col)
            if not is_item_index_col(norm) and any(k in norm for k in ['name', 'title', 'summary', 'device']):
                mapping['description'] = col
                break

    # Third pass fallback: Take the first unassigned non-numeric, non-index column
    if mapping['description'] is None:
        for col in cleaned_headers:
            if col in [mapping['designator'], mapping['quantity'], mapping['footprint'], mapping['mpn']]:
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


def find_best_header_row(raw_df: pd.DataFrame) -> int:
    """
    Scans the first 25 rows of a dataframe to find the row most likely
    to be the column header row (e.g. containing 'Designator', 'Quantity', etc.).
    """
    best_row_idx = 0
    max_score = -1

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

    if max_score <= 0:
        return 0
    return best_row_idx


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
    ext = os.path.splitext(filename.lower())[1] if filename else ""
    is_bytes = isinstance(file_content_or_path, bytes)

    # Detect file type via extension or magic bytes
    is_excel = ext in ['.xlsx', '.xls', '.xlsm']
    if is_bytes and len(file_content_or_path) > 4:
        if file_content_or_path.startswith(b'PK\x03\x04'):
            is_excel = True
        elif file_content_or_path.startswith(b'\xd0\xcf\x11\xe0'):
            is_excel = True

    df = None
    if is_excel:
        try:
            stream = io.BytesIO(file_content_or_path) if is_bytes else file_content_or_path
            raw_excel = pd.read_excel(stream, header=None)
            if not raw_excel.empty:
                header_idx = find_best_header_row(raw_excel)
                raw_headers = deduplicate_headers(raw_excel.iloc[header_idx].tolist())
                data_rows = raw_excel.iloc[header_idx + 1:].copy()
                data_rows.columns = raw_headers
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
            header_idx = find_best_header_row(raw_df)
            raw_headers = deduplicate_headers(raw_df.iloc[header_idx].tolist())
            data_rows = raw_df.iloc[header_idx + 1:].copy()
            data_rows.columns = raw_headers
            df = data_rows
        except Exception as csv_err:
            return {"status": "error", "message": f"CSV parsing failed: {str(csv_err)}", "items": []}

    if df is None or df.empty:
        return {"status": "error", "message": "No data rows found in BOM.", "items": []}

    # Clean and map headers
    df.columns = [str(c).strip() for c in df.columns]
    mapping = map_column_types(list(df.columns))

    des_col = mapping['designator']
    desc_col = mapping['description']
    fp_col = mapping['footprint']
    qty_col = mapping['quantity']
    mpn_col = mapping['mpn']

    items = []
    item_id = 1
    total_components = 0

    for idx, row in df.iterrows():
        designator = safe_cell_str(row, des_col)
        description = safe_cell_str(row, desc_col)
        footprint = safe_cell_str(row, fp_col)
        mpn = safe_cell_str(row, mpn_col)

        # Skip rows where both designator and description are blank
        if not designator and not description:
            continue

        # Skip rows that repeat headers or are summary footers
        norm_row = f"{designator} {description}".lower()
        if 'designator' in norm_row and ('description' in norm_row or 'refdes' in norm_row):
            continue
        if re.search(r'^(total components|total parts|line count|summary|grand total):', norm_row):
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

    return {
        "status": "success",
        "total_line_items": len(items),
        "total_components": total_components,
        "items": items
    }
