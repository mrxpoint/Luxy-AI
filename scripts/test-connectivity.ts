/** Connectivity smoke: dexscreener multichain + hyperliquid mids + polymarket gamma. */
import { fetchPairsForChains } from '../src/screener/dexscreener.js';
import { fetchAllMids } from '../src/agents/perps/hyperliquid.js';
import { fetchOpenMarkets } from '../src/agents/polymarket/gamma.js';

async function main(): Promise<void> {
  try {
    const pairs = await fetchPairsForChains('PEPE', ['ethereum', 'base']);
    console.log(`dexscreener: ${pairs.length} pairs (eth+base), sample price:`, pairs[0]?.priceUsd ?? 'n/a');
  } catch (e) {
    console.log('dexscreener unreachable from sandbox:', String(e).slice(0, 80));
  }
  try {
    const mids = await fetchAllMids();
    console.log('hyperliquid mids: BTC =', mids['BTC'] ?? 'n/a');
  } catch (e) {
    console.log('hyperliquid unreachable from sandbox:', String(e).slice(0, 80));
  }
  try {
    const markets = await fetchOpenMarkets(5);
    console.log(`polymarket gamma: ${markets.length} open markets, sample:`, markets[0]?.question?.slice(0, 60) ?? 'n/a');
  } catch (e) {
    console.log('polymarket unreachable from sandbox:', String(e).slice(0, 80));
  }
  console.log('connectivity smoke done');
  process.exit(0);
}
main();
