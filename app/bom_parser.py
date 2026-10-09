"""
BOM Parser Module
Parses CSV, TSV, and Excel (XLSX, XLS) Bill of Materials files.
Normalizes columns, calculates quantities, and builds search-optimized queries.
"""

import os
import re
import csv
import io
import pandas as pd

def normalize_header(header: str) -> str:
    """Normalizes header string for fuzzy column mapping."""
    clean = re.sub(r'[^a-zA-Z0-9]', '', str(header).lower())
    return clean

def map_column_types(headers):
    """Maps actual BOM column names to standard keys."""
    mapping = {
        'designator': None,
        'description': None,
        'footprint': None,
        'quantity': None,
        'mpn': None
    }

    for col in headers:
        norm = normalize_header(col)
        if mapping['designator'] is None and any(k in norm for k in ['designator', 'refdes', 'reference', 'ref', 'parts']):
            mapping['designator'] = col
        elif mapping['quantity'] is None and any(k in norm for k in ['quantity', 'qty', 'count', 'total']):
            mapping['quantity'] = col
        elif mapping['footprint'] is None and any(k in norm for k in ['footprint', 'package', 'case', 'pattern']):
            mapping['footprint'] = col
        elif mapping['mpn'] is None and any(k in norm for k in ['mpn', 'mfgpart', 'partnumber', 'mfrpart', 'supplierandref', 'ordercode']):
            mapping['mpn'] = col
        elif mapping['description'] is None and any(k in norm for k in ['description', 'designation', 'value', 'comment', 'item', 'name']):
            mapping['description'] = col

    # Fallbacks if some headers weren't found
    if mapping['description'] is None:
        for col in headers:
            norm = normalize_header(col)
            if col != mapping['designator'] and col != mapping['quantity'] and col != mapping['footprint']:
                mapping['description'] = col
                break

    return mapping


def generate_search_query(description: str, footprint: str, mpn: str = "") -> str:
    """Generates an intelligent, clean search query for electronics distributors."""
    if mpn and len(mpn.strip()) > 3 and not mpn.strip().isdigit():
        clean_mpn = re.sub(r'[\(\)\[\]]', ' ', mpn).strip()
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


def parse_bom_file(file_content_or_path, filename: str = ""):
    """
    Parses BOM from file path or bytes buffer.
    Returns normalized list of component line items with quantities and clean queries.
    """
    ext = os.path.splitext(filename.lower())[1] if filename else ""

    df = None
    if ext in ['.xlsx', '.xls'] or (isinstance(file_content_or_path, bytes) and ext in ['.xlsx', '.xls']):
        if isinstance(file_content_or_path, str):
            df = pd.read_excel(file_content_or_path)
        else:
            df = pd.read_excel(io.BytesIO(file_content_or_path))
    else:
        # CSV or text file
        if isinstance(file_content_or_path, str):
            with open(file_content_or_path, 'r', encoding='utf-8', errors='ignore') as f:
                raw_text = f.read()
        elif isinstance(file_content_or_path, bytes):
            raw_text = file_content_or_path.decode('utf-8', errors='ignore')
        else:
            raw_text = str(file_content_or_path)

        first_few_lines = raw_text.splitlines()[:5]
        sample = "\n".join(first_few_lines)
        delimiter = ','
        if sample.count(';') > sample.count(','):
            delimiter = ';'
        elif sample.count('\t') > sample.count(','):
            delimiter = '\t'

        # Use csv.reader for robust handling of trailing delimiters
        reader = csv.reader(io.StringIO(raw_text), delimiter=delimiter)
        raw_rows = [row for row in reader if any(cell.strip() for cell in row)]
        if not raw_rows:
            return {"status": "error", "message": "Empty BOM file", "items": []}

        raw_header = [h.strip() for h in raw_rows[0]]
        # Pad data rows or trim to max header length
        header_len = len(raw_header)
        data = []
        for r in raw_rows[1:]:
            padded = r + [''] * max(0, header_len - len(r))
            data.append(padded[:header_len])
        df = pd.DataFrame(data, columns=raw_header)

    # Clean headers
    df.columns = [str(c).strip() for c in df.columns]
    mapping = map_column_types(df.columns)

    des_col = mapping['designator']
    desc_col = mapping['description']
    fp_col = mapping['footprint']
    qty_col = mapping['quantity']
    mpn_col = mapping['mpn']

    items = []
    item_id = 1
    total_components = 0

    for idx, row in df.iterrows():
        designator = str(row[des_col]).strip() if des_col and pd.notna(row.get(des_col)) else ""
        description = str(row[desc_col]).strip() if desc_col and pd.notna(row.get(desc_col)) else ""
        footprint = str(row[fp_col]).strip() if fp_col and pd.notna(row.get(fp_col)) else ""
        mpn = str(row[mpn_col]).strip() if mpn_col and pd.notna(row.get(mpn_col)) else ""

        # Quantity calculation
        qty = 1
        if qty_col and pd.notna(row.get(qty_col)):
            val = str(row[qty_col]).strip()
            val_clean = re.sub(r'[^\d]', '', val)
            if val_clean:
                qty = int(val_clean)
        elif designator:
            # Count comma/semicolon/space separated references
            refs = [r.strip() for r in re.split(r'[,;\s]+', designator) if r.strip()]
            qty = max(1, len(refs))

        # Skip headers or empty rows
        if not designator and not description:
            continue
        if description.lower() in ['testpoint', 'jumper_2_open', 'fiducial', 'logo']:
            is_virtual = True
        else:
            is_virtual = False

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
