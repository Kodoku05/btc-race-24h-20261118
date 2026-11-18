// Dip-buy mean-reversion bot for cbBTC/USDC (Orca Whirlpool, 1-minute bars).
//
// Strategy: BTC mean-reverts on the 1-minute scale. Buy the full cash balance
// when the close dips at least DIP_BPS below its SMA(SMA_N); exit the whole
// position at TP_BPS above cost or SL_BPS below cost. Long only, one position
// at a time, a handful of trades per day.
//
// Costs shape the parameters: at the pool's ~$700k depth a full-size fill
// pays ~20 bps (4 bps fee + 2 bps slippage + ~14 bps price impact), so a
// round trip costs ~40 bps. Entries therefore wait for a deep dip (100 bps
// below a slow 120-bar average, a real slide rather than noise), exits wait
// for a real recovery (200 bps), and the stop (100 bps) leaves room for the
// entry cost plus drift instead of firing on the first wobble.
//
// Two guards against known losing shapes: after a stop-loss exit the price is
// still deep below the SMA, so the bot waits COOLDOWN_BARS before the next
// entry instead of buying the same falling knife straight back; and no new
// entries open in the last NO_ENTRY_LAST_BARS bars of the 1440-bar window,
// because a bounce there has no time to reach TP and the entry just pays the
// round trip to be flattened at the close.
//
// All decisions use bigint arithmetic on the harness's own integer prices and
// quote units, so two runs on the same bars produce the same orders.
//
// Validation on this competition's frozen dev window (grade-local, harness
// economics): net PnL +$19.75 on $1,000 (2 trades, 1 round trip, win rate
// 1.0, max drawdown 0.65%, fees $0.81); at 2x fees still +$18.93. The
// previous race's parameters (SMA90/DIP80/TP170/SL60) lost -$16.88 on this
// window, so they were rejected: the 60 bps stop fired on entry cost plus
// drift alone at ~20 bps per side.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_N = 120n;
const DIP_BPS = 100n;
const TP_BPS = 200n;
const SL_BPS = 100n;
const MAX_SLIPPAGE_BPS = 100;
const COOLDOWN_BARS = 60;
// The window is 1440 one-minute bars; a position opened in the last hour has
// no time to reach TP, so entries stop at seq 1380. Holdings are untouched:
// they still exit on TP/SL or flatten at the close.
const NO_ENTRY_AFTER_SEQ = 1380;

const closes: bigint[] = [];
let lastT: number | null = null;
let slExitSeq = -1000000;

await runBars({
  onBatch(state: BarsState, _batch) {
    const bar = state.latest.get(SYMBOL);
    if (bar !== undefined && bar.t !== lastT) {
      lastT = bar.t;
      closes.push(BigInt(bar.c));
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // Exit: take profit or stop loss, measured on value at the latest close
      // against the position's cost (fees included), in integer bps.
      const value = state.value(SYMBOL, held.qty);
      if (value * 10000n >= held.cost * (10000n + TP_BPS)) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      if (value * 10000n <= held.cost * (10000n - SL_BPS)) {
        slExitSeq = state.seq;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    if (state.seq - slExitSeq < COOLDOWN_BARS) return [];
    if (state.seq >= NO_ENTRY_AFTER_SEQ) return [];

    // Flat: enter on a dip below the SMA. Integer comparison:
    // close < SMA * (1 - DIP_BPS/10000).
    const n = Number(SMA_N);
    if (closes.length < n || bar === undefined) return [];
    let total = 0n;
    for (let i = closes.length - n; i < closes.length; i++) total += closes[i];
    const close = BigInt(bar.c);
    if (close * SMA_N * 10000n >= total * (10000n - DIP_BPS)) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
