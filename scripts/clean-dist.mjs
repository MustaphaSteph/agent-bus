import { rmSync } from 'node:fs';

// Removed adapters must not survive in a subsequent npm package.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
