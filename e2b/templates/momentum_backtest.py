"""
Template: momentum_backtest.py (BLUEPRINT.md §4.4)

Agent sends this code to the E2B sandbox, gets results back.
Entry signal: close > SMA AND momentum > threshold. Exit after hold_periods.
"""
import pandas as pd
import numpy as np


def run_backtest(candles: list[dict], params: dict) -> dict:
    df = pd.DataFrame(candles)
    df["close"] = df["close"].astype(float)
    df["sma"] = df["close"].rolling(params.get("sma_period", 12)).mean()
    df["momentum"] = df["close"].pct_change(params.get("momentum_period", 6))

    # Entry signal: close > SMA and momentum > threshold
    df["entry"] = (df["close"] > df["sma"]) & (
        df["momentum"] > params.get("momentum_threshold", 0.03)
    )

    # Simulate trades
    returns = []
    for i, row in df[df["entry"]].iterrows():
        if i + params.get("hold_periods", 4) < len(df):
            entry_price = row["close"]
            exit_price = df.iloc[i + params.get("hold_periods", 4)]["close"]
            returns.append((exit_price - entry_price) / entry_price)

    if not returns:
        return {"win_rate": 0, "avg_return": 0, "sharpe": 0, "n_trades": 0}

    returns = np.array(returns)
    return {
        "win_rate": float(np.mean(returns > 0)),
        "avg_return": float(np.mean(returns)),
        "sharpe": float(np.mean(returns) / (np.std(returns) + 1e-8) * np.sqrt(252)),
        "max_drawdown": float(np.min(returns)),
        "n_trades": len(returns),
    }
