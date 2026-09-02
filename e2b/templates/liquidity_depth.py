"""
Template: liquidity_depth.py (BLUEPRINT.md §4.4 / §4.6 step 4)

Checks liquidity depth at the intended entry size: estimates the price
impact of walking a naive constant-product depth curve and flags entries
whose impact exceeds the risk budget (executor hard-caps slippage at 2%).
"""


def check_depth(liquidity_usd: float, entry_usd: float, max_impact: float = 0.02) -> dict:
    """
    liquidity_usd : total pool liquidity in USD (DexScreener / Birdeye)
    entry_usd     : intended order size in USD
    max_impact    : tolerated price impact (executor risk guard uses 2%)
    """
    if liquidity_usd <= 0 or entry_usd <= 0:
        return {"ok": False, "impact": 1.0, "reason": "invalid inputs"}

    # Constant-product approximation: relative impact ≈ (in / liquidity) / 2
    impact = entry_usd / (2.0 * liquidity_usd)
    ok = impact <= max_impact

    # Size that would hit the max impact budget for this pool
    max_size = max_impact * 2.0 * liquidity_usd

    return {
        "ok": bool(ok),
        "impact": float(impact),
        "max_safe_entry_usd": float(round(max_size, 2)),
        "liquidity_usd": float(liquidity_usd),
        "entry_usd": float(entry_usd),
        "reason": "ok" if ok else f"impact {(impact * 100):.2f}% exceeds {(max_impact * 100):.1f}% budget",
    }
