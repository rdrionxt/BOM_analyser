"""
Excel BOM Exporter Module
Generates professional formatted Excel workbooks (.xlsx) with clickable links,
supplier part numbers, formulas, and summary metrics.
"""

import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def export_bom_to_excel(sourced_bom_data: dict, project_name: str = "PCB Project BOM"):
    """
    Creates a styled Excel file containing enriched BOM with hyperlinks and pricing.
    Returns bytes buffer.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Enriched BOM"

    # Ensure grid lines are visible
    ws.views.sheetView[0].showGridLines = True

    # Color Palette
    PRIMARY_COLOR = "0F172A"   # Dark slate
    HEADER_BG = "1E293B"       # Slate
    ACCENT_COLOR = "0284C7"    # Sky blue
    ZEBRA_BG = "F8FAFC"        # Light slate
    BORDER_COLOR = "CBD5E1"    # Gray border

    # Title Block
    ws.merge_cells("A1:H1")
    title_cell = ws["A1"]
    title_cell.value = f"Turnkey PCBA - Enriched Bill of Materials ({project_name})"
    title_cell.font = Font(name="Calibri", size=15, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill(start_color=PRIMARY_COLOR, end_color=PRIMARY_COLOR, fill_type="solid")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    # Meta Block
    currency = sourced_bom_data.get("currency", "INR")
    currency_symbol = sourced_bom_data.get("currency_symbol", "₹")
    total_cost = sourced_bom_data.get("total_bom_cost", 0.0)
    total_items = sourced_bom_data.get("total_line_items", 0)
    vendors = ", ".join(sourced_bom_data.get("preferred_websites", []))

    ws["A2"] = f"Total Unique Lines: {total_items}   |   Preferred Suppliers: {vendors.upper()}   |   Total BOM Unit Cost: {currency_symbol}{total_cost:,.2f}"
    ws["A2"].font = Font(name="Calibri", size=10, italic=True, color="475569")
    ws.merge_cells("A2:H2")
    ws.row_dimensions[2].height = 20

    # Headers
    headers = [
        "Item #",
        "Designator (RefDes)",
        "Description / Value",
        "Footprint / Package",
        "Qty",
        "Selected Supplier",
        "Supplier Part # (SKU)",
        f"Unit Price ({currency})",
        f"Line Total ({currency})",
        "Part Web Link"
    ]

    ws.append([])  # Row 3 is empty separator

    header_row_idx = 4
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=header_row_idx, column=col_idx, value=h)
        cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        cell.fill = PatternFill(start_color=HEADER_BG, end_color=HEADER_BG, fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[header_row_idx].height = 28

    thin_border = Border(
        left=Side(style="thin", color=BORDER_COLOR),
        right=Side(style="thin", color=BORDER_COLOR),
        top=Side(style="thin", color=BORDER_COLOR),
        bottom=Side(style="thin", color=BORDER_COLOR)
    )

    items = sourced_bom_data.get("items", [])
    start_data_row = 5

    for idx, it in enumerate(items, 1):
        row_num = start_data_row + idx - 1
        qty = int(it.get("quantity", 1))
        unit_p = float(it.get("unit_price", 0.0))
        url = it.get("url", "")
        vendor = it.get("vendor", "")

        row_data = [
            it.get("id", idx),
            it.get("designator", ""),
            it.get("description", ""),
            it.get("footprint", ""),
            qty,
            vendor,
            it.get("sku", ""),
            unit_p,
            f"=E{row_num}*H{row_num}",  # Excel formula Qty * Unit Price
            "Click to View Part" if url and url != "#" else "N/A"
        ]

        ws.append(row_data)

        # Style data cells
        fill = PatternFill(start_color=ZEBRA_BG if idx % 2 == 0 else "FFFFFF", fill_type="solid")

        for col_idx in range(1, 11):
            c = ws.cell(row=row_num, column=col_idx)
            c.border = thin_border
            c.fill = fill
            c.font = Font(name="Calibri", size=10)

            # Alignments
            if col_idx in [1, 5]:
                c.alignment = Alignment(horizontal="center", vertical="center")
            elif col_idx in [8, 9]:
                c.alignment = Alignment(horizontal="right", vertical="center")
                c.number_format = f"{currency_symbol}#,##0.00"
            elif col_idx == 10:
                c.alignment = Alignment(horizontal="center", vertical="center")
                if url and url != "#":
                    c.hyperlink = url
                    c.font = Font(name="Calibri", size=10, color="0284C7", underline="single")

        ws.row_dimensions[row_num].height = 20

    # Summary Row
    summary_row_num = start_data_row + len(items)
    ws.cell(row=summary_row_num, column=4, value="TOTAL BOM COST:").font = Font(name="Calibri", size=11, bold=True)
    ws.cell(row=summary_row_num, column=4).alignment = Alignment(horizontal="right", vertical="center")

    sum_cell = ws.cell(row=summary_row_num, column=9, value=f"=SUM(I{start_data_row}:I{summary_row_num-1})")
    sum_cell.font = Font(name="Calibri", size=12, bold=True, color="0F172A")
    sum_cell.alignment = Alignment(horizontal="right", vertical="center")
    sum_cell.number_format = f"{currency_symbol}#,##0.00"
    sum_cell.fill = PatternFill(start_color="E2E8F0", fill_type="solid")
    sum_cell.border = thin_border
    ws.row_dimensions[summary_row_num].height = 24

    # Auto-adjust column widths
    column_widths = {
        1: 8,   # Item #
        2: 24,  # Designator
        3: 28,  # Description
        4: 26,  # Footprint
        5: 10,  # Qty
        6: 18,  # Supplier
        7: 20,  # SKU
        8: 16,  # Unit Price
        9: 18,  # Line Total
        10: 22  # Web Link
    }
    for col_idx, width in column_widths.items():
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
