/**
 * Installe le hook git pre-commit.
 * Silencieux si .git/hooks n'existe pas (ex: Netlify).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.join(__dirname, '..', '.git', 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');

if (!fs.existsSync(hooksDir)) {
  console.log('⏭️  Pas de .git/hooks — skip (environnement CI)');
  process.exit(0);
}

const hookContent = `#!/bin/sh
node scripts/pre-commit.mjs
`;

fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
console.log('✅ Hook pre-commit installé');
