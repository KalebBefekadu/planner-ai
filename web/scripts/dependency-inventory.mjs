// What a release of Planner AI actually ships.
//
// Everything here is read from `package-lock.json` and nothing else. That is a
// deliberate limit: the lockfile is the same on every machine, whereas
// `node_modules` is not. Roughly a third of the production closure is
// platform-optional -- image codecs, native binaries -- so a field read from
// the installed tree would differ between a macOS laptop and Linux CI, and a
// drift check over it would fail for the wrong reason. Licences are the obvious
// missing column and are the reason to revisit this with a real SBOM tool
// rather than to read them from whatever happens to be installed.

import { readFileSync } from 'node:fs';

/** Packages the lockfile marks as reachable without dev dependencies. */
function productionEntries(lock) {
  return Object.entries(lock.packages)
    .filter(([path]) => path.startsWith('node_modules/'))
    .filter(([, entry]) => !entry.dev && !entry.devOptional)
    .map(([path, entry]) => ({
      // A nested path is the same package installed for a different parent.
      // The name after the last `node_modules/` is the package itself.
      name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version ?? '',
      optional: Boolean(entry.optional),
      registry: entry.resolved ? new URL(entry.resolved).host : '',
    }))
    .sort((first, second) =>
      first.name === second.name
        ? first.version.localeCompare(second.version)
        : first.name.localeCompare(second.name)
    );
}

function table(rows, columns) {
  const header = `| ${columns.map((column) => column.title).join(' | ')} |`;
  const rule = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => column.value(row)).join(' | ')} |`);
  return [header, rule, ...body].join('\n');
}

export function buildDependencyInventory(packageJsonPath, lockPath) {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const production = productionEntries(lock);

  const direct = Object.entries(manifest.dependencies ?? {})
    .map(([name, range]) => ({
      name,
      range,
      pinned: /^\d/.test(range),
      resolved: production.find((entry) => entry.name === name)?.version ?? 'unresolved',
    }))
    .sort((first, second) => first.name.localeCompare(second.name));

  const registries = [...new Set(production.map((entry) => entry.registry).filter(Boolean))].sort();
  const optional = production.filter((entry) => entry.optional);

  return `# Release Dependency Inventory

Generated from \`web/package-lock.json\`. Do not edit by hand; run
\`npm run inventory:dependencies\`. \`npm test\` fails if it is stale.

Only the production closure is listed. Development and test tooling does not
reach a release and is excluded.

## Summary

| Measure | Count |
| --- | --- |
| Direct production dependencies | ${direct.length} |
| Direct dependencies pinned to an exact version | ${direct.filter((entry) => entry.pinned).length} |
| Production closure, including transitive | ${production.length} |
| Of those, platform-optional | ${optional.length} |
| Distinct registries | ${registries.length} |

Registries: ${registries.map((host) => `\`${host}\``).join(', ')}.

A single registry is the point. Anything else appearing here is a supply-chain
change, not a dependency change.

## Direct production dependencies

\`Declared\` is what \`package.json\` asks for. A range means a future
\`npm install\` may resolve it differently; an exact version means it may not.
Packages that hold credentials, speak to the network, or parse input a person
did not write are pinned exactly.

${table(direct, [
  { title: 'Package', value: (row) => `\`${row.name}\`` },
  { title: 'Declared', value: (row) => `\`${row.range}\`` },
  { title: 'Locked', value: (row) => `\`${row.resolved}\`` },
  { title: 'Exact', value: (row) => (row.pinned ? 'yes' : 'no') },
])}

## Production closure

${table(production, [
  { title: 'Package', value: (row) => `\`${row.name}\`` },
  { title: 'Version', value: (row) => `\`${row.version}\`` },
  { title: 'Optional', value: (row) => (row.optional ? 'yes' : '') },
])}
`;
}
