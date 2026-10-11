"""
BOM Pad Calculator Module
Calculates the number of SMD pads and Through-Hole (THT) pins from BOM component data
(designators, descriptions, footprints, MPNs, and quantities).
Provides automatic classification, package recognition heuristics, datasheet lookup URLs,
and identifies components requiring manual feed verification.
"""

import re
import urllib.parse
from typing import Dict, List, Any, Optional

# Database of well-known manufacturer part numbers (MPNs) and their exact package/pad counts
KNOWN_MPN_DATABASE: Dict[str, Dict[str, Any]] = {
    # Microcontrollers & Processors
    "STM32F446RET": {"pads": 64, "type": "SMD", "package": "LQFP-64", "leads": 64, "thermal_pad": 0},
    "STM32F103C8T": {"pads": 48, "type": "SMD", "package": "LQFP-48", "leads": 48, "thermal_pad": 0},
    "STM32F405RGT": {"pads": 64, "type": "SMD", "package": "LQFP-64", "leads": 64, "thermal_pad": 0},
    "STM32F407VET": {"pads": 100, "type": "SMD", "package": "LQFP-100", "leads": 100, "thermal_pad": 0},
    "ATMEGA328P-AU": {"pads": 32, "type": "SMD", "package": "TQFP-32", "leads": 32, "thermal_pad": 0},
    "ATMEGA328P-PU": {"pads": 28, "type": "THT", "package": "DIP-28", "leads": 28, "thermal_pad": 0},
    "ESP32-WROOM-32": {"pads": 39, "type": "SMD", "package": "Module-38+EP", "leads": 38, "thermal_pad": 1},
    "ESP8266-12F": {"pads": 16, "type": "SMD", "package": "Module-16", "leads": 16, "thermal_pad": 0},
    "RP2040": {"pads": 57, "type": "SMD", "package": "QFN-56+EP", "leads": 56, "thermal_pad": 1},

    # Power Management & Regulators
    "AP7366EA": {"pads": 5, "type": "SMD", "package": "SOT-23-5", "leads": 5, "thermal_pad": 0},
    "AP7366": {"pads": 5, "type": "SMD", "package": "SOT-23-5", "leads": 5, "thermal_pad": 0},
    "LM73100RPW": {"pads": 10, "type": "SMD", "package": "VQFN-10", "leads": 10, "thermal_pad": 0},
    "LM73100": {"pads": 10, "type": "SMD", "package": "VQFN-10", "leads": 10, "thermal_pad": 0},
    "TPS63700DRC": {"pads": 11, "type": "SMD", "package": "VSON-10+EP", "leads": 10, "thermal_pad": 1},
    "TPS63700": {"pads": 11, "type": "SMD", "package": "VSON-10+EP", "leads": 10, "thermal_pad": 1},
    "BQ25306RTE": {"pads": 17, "type": "SMD", "package": "WQFN-16+EP", "leads": 16, "thermal_pad": 1},
    "BQ25306": {"pads": 17, "type": "SMD", "package": "WQFN-16+EP", "leads": 16, "thermal_pad": 1},
    "MPQ3425DL": {"pads": 15, "type": "SMD", "package": "QFN-14+EP", "leads": 14, "thermal_pad": 1},
    "MPQ3425": {"pads": 15, "type": "SMD", "package": "QFN-14+EP", "leads": 14, "thermal_pad": 1},
    "TPS564252DRL": {"pads": 6, "type": "SMD", "package": "SOT-563", "leads": 6, "thermal_pad": 0},
    "TPS564252": {"pads": 6, "type": "SMD", "package": "SOT-563", "leads": 6, "thermal_pad": 0},
    "AMS1117": {"pads": 4, "type": "SMD", "package": "SOT-223", "leads": 3, "thermal_pad": 1},
    "LM1117": {"pads": 4, "type": "SMD", "package": "SOT-223", "leads": 3, "thermal_pad": 1},
    "LM7805": {"pads": 3, "type": "THT", "package": "TO-220", "leads": 3, "thermal_pad": 0},
    "VRB1205YMD-5WR3": {"pads": 6, "type": "THT", "package": "DIP-6 DC-DC", "leads": 6, "thermal_pad": 0},
    "VRB1205": {"pads": 6, "type": "THT", "package": "DIP-6 DC-DC", "leads": 6, "thermal_pad": 0},

    # Analog & Interface ICs
    "OPA1622": {"pads": 11, "type": "SMD", "package": "SON-10+EP", "leads": 10, "thermal_pad": 1},
    "PCM5102A": {"pads": 20, "type": "SMD", "package": "TSSOP-20", "leads": 20, "thermal_pad": 0},
    "PGA2311U": {"pads": 16, "type": "SMD", "package": "SOIC-16W", "leads": 16, "thermal_pad": 0},
    "ISO6521DR": {"pads": 8, "type": "SMD", "package": "SOIC-8", "leads": 8, "thermal_pad": 0},
    "ISO6521": {"pads": 8, "type": "SMD", "package": "SOIC-8", "leads": 8, "thermal_pad": 0},
    "FM25CL64B-G": {"pads": 8, "type": "SMD", "package": "SOIC-8", "leads": 8, "thermal_pad": 0},
    "FM25CL64": {"pads": 8, "type": "SMD", "package": "SOIC-8", "leads": 8, "thermal_pad": 0},
    "CH340G": {"pads": 16, "type": "SMD", "package": "SOIC-16", "leads": 16, "thermal_pad": 0},
    "CH340C": {"pads": 16, "type": "SMD", "package": "SOIC-16", "leads": 16, "thermal_pad": 0},
    "CP2102": {"pads": 29, "type": "SMD", "package": "QFN-28+EP", "leads": 28, "thermal_pad": 1},
    "FT232RL": {"pads": 28, "type": "SMD", "package": "SSOP-28", "leads": 28, "thermal_pad": 0},
    "MAX4466EXK": {"pads": 5, "type": "SMD", "package": "SC-70-5", "leads": 5, "thermal_pad": 0},
    "MAX4466": {"pads": 5, "type": "SMD", "package": "SC-70-5", "leads": 5, "thermal_pad": 0},
    "NX5L2750CGUX": {"pads": 10, "type": "SMD", "package": "XQFN-10", "leads": 10, "thermal_pad": 0},
    "NX5L2750": {"pads": 10, "type": "SMD", "package": "XQFN-10", "leads": 10, "thermal_pad": 0},
    "D3V3XA4B10LP": {"pads": 10, "type": "SMD", "package": "UDFN-10", "leads": 10, "thermal_pad": 0},

    # Discrete Transistors & MOSFETs
    "BC847": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "BC846": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "BC857": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "2N7002": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "BSS138": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "SI2302": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "STL6P3LLH6": {"pads": 8, "type": "SMD", "package": "PowerFLAT-5x6", "leads": 8, "thermal_pad": 0},
    "AO3400": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},
    "AO3401": {"pads": 3, "type": "SMD", "package": "SOT-23", "leads": 3, "thermal_pad": 0},

    # Diodes
    "MM1Z3B3": {"pads": 2, "type": "SMD", "package": "SOD-123", "leads": 2, "thermal_pad": 0},
    "LL4148": {"pads": 2, "type": "SMD", "package": "MiniMELF", "leads": 2, "thermal_pad": 0},
    "1N4148": {"pads": 2, "type": "THT", "package": "DO-35", "leads": 2, "thermal_pad": 0},
    "SS34": {"pads": 2, "type": "SMD", "package": "SMA", "leads": 2, "thermal_pad": 0},
    "SL02": {"pads": 2, "type": "SMD", "package": "SMF", "leads": 2, "thermal_pad": 0},
    "B5819W": {"pads": 2, "type": "SMD", "package": "SOD-123", "leads": 2, "thermal_pad": 0},

    # Electromechanical & Connectors
    "G6K-2F": {"pads": 8, "type": "SMD", "package": "SMD Relay 8-pin", "leads": 8, "thermal_pad": 0},
    "G6K2FYTRDC5": {"pads": 8, "type": "SMD", "package": "SMD Relay 8-pin", "leads": 8, "thermal_pad": 0},
    "54-00174": {"pads": 4, "type": "SMD", "package": "Audio Jack 4-pin", "leads": 4, "thermal_pad": 0},
    "NRJ4HH": {"pads": 4, "type": "THT", "package": "Neutrik 1/4in Jack 4-pin", "leads": 4, "thermal_pad": 0},
    "1048": {"pads": 4, "type": "THT", "package": "Keystone Battery Clip 4-pin", "leads": 4, "thermal_pad": 0},
    "MICROSDCARD": {"pads": 13, "type": "SMD", "package": "MicroSD Socket 9+4", "leads": 9, "thermal_pad": 4},
}

def generate_datasheet_url(mpn: str, description: str = "") -> str:
    """Generates direct lookup URLs for datasheets and pinouts."""
    query = (mpn if mpn and len(mpn.strip()) > 2 else description).strip()
    clean_q = re.sub(r'[\(\)\[\]]', '', query).strip()
    encoded = urllib.parse.quote_plus(clean_q)
    return f"https://www.alldatasheet.com/view.jsp?Searchword={encoded}"

def generate_google_pinout_url(mpn: str, description: str = "", footprint: str = "") -> str:
    """Generates direct Google search URL for pinout and package drawings."""
    target = f"{mpn or description} {footprint} datasheet pinout package"
    clean_q = re.sub(r'\s+', ' ', target).strip()
    return f"https://www.google.com/search?q={urllib.parse.quote_plus(clean_q)}"

def estimate_component_pads(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Intelligently determines the number of solder pads per unit, SMT vs THT classification,
    package category, confidence level, and datasheet reference link for a single BOM component.
    """
    des = str(item.get("designator", "")).strip()
    desc = str(item.get("description", "")).strip()
    fp = str(item.get("footprint", "")).strip()
    mpn = str(item.get("mpn", "")).strip()
    qty = max(1, int(item.get("quantity", 1)))

    first_des = re.split(r'[,;\s]+', des)[0] if des else ""
    des_prefix = re.match(r'^([A-Za-z]+)', first_des).group(1).upper() if re.match(r'^([A-Za-z]+)', first_des) else ""

    text_to_check = f"{desc} {fp} {mpn}".upper()
    datasheet_url = generate_datasheet_url(mpn or desc)
    google_url = generate_google_pinout_url(mpn, desc, fp)

    # -------------------------------------------------------------
    # 1. Check known MPN database
    # -------------------------------------------------------------
    for key, val in KNOWN_MPN_DATABASE.items():
        if key.upper() in text_to_check:
            pads = val["pads"]
            return {
                "pads_per_unit": pads,
                "pad_type": val["type"],
                "package_name": val["package"],
                "line_total_pads": pads * qty,
                "confidence": 1.0,
                "is_manual": False,
                "resolution_source": f"Known IC Database ({key})",
                "datasheet_url": datasheet_url,
                "google_pinout_url": google_url,
                "notes": f"{val['package']} ({pads} pads)"
            }

    # -------------------------------------------------------------
    # 2. Resistors, Capacitors, Inductors, Diodes, Ferrites, LEDs (Straightforward 2 Pads)
    # -------------------------------------------------------------
    is_passive_prefix = des_prefix in ["R", "C", "L", "D", "FB", "F", "Z", "LED"]
    is_passive_text = any(
        kw in text_to_check for kw in [
            "RESISTOR", "CAPACITOR", "INDUCTOR", "FERRITE", "FUSE", "ZENER",
            "DIODE", "LED", "MLCC", "0603", "0805", "0402", "1206", "1210",
            "1812", "2010", "2512", "SOD-123", "SOD-323", "SMA", "SMB", "SMC",
            "MINIMELF", "MELF", "SMF"
        ]
    )

    if is_passive_prefix or is_passive_text:
        # Check if it is a resistor array / resistor network
        if any(arr in text_to_check for arr in ["ARRAY", "RPACK", "NET", "RN", "EXB", "CAY"]):
            m_arr = re.search(r'(\d+)X(\d+)|(\d+)[-_]?(?:PIN|RES|WAY)', text_to_check)
            if m_arr:
                elem_count = int(m_arr.group(1) or m_arr.group(3))
                pads = elem_count * 2
                return {
                    "pads_per_unit": pads,
                    "pad_type": "SMD",
                    "package_name": f"Resistor Array ({pads}-pad)",
                    "line_total_pads": pads * qty,
                    "confidence": 0.95,
                    "is_manual": False,
                    "resolution_source": "Array Heuristic",
                    "datasheet_url": datasheet_url,
                    "google_pinout_url": google_url,
                    "notes": f"Multi-resistor network ({pads} pads)"
                }

        # Check for electrolytic / radial THT capacitors vs SMD chip capacitors
        is_tht = any(th in fp.lower() for th in ["radial", "tht", "through_hole", "dip", "axial"])
        # E.g. CP_Elec_6.3x4.5 is typically SMD aluminum electrolytic (2 pads)
        pad_type = "THT" if is_tht else "SMD"
        pkg = "Chip 2-Pad"
        if re.search(r'\b(0201|0402|0603|0805|1206|1210|2512)\b', fp):
            m_pkg = re.search(r'\b(0201|0402|0603|0805|1206|1210|2512)\b', fp)
            pkg = f"SMD {m_pkg.group(1)}"
        elif "SOD" in fp:
            pkg = "SOD Diode"
        elif "CP_ELEC" in fp.upper():
            pkg = "Electrolytic Cap"

        return {
            "pads_per_unit": 2,
            "pad_type": pad_type,
            "package_name": pkg,
            "line_total_pads": 2 * qty,
            "confidence": 1.0,
            "is_manual": False,
            "resolution_source": "Standard 2-Terminal Passive Rule",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "Standard 2-pad component (SMD/THT)"
        }

    # -------------------------------------------------------------
    # 3. Testpoints, Solder Jumpers, Fiducials
    # -------------------------------------------------------------
    if des_prefix == "TP" or "TESTPOINT" in text_to_check:
        return {
            "pads_per_unit": 1,
            "pad_type": "SMD",
            "package_name": "Test Point Pad",
            "line_total_pads": 1 * qty,
            "confidence": 1.0,
            "is_manual": False,
            "resolution_source": "Testpoint Rule (1 Pad)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "Single test pad"
        }

    if des_prefix in ["JP", "JMP"] or "JUMPER" in text_to_check:
        m_jmp = re.search(r'Jumper[-_]?(\d+)', fp, re.IGNORECASE)
        pads = int(m_jmp.group(1)) if m_jmp else 2
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD",
            "package_name": f"Solder Jumper ({pads}-pad)",
            "line_total_pads": pads * qty,
            "confidence": 1.0,
            "is_manual": False,
            "resolution_source": f"Solder Jumper ({pads} pads)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Configurable bridge ({pads} pads)"
        }

    if "FIDUCIAL" in text_to_check or "LOGO" in text_to_check:
        return {
            "pads_per_unit": 0,
            "pad_type": "SMD",
            "package_name": "Fiducial / Marker",
            "line_total_pads": 0,
            "confidence": 1.0,
            "is_manual": False,
            "resolution_source": "Optical Marker (0 Pads)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "Non-soldered optical mark"
        }

    # -------------------------------------------------------------
    # 4. Potentiometers / Trimmers
    # -------------------------------------------------------------
    if des_prefix in ["RV", "POT", "VR"] or "POTENTIOMETER" in text_to_check or "3296" in text_to_check:
        return {
            "pads_per_unit": 3,
            "pad_type": "THT" if "3296" in fp or "vertical" in fp.lower() else "SMD",
            "package_name": "Trimmer / Potentiometer",
            "line_total_pads": 3 * qty,
            "confidence": 1.0,
            "is_manual": False,
            "resolution_source": "Potentiometer Rule (3 Pins)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "3-terminal variable resistor"
        }

    # -------------------------------------------------------------
    # 5. Push Buttons / Tact Switches
    # -------------------------------------------------------------
    if des_prefix in ["SW", "BTN", "KEY"] or "SWITCH" in text_to_check or "PUSH" in text_to_check:
        pads = 4
        if "SPDT" in text_to_check or "3PIN" in text_to_check:
            pads = 3
        elif "DPDT" in text_to_check or "6PIN" in text_to_check:
            pads = 6
        is_smd = "SMD" in text_to_check or "SKRK" in text_to_check or "TACT" in text_to_check
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD" if is_smd else "THT",
            "package_name": f"Tact Switch ({pads} pins)",
            "line_total_pads": pads * qty,
            "confidence": 0.95,
            "is_manual": False,
            "resolution_source": f"Tact Switch ({pads} pins)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Push button switch ({pads} pads)"
        }

    # -------------------------------------------------------------
    # 6. Crystals & Oscillators
    # -------------------------------------------------------------
    if des_prefix in ["Y", "X", "XTAL"] or "CRYSTAL" in text_to_check or "RESONATOR" in text_to_check:
        if any(p in fp.upper() for p in ["4PIN", "4P", "3225", "2016", "2520", "5032", "7050", "GND"]):
            pads = 4
            pkg = "SMD 4-Pad Crystal"
        else:
            pads = 2
            pkg = "2-Pin Crystal (HC-49 / Tuning Fork)"
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD" if "SMD" in fp.upper() else "THT",
            "package_name": pkg,
            "line_total_pads": pads * qty,
            "confidence": 0.95,
            "is_manual": False,
            "resolution_source": f"Crystal Rule ({pads} pads)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Oscillator resonator ({pads} pads)"
        }

    # -------------------------------------------------------------
    # 7. SOT Transistors & Small Voltage Regulators
    # -------------------------------------------------------------
    m_sot = re.search(r'SOT[-_]?(\d+)(?:[-_](\d+))?', fp, re.IGNORECASE)
    if m_sot:
        base = m_sot.group(1)
        sub = m_sot.group(2)
        if sub:
            pads = int(sub)
        elif base == "23":
            pads = 3
        elif base in ["223", "89"]:
            pads = 4
        elif base in ["353", "705"]:
            pads = 5
        elif base in ["363", "563"]:
            pads = 6
        else:
            pads = 3
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD",
            "package_name": f"SOT-{base}" + (f"-{sub}" if sub else ""),
            "line_total_pads": pads * qty,
            "confidence": 0.98,
            "is_manual": False,
            "resolution_source": f"SOT Package Classifier",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Small Outline Transistor ({pads} pads)"
        }

    # SC-70 / SC-74 packages
    m_sc = re.search(r'SC[-_]?(\d+)(?:[-_](\d+))?', fp, re.IGNORECASE)
    if m_sc:
        sub = m_sc.group(2)
        pads = int(sub) if sub else 5
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD",
            "package_name": f"SC-70 ({pads} pins)",
            "line_total_pads": pads * qty,
            "confidence": 0.95,
            "is_manual": False,
            "resolution_source": "SC-70 Classifier",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Miniature SMD package ({pads} pads)"
        }

    # -------------------------------------------------------------
    # 8. SOIC, SOP, SSOP, TSSOP, MSOP, DIP IC Packages
    # -------------------------------------------------------------
    m_soic = re.search(r'\b(SOIC|TSSOP|SSOP|MSOP|SOP|DIP|PDIP)[-_]?(\d+)(?:W)?\b', fp, re.IGNORECASE)
    if m_soic:
        pkg_name = m_soic.group(1).upper()
        pads = int(m_soic.group(2))
        pad_type = "THT" if pkg_name in ["DIP", "PDIP"] else "SMD"
        return {
            "pads_per_unit": pads,
            "pad_type": pad_type,
            "package_name": f"{pkg_name}-{pads}",
            "line_total_pads": pads * qty,
            "confidence": 0.98,
            "is_manual": False,
            "resolution_source": f"{pkg_name} Pinout Parser",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Standard IC package ({pads} pins)"
        }

    # -------------------------------------------------------------
    # 9. QFP, LQFP, TQFP, PQFP, VQFP Packages
    # -------------------------------------------------------------
    m_qfp = re.search(r'\b(LQFP|TQFP|PQFP|QFP|VQFP)[-_]?(\d+)\b', fp, re.IGNORECASE)
    if m_qfp:
        pkg_name = m_qfp.group(1).upper()
        pads = int(m_qfp.group(2))
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD",
            "package_name": f"{pkg_name}-{pads}",
            "line_total_pads": pads * qty,
            "confidence": 0.99,
            "is_manual": False,
            "resolution_source": f"{pkg_name} Pinout Parser",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Quad Flat Package ({pads} leads)"
        }

    # -------------------------------------------------------------
    # 10. IPC-7351 Standard Lead Count Strings (e.g. SON50P300X400X100-15N)
    # -------------------------------------------------------------
    m_ipc = re.search(r'[-_](\d+)N(?:[-_]|$)', fp)
    if m_ipc:
        pads = int(m_ipc.group(1))
        return {
            "pads_per_unit": pads,
            "pad_type": "SMD",
            "package_name": f"IPC Standard ({pads} Pads)",
            "line_total_pads": pads * qty,
            "confidence": 0.95,
            "is_manual": False,
            "resolution_source": "IPC-7351 Footprint Code",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"IPC standard designation ({pads} pads)"
        }

    # -------------------------------------------------------------
    # 11. QFN, DFN, UDFN, WDFN Packages (Perimeter Leads + Exposed Pad)
    # -------------------------------------------------------------
    m_qfn = re.search(r'\b(QFN|DFN|UDFN|WDFN|VQFN|WQFN|HVQFN)[-_]?(\d+)\b', fp, re.IGNORECASE)
    if m_qfn:
        pkg_name = m_qfn.group(1).upper()
        leads = int(m_qfn.group(2))
        # Almost all standard QFN/DFN have a thermal ground pad on bottom
        has_ep = "UDFN" not in pkg_name
        total_pads = leads + (1 if has_ep else 0)
        return {
            "pads_per_unit": total_pads,
            "pad_type": "SMD",
            "package_name": f"{pkg_name}-{leads}" + ("+EP" if has_ep else ""),
            "line_total_pads": total_pads * qty,
            "confidence": 0.95,
            "is_manual": False,
            "resolution_source": f"{pkg_name} Lead Parser",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"{leads} perimeter leads" + (" + 1 thermal center pad" if has_ep else "")
        }

    # -------------------------------------------------------------
    # 12. Ball Grid Array (BGA, FBGA, CSP)
    # -------------------------------------------------------------
    m_bga = re.search(r'\b(BGA|FBGA|VFBGA|LFBGA|WLCSP|CSP)[-_]?(\d+)\b', fp, re.IGNORECASE)
    if m_bga:
        pkg_name = m_bga.group(1).upper()
        balls = int(m_bga.group(2))
        return {
            "pads_per_unit": balls,
            "pad_type": "SMD",
            "package_name": f"{pkg_name}-{balls}",
            "line_total_pads": balls * qty,
            "confidence": 0.98,
            "is_manual": False,
            "resolution_source": f"{pkg_name} Ball Counter",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"Ball Grid Array ({balls} solder spheres)"
        }

    # -------------------------------------------------------------
    # 13. Headers, Pin Connectors, Terminal Blocks (Rows x Pins)
    # -------------------------------------------------------------
    m_hdr = re.search(
        r'(?:PinHeader|IDC[-_]Header|Header|Pin_Header|Connector_PinHeader|Conn|JST)[-_]?(?:[A-Za-z0-9]+[-_])?(\d+)x0?(\d+)',
        fp,
        re.IGNORECASE
    )
    if not m_hdr:
        m_hdr = re.search(r'Conn[-_]0?(\d+)x0?(\d+)', desc, re.IGNORECASE)
    if not m_hdr:
        m_hdr = re.search(r'\b(\d+)x0?(\d+)\b', fp)

    if m_hdr and (des_prefix in ["J", "P", "CONN", "HDR"] or "HEADER" in text_to_check or "CONN" in text_to_check or "JST" in text_to_check):
        rows = int(m_hdr.group(1))
        cols = int(m_hdr.group(2))
        pads = rows * cols
        is_tht = not any(s in fp.lower() for s in ["smd", "smt"])
        return {
            "pads_per_unit": pads,
            "pad_type": "THT" if is_tht else "SMD",
            "package_name": f"Header {rows}x{cols} ({pads} pins)",
            "line_total_pads": pads * qty,
            "confidence": 0.98,
            "is_manual": False,
            "resolution_source": f"Pin Header Calculator ({rows}x{cols})",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": f"{rows}x{cols} pin array ({pads} pins)"
        }

    # -------------------------------------------------------------
    # 14. Standard Transistors / Triacs (Designator Q or T)
    # -------------------------------------------------------------
    if des_prefix in ["Q", "T"]:
        is_tht = any(th in fp.lower() for th in ["to-92", "to-220", "tht", "through_hole"])
        return {
            "pads_per_unit": 3,
            "pad_type": "THT" if is_tht else "SMD",
            "package_name": "Transistor 3-Pin",
            "line_total_pads": 3 * qty,
            "confidence": 0.85,
            "is_manual": False,
            "resolution_source": "Transistor Default (3 Pads)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "3-pin semiconductor device"
        }

    # -------------------------------------------------------------
    # 15. Specialized Connectors (Barrel Jack, USB, Audio Jack, Battery)
    # -------------------------------------------------------------
    if "BARREL" in text_to_check or "JACK-DC" in text_to_check:
        return {
            "pads_per_unit": 3,
            "pad_type": "THT",
            "package_name": "DC Barrel Jack",
            "line_total_pads": 3 * qty,
            "confidence": 0.92,
            "is_manual": False,
            "resolution_source": "DC Jack Heuristic (3 Pins)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "Center pin, sleeve, and shunt switch contact"
        }

    if "USB" in text_to_check:
        pads = 6
        if "TYPE-C" in text_to_check or "USB-C" in text_to_check:
            pads = 16
        elif "MICRO" in text_to_check:
            pads = 9
        is_tht = "THT" in fp.upper() or "VERTICAL" in fp.upper()
        return {
            "pads_per_unit": pads,
            "pad_type": "THT" if is_tht else "SMD",
            "package_name": f"USB Connector ({pads} pins)",
            "line_total_pads": pads * qty,
            "confidence": 0.9,
            "is_manual": False,
            "resolution_source": f"USB Standard ({pads} pins)",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "Signal pins + chassis shield tabs"
        }

    if "MICROSD" in text_to_check or "SD_CARD" in text_to_check:
        return {
            "pads_per_unit": 13,
            "pad_type": "SMD",
            "package_name": "MicroSD Socket (9+4)",
            "line_total_pads": 13 * qty,
            "confidence": 0.92,
            "is_manual": False,
            "resolution_source": "MicroSD Socket Standard",
            "datasheet_url": datasheet_url,
            "google_pinout_url": google_url,
            "notes": "9 card signal/detect pins + 4 shield anchors"
        }

    # -------------------------------------------------------------
    # 16. Fallback: Unknown Component - Needs User Manual Feed
    # -------------------------------------------------------------
    return {
        "pads_per_unit": 0,
        "pad_type": "Unknown",
        "package_name": fp or "Unknown Package",
        "line_total_pads": 0,
        "confidence": 0.0,
        "is_manual": True,
        "resolution_source": "Manual Feed Required",
        "datasheet_url": datasheet_url,
        "google_pinout_url": google_url,
        "notes": "⚠️ Footprint not recognized. Please verify datasheet and enter pad count."
    }


def calculate_bom_pads(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Processes all BOM items to compute total SMD pads, THT pins, total assembly pads,
    resolution status, and list of items needing manual review.
    """
    total_smd_pads = 0
    total_tht_pins = 0
    total_components = 0
    resolved_count = 0
    unresolved_items = []
    enriched_items = []

    # Track packages for complexity evaluation
    has_bga = False
    has_fine_pitch = False
    has_qfn = False
    fine_pitch_count = 0

    for item in items:
        qty = max(1, int(item.get("quantity", 1)))
        total_components += qty

        # If user has already manually set pads, preserve their override!
        if item.get("is_manual_override", False) and item.get("pads_per_unit") is not None:
            pads = int(item["pads_per_unit"])
            ptype = str(item.get("pad_type", "SMD")).upper()
            est = {
                "pads_per_unit": pads,
                "pad_type": ptype,
                "package_name": item.get("package_name", item.get("footprint", "Custom")),
                "line_total_pads": pads * qty,
                "confidence": 1.0,
                "is_manual": False,
                "resolution_source": "User Manual Input",
                "datasheet_url": item.get("datasheet_url") or generate_datasheet_url(item.get("mpn", ""), item.get("description", "")),
                "google_pinout_url": item.get("google_pinout_url") or generate_google_pinout_url(item.get("mpn", ""), item.get("description", ""), item.get("footprint", "")),
                "notes": "Manually verified by user"
            }
        else:
            est = estimate_component_pads(item)

        line_item = {**item, **est}
        enriched_items.append(line_item)

        if est["confidence"] < 0.5 or est["pads_per_unit"] == 0:
            unresolved_items.append(line_item)
        else:
            resolved_count += 1

        if est["pad_type"] == "SMD":
            total_smd_pads += est["line_total_pads"]
        elif est["pad_type"] == "THT":
            total_tht_pins += est["line_total_pads"]

        # Check complexity indicators
        pkg_upper = (line_item.get("package_name", "") + " " + line_item.get("footprint", "")).upper()
        if "BGA" in pkg_upper or "WLCSP" in pkg_upper:
            has_bga = True
        if "QFN" in pkg_upper or "DFN" in pkg_upper or "SON" in pkg_upper:
            has_qfn = True
        if any(fp in pkg_upper for fp in ["LQFP", "TQFP", "TSSOP", "P0.5", "P0.4", "P0.65"]):
            has_fine_pitch = True
            fine_pitch_count += qty

    total_pads = total_smd_pads + total_tht_pins

    # BOM-based assembly complexity estimation (0 - 100%)
    base_comp = 20.0
    if total_components > 200:
        base_comp += 20.0
    elif total_components > 100:
        base_comp += 10.0

    if has_bga:
        base_comp += 35.0
    if has_qfn:
        base_comp += 15.0
    if has_fine_pitch:
        base_comp += min(20.0, fine_pitch_count * 1.5)

    complexity_score = min(95.0, round(base_comp, 1))

    return {
        "summary": {
            "total_line_items": len(items),
            "total_components": total_components,
            "total_smd_pads": total_smd_pads,
            "total_tht_pins": total_tht_pins,
            "total_pads": total_pads,
            "resolved_count": resolved_count,
            "unresolved_count": len(unresolved_items),
            "resolution_pct": round((resolved_count / max(1, len(items))) * 100, 1),
            "complexity_score": complexity_score,
            "has_bga": has_bga,
            "has_qfn": has_qfn,
            "has_fine_pitch": has_fine_pitch
        },
        "items": enriched_items,
        "unresolved_items": unresolved_items
    }
