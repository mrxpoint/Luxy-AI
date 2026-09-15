/**
 * Live verification of the Hyperliquid EIP-712 signing stack (no funds needed).
 *
 * Method: post a well-formed but unfundable order signed by a THROWAWAY key.
 *   - If the signature were malformed, the API answers "invalid signature".
 *   - Any other rejection (margin, tick, market) proves the signature PASSED
 *     server-side verification — i.e. msgpack packing, action hash, phantom
 *     agent and EIP-712 payload are byte-exact.
 * A deliberately corrupted second signature must yield "invalid signature",
 * confirming the test methodology itself.
 *
 * Usage: npx tsx scripts/test-hyperliquid-signing.ts
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { config } from '../src/config/index.js';
import { floatToWire, resolveAsset, signL1Action } from '../src/agents/perps/signing.js';

async function post(action: unknown, nonce: number, signature: { r: string; s: string; v: number }) {
  const res = await fetch(`${config.HYPERLIQUID_API_URL}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  return (await res.json()) as { status: string; response: unknown };
}

async function main(): Promise<void> {
  console.log('== Hyperliquid signing verification (throwaway key, mainnet) ==');

  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  console.log('throwaway signer:', account.address);

  const coin = 'BTC';
  const { index, szDecimals } = await resolveAsset(coin);
  console.log(`asset ${coin}: index=${index} szDecimals=${szDecimals}`);

  const wire = {
    a: index,
    b: true, // buy
    p: floatToWire(1), // $1 — absurd price, guaranteed rejection, valid shape
    s: floatToWire(0), // zero size — valid shape, unfundable
    r: false,
    t: { limit: { tif: 'Gtc' } },
  };
  const action = { type: 'order', orders: [wire], grouping: 'na' };
  const nonce = Date.now();

  // --- control: corrupted signature must be rejected as invalid ---
  const badSig = await signL1Action(pk, action, nonce, true);
  badSig.r = ('0x' + '0'.repeat(64)) as `0x${string}`;
  const badRes = await post(action, nonce, badSig);
  console.log('corrupted signature →', JSON.stringify(badRes));
  const badText = JSON.stringify(badRes).toLowerCase();
  const controlOk =
    badText.includes('invalid signature') ||
    badText.includes('unable to recover') ||
    badText.includes('signature');
  console.log(`control (expect signature error): ${controlOk ? 'PASS' : 'UNEXPECTED'}`);

  // --- real signing: expect a NON-signature rejection ---
  const nonce2 = Date.now();
  const sig = await signL1Action(pk, action, nonce2, true);
  const res = await post(action, nonce2, sig);
  console.log('real signature    →', JSON.stringify(res));
  const text = JSON.stringify(res).toLowerCase();
  const invalidSig = text.includes('invalid signature');
  console.log(
    invalidSig
      ? 'RESULT: FAIL — server reports invalid signature; msgpack/hash/EIP-712 mismatch'
      : 'RESULT: PASS — signature verified server-side (rejection was for non-signature reasons)',
  );
  process.exit(invalidSig ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
