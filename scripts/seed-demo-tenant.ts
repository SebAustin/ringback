import { cfg } from '../src/config.js';
import { initFirestoreStore } from '../src/lib/firestore.js';
import { ensureDemoTenant } from '../src/demo-seed.js';

async function main(): Promise<void> {
  if (cfg.STORE === 'firestore') initFirestoreStore();
  const id = await ensureDemoTenant();
  // eslint-disable-next-line no-console
  console.log(`Demo tenant ready: ${id} (store=${cfg.STORE})`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
