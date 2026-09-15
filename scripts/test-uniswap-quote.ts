/** Live smoke: real Uniswap v3 QuoterV2 quote via public RPC (read-only, no key). */
import { uniswapQuote, EVM_TOKENS } from '../src/executor/uniswap.js';

async function main(): Promise<void> {
  for (const chain of ['ethereum', 'base'] as const) {
    try {
      // 100 USDC -> WETH, 0.3% tier
      const q = await uniswapQuote(chain, EVM_TOKENS[chain].usdc, EVM_TOKENS[chain].weth, 100_000_000n, 3000);
      console.log(
        `${chain}: 100 USDC -> ${Number(q.outRaw) / 1e18} WETH  impact=${(q.priceImpactPct * 100).toFixed(3)}%`,
      );
    } catch (e) {
      console.log(`${chain}: quote failed —`, String(e).slice(0, 100));
    }
  }
  console.log('uniswap quote smoke done');
  process.exit(0);
}
main();
