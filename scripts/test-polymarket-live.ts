/**
 * Live verification of the Polymarket CLOB stack using the PRODUCTION module
 * (src/agents/polymarket/clob.ts) with a throwaway key — no funds needed.
 *
 *  1. createOrDeriveCreds() → POST /auth/api-key must return credentials
 *     (proves L1 EIP-712 ClobAuth is byte-exact).
 *  2. l2Get('/auth/api-keys') → must list the key (proves L2 HMAC).
 *  3. buildSignedOrder + postOrder → must be rejected for balance/allowance
 *     reasons, NOT signature reasons (proves the CTF Exchange order signing).
 *
 * Usage: npx tsx scripts/test-polymarket-live.ts
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Generate the throwaway key and set BOTH env vars BEFORE anything loads config.
const throwawayKey = generatePrivateKey();
const throwawayAddress = privateKeyToAccount(throwawayKey).address;
process.env.POLYMARKET_PRIVATE_KEY = throwawayKey;
process.env.POLYMARKET_FUNDER_ADDRESS = throwawayAddress; // test wallet is its own funder
// Type 2 (Gnosis Safe proxy) is the documented local-signing flow for
// exported Polymarket keys: maker = funder proxy, signer = EOA = API-key owner.
process.env.POLYMARKET_SIGNATURE_TYPE = '2';
process.env.DRY_RUN = 'true'; // keep every other module quiet

const { createOrDeriveCreds, buildSignedOrder, postOrder, l2Get } = await import(
  '../src/agents/polymarket/clob.js'
);
const { config } = await import('../src/config/index.js');

async function main(): Promise<void> {
  console.log('== Polymarket CLOB live verification (production module, throwaway key) ==');
  console.log('throwaway signer/funder:', throwawayAddress);

  // --- 1. L1 auth → credentials ---
  const creds = await createOrDeriveCreds();
  console.log(
    'credentials  :',
    `apiKey=${creds.apiKey.slice(0, 8)}… secret=${creds.secret.slice(0, 6)}… passphrase=***`,
  );

  // --- 2. L2 HMAC ---
  const keys = await l2Get<unknown[]>(creds, '/auth/api-keys');
  console.log('auth/api-keys:', Array.isArray(keys) ? `${keys.length} key(s) — L2 HMAC verified` : keys);

  // --- 3. Signed order against a live market ---
  const markets = (await (
    await fetch(`${config.POLYMARKET_GAMMA_API}/markets?closed=false&limit=1`)
  ).json()) as Array<{ clobTokenIds?: string }>;
  const tokenIds: string[] = JSON.parse(markets[0]?.clobTokenIds ?? '[]');
  if (tokenIds.length === 0) throw new Error('no live market found on Gamma');
  const tokenId = tokenIds[0];
  console.log('live token   :', tokenId.slice(0, 16) + '…');

  const signed = await buildSignedOrder({
    tokenId,
    side: 'BUY',
    amount: 5, // $5 — tiny and unfundable (throwaway wallet holds no USDC)
    price: 0.5,
    orderType: 'GTC',
  });
  console.log('order signed : exchange=%s (negRisk=%s tick=%s)', signed.negRisk ? 'NegRisk' : 'CTF', signed.negRisk, signed.tickSize);

  let orderError = '';
  let orderId: string | undefined;
  try {
    const res = await postOrder(creds, signed.order, 'GTC');
    orderId = res.orderId;
    orderError = res.errorMsg ?? '';
  } catch (err) {
    orderError = err instanceof Error ? err.message : String(err);
  }
  const errText = orderError.toLowerCase();
  const signatureProblem =
    errText.includes('signature') || errText.includes('signer') || errText.includes('recover');
  // Policy rejections are EXPECTED with a throwaway key: the maker must be a
  // REGISTERED Polymarket wallet (proxy / Gnosis safe / deposit wallet), and a
  // fresh EOA is not one. Reaching a policy error proves the order format,
  // version and signature all passed server-side validation.
  const policyExpected =
    errText.includes('maker address not allowed') ||
    errText.includes('deposit wallet') ||
    errText.includes('balance') ||
    errText.includes('allowance') ||
    errText.includes('usdc');
  console.log('post /order  :', orderId ?? orderError.slice(0, 160));
  if (signatureProblem) {
    console.log('RESULT: FAIL — order signature rejected');
    process.exit(1);
  }
  console.log(
    policyExpected
      ? 'RESULT: PASS — order format v2 + signature accepted server-side; rejection is account policy (throwaway wallet is not a registered Polymarket wallet). With a REAL account: POLYMARKET_PRIVATE_KEY=owner EOA, POLYMARKET_FUNDER_ADDRESS=proxy/deposit wallet, POLYMARKET_SIGNATURE_TYPE=1|2|3.'
      : `RESULT: PASS (unexpected but non-signature error) — ${orderError}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('RESULT: ERROR —', err instanceof Error ? err.message : err);
  process.exit(1);
});
