"""
Template: kelly_sizing.py (BLUEPRINT.md §4.4 / §4.6 step 3)

Position sizing based on the Kelly criterion with a hard fractional cap.
The agent calls this before submitting an entry intent; the executor's
hardcoded 3%-of-portfolio guard always wins over anything computed here.
"""
import numpy as np


def kelly_size(
    win_rate: float,
    avg_win: float,
    avg_loss: float,
    portfolio_usd: float,
    fraction_cap: float = 0.25,
) -> dict:
    """
    win_rate  : 0..1 historical win rate of the setup
    avg_win   : average positive return per winning trade (e.g. 0.12)
    avg_loss  : average negative return per losing trade, positive magnitude (e.g. 0.08)
    portfolio_usd : current portfolio equity in USD
    fraction_cap  : max fraction of full Kelly to deploy (quarter-Kelly default)
    """
    if avg_loss <= 0 or portfolio_usd <= 0:
        return {"kelly_fraction": 0.0, "recommended_size_usd": 0.0, "reason": "invalid inputs"}

    b = avg_win / avg_loss  # odds
    p = min(max(win_rate, 0.0), 1.0)
    q = 1 - p
    kelly = (b * p - q) / b

    if kelly <= 0:
        return {
            "kelly_fraction": 0.0,
            "recommended_size_usd": 0.0,
            "reason": "negative edge — do not enter",
        }

    fractional = kelly * fraction_cap
    return {
        "kelly_fraction": float(kelly),
        "fractional_kelly": float(fractional),
        "recommended_size_usd": float(round(fractional * portfolio_usd, 2)),
        "odds_b": float(b),
        "reason": "ok",
    }


def size_from_trades(returns: list[float], portfolio_usd: float, fraction_cap: float = 0.25) -> dict:
    """Convenience wrapper: derive win rate / avg win / avg loss from a trade list."""
    if not returns:
        return {"kelly_fraction": 0.0, "recommended_size_usd": 0.0, "reason": "no trades"}
    arr = np.array(returns)
    wins = arr[arr > 0]
    losses = arr[arr <= 0]
    return kelly_size(
        win_rate=float(len(wins) / len(arr)),
        avg_win=float(wins.mean()) if len(wins) else 0.0,
        avg_loss=abs(float(losses.mean())) if len(losses) else 1e-9,
        portfolio_usd=portfolio_usd,
        fraction_cap=fraction_cap,
    )
