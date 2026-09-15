#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDependencyInventory } from './dependency-inventory.mjs';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const target = fileURLToPath(
  new URL('../../docs/engineering/dependency-inventory.md', import.meta.url)
);

writeFileSync(
  target,
  buildDependencyInventory(`${webRoot}package.json`, `${webRoot}package-lock.json`)
);
console.log(`Wrote ${target}`);
