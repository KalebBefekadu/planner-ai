#!/usr/bin/env node
// What the database says the Operation contract is, written down so TypeScript
// can be checked against it without a database.
//
// The contract lives in two places and always has: `operationDefinitions` in
// TypeScript, and the `operation_contracts` rows the migrations insert. Nothing
// compared them, so a risk class raised in SQL and not in TypeScript -- or the
// reverse -- would have changed what the MCP catalog advertises as destructive
// while every test still passed.
//
// This reads the rows from a clean reset and writes them as a generated module,
// exactly as the Supabase types are generated. The comparison itself is an
// ordinary unit test, so it runs in the application CI job with no database.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const tables = {
  operation_contracts: ['operation_id', 'risk_class', 'exposures', 'reversible'],
  operation_undo_support: ['operation_id', 'strategy'],
};

function dumpPublicData() {
  return execFileSync(
    'npx',
    ['supabase', 'db', 'dump', '--local', '--data-only', '--schema', 'public'],
    {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
}

/** Split one `(...)` row on commas that are not inside a quoted string. */
function splitRow(row) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (quoted) {
      // Postgres escapes a quote by doubling it.
      if (character === "'" && row[index + 1] === "'") {
        current += "'";
        index += 1;
      } else if (character === "'") {
        quoted = false;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'") {
      quoted = true;
      continue;
    }
    if (character === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  values.push(current.trim());
  return values;
}

function readTable(dump, table, wanted) {
  const header = new RegExp(
    `INSERT INTO "public"\\."${table}" \\(([^)]*)\\) VALUES\\n([\\s\\S]*?);\\n`,
    'm'
  );
  const match = dump.match(header);
  if (!match) throw new Error(`No rows dumped for public.${table}.`);

  const columns = match[1].split(',').map((name) => name.trim().replace(/"/g, ''));
  for (const name of wanted) {
    if (!columns.includes(name)) throw new Error(`public.${table} has no column ${name}.`);
  }

  return match[2]
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith('(') && line.endsWith(')'))
    .map((line) => {
      const values = splitRow(line.slice(1, -1));
      if (values.length !== columns.length) {
        throw new Error(
          `public.${table} row has ${values.length} values for ${columns.length} columns.`
        );
      }
      return Object.fromEntries(columns.map((name, index) => [name, values[index]]));
    });
}

// '{ui,chat,mcp}' is how a text[] arrives. Nothing in this contract contains a
// comma or a quote, so anything that does is a change this generator has not
// been taught about and must not guess at.
function readTextArray(raw, context) {
  if (!raw.startsWith('{') || !raw.endsWith('}'))
    throw new Error(`${context}: not an array: ${raw}`);
  const body = raw.slice(1, -1);
  if (!body) return [];
  if (body.includes('"'))
    throw new Error(`${context}: quoted array element needs real parsing: ${raw}`);
  return body.split(',').map((value) => value.trim());
}

const dump = dumpPublicData();
const contracts = readTable(dump, 'operation_contracts', tables.operation_contracts);
const undo = readTable(dump, 'operation_undo_support', tables.operation_undo_support);

const contractLines = contracts
  .map((row) => ({
    id: row.operation_id,
    riskClass: row.risk_class,
    exposures: readTextArray(row.exposures, row.operation_id),
    reversible: row.reversible === 'true',
  }))
  .sort((first, second) => first.id.localeCompare(second.id))
  .map(
    (row) =>
      `  '${row.id}': { riskClass: '${row.riskClass}', exposures: [${row.exposures
        .map((value) => `'${value}'`)
        .join(', ')}], reversible: ${row.reversible} },`
  );

const undoLines = undo
  .map((row) => ({ id: row.operation_id, strategy: row.strategy }))
  .sort((first, second) => first.id.localeCompare(second.id))
  .map((row) => `  '${row.id}': '${row.strategy}',`);

const output = `// Generated from a clean migration reset. Do not edit by hand.
//
// Run \`npm run types:generate\` to refresh it; \`npm run verify:db\` fails if it
// does not match the database. It exists so the TypeScript Operation manifest
// can be checked against what Postgres actually holds, in a unit test that
// needs no database.

export type GeneratedOperationContract = {
  riskClass: string;
  exposures: readonly string[];
  reversible: boolean;
};

export const databaseOperationContracts: Readonly<Record<string, GeneratedOperationContract>> = {
${contractLines.join('\n')}
};

export const databaseUndoStrategies: Readonly<Record<string, string>> = {
${undoLines.join('\n')}
};
`;

const target = process.argv[2];
if (!target) throw new Error('Usage: generate-operation-registry.mjs <output path>');
writeFileSync(target, output);
