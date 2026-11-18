# Dip-buy mean-reversion bot — cbBTC/USDC (btc-race-24h-20261118-1444)

Long-only bot for the make.fun 24h BTC race. It trades Coinbase Wrapped BTC
against USDC on 1-minute Orca Whirlpool bars, starting from $1,000 paper USDC.

## Strategy

- **Entry:** buy the full cash balance when the close dips at least 100 bps
  below its 120-bar simple moving average — a real slide, not noise.
- **Exit:** sell the whole position at +200 bps above cost (take profit) or
  −100 bps below cost (stop loss), measured on value at the latest close.
- **Cooldown:** after a stop-loss exit, no re-entry for 60 bars, so the bot
  never buys the same falling knife straight back.
- **Late-window guard:** no new entries after bar 1380 of the 1440-bar
  window — a position opened in the last hour has no time to reach TP.
- **Costs:** at the pool's ~$700k depth a full-size fill pays ~20 bps
  (4 bps fee + 2 bps slippage + ~14 bps price impact), so a round trip costs
  ~40 bps. Entries wait for a deep dip and exits for a real recovery.

All decisions use bigint arithmetic on the harness's integer prices and quote
units: two runs on the same bars produce the same orders.

## Local grade (dev window)

```
net PnL   19.748241 USDC (return 1.97%)
trading   2 trades, win rate 1.0, max drawdown 0.65%, 0 rejected
fees      0.808063 USDC; at 2x fees net PnL 18.933628 USDC
```

Reproduce: `node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree`

## Layout

- `main.ts` — the bot (Node 22, type-stripped TypeScript)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
