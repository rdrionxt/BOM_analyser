"""
Assembly Cost Calculation Module
Handles Prototype vs Production costing models, pad counts, volume discount curves,
and complexity multipliers.
"""

def calculate_assembly_cost(
    num_boards: int,
    cost_per_pad: float,
    smd_pads: int,
    tht_pads: int,
    assembly_type: str = "prototype", # "prototype" or "production"
    complexity_score: float = 0.0,    # 0 to 100%
    is_double_sided: bool = False,
    currency: str = "INR"
):
    """
    Calculates detailed assembly cost breakdown.
    Currency base defaults to INR (₹).
    """
    # Currency conversion rate INR to USD
    usd_rate = 83.5 if currency.upper() == "USD" else 1.0

    qty = max(1, int(num_boards))
    pad_rate = max(0.01, float(cost_per_pad))

    # Base SMT pad cost
    base_smt_rate = pad_rate

    # Volume discount factor for production
    if assembly_type.lower() == "production":
        if qty >= 1000:
            volume_multiplier = 0.50 # 50% discount on pad rate
        elif qty >= 500:
            volume_multiplier = 0.65 # 35% discount
        elif qty >= 100:
            volume_multiplier = 0.80 # 20% discount
        elif qty >= 50:
            volume_multiplier = 0.90 # 10% discount
        else:
            volume_multiplier = 1.0
    else:
        # Prototype: small batch, no volume discount
        volume_multiplier = 1.0

    effective_smt_pad_rate = base_smt_rate * volume_multiplier

    # THT (Through-Hole) pin rate: typically 2.5x of SMT automated pad rate
    # due to manual hand soldering or wave soldering setup
    effective_tht_pin_rate = effective_smt_pad_rate * 2.5

    # Total placement base costs across the batch
    total_smt_cost = round(smd_pads * effective_smt_pad_rate * qty, 2)
    total_tht_cost = round(tht_pads * effective_tht_pin_rate * qty, 2)
    placement_subtotal = total_smt_cost + total_tht_cost

    # Stencil Costs (Laser-cut stainless steel)
    # Prototype stencils are standard frameless or framed
    base_stencil_single = 800.0 / (usd_rate if currency.upper() == "USD" else 1.0)
    base_stencil_double = 1500.0 / (usd_rate if currency.upper() == "USD" else 1.0)

    if is_double_sided:
        stencil_fee = base_stencil_double
        stencil_type = "Double-Sided Laser Stencil (Top + Bottom)"
    else:
        stencil_fee = base_stencil_single
        stencil_type = "Single-Sided Laser Stencil (Top)"

    # Machine Setup & Feeder Loading Fee
    if assembly_type.lower() == "prototype":
        # SMT Feeder loading, calibration & visual verification
        setup_fee = 1200.0 / (usd_rate if currency.upper() == "USD" else 1.0)
    else:
        # Production high-speed feeder reel setup, optical centering & AOI baseline
        setup_fee = 2200.0 / (usd_rate if currency.upper() == "USD" else 1.0)

    # Complexity Adjustment Multiplier
    # Complexity 0% -> 1.00x multiplier
    # Complexity 50% -> 1.20x multiplier
    # Complexity 100% -> 1.45x multiplier
    comp_score = max(0.0, min(100.0, float(complexity_score)))
    complexity_multiplier = 1.0 + (comp_score / 100.0) * 0.45
    complexity_surcharge = round(placement_subtotal * (complexity_multiplier - 1.0), 2)

    # Total batch assembly cost
    total_assembly_cost = round(
        placement_subtotal + complexity_surcharge + stencil_fee + setup_fee, 2
    )

    # Cost per single board
    cost_per_board = round(total_assembly_cost / qty, 2)

    return {
        "num_boards": qty,
        "assembly_type": assembly_type.capitalize(),
        "currency": "USD" if currency.upper() == "USD" else "INR",
        "currency_symbol": "$" if currency.upper() == "USD" else "₹",
        "cost_per_pad_input": pad_rate,
        "effective_smt_pad_rate": round(effective_smt_pad_rate, 4),
        "effective_tht_pin_rate": round(effective_tht_pin_rate, 4),
        "volume_discount_pct": round((1.0 - volume_multiplier) * 100, 1),
        "smd_pads_per_board": smd_pads,
        "tht_pads_per_board": tht_pads,
        "total_pads_per_board": smd_pads + tht_pads,
        "total_smt_cost": total_smt_cost,
        "total_tht_cost": total_tht_cost,
        "stencil_fee": round(stencil_fee, 2),
        "stencil_type": stencil_type,
        "setup_fee": round(setup_fee, 2),
        "complexity_score": comp_score,
        "complexity_multiplier": round(complexity_multiplier, 3),
        "complexity_surcharge": complexity_surcharge,
        "total_assembly_cost": total_assembly_cost,
        "cost_per_board": cost_per_board,
    }
