/**
 * Installe le hook git pre-commit.
 * Usage : node scripts/install-hooks.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, '..', '.git', 'hooks', 'pre-commit');

const hookContent = `#!/bin/sh
node scripts/pre-commit.mjs
`;

fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
console.log('✅ Hook pre-commit installé');
