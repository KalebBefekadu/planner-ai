import { describe, expect, it } from 'vitest';
import { operationDefinitions, undoableOperationIds } from '@/lib/operations';
import {
  databaseOperationContracts,
  databaseUndoStrategies,
} from '@/lib/operations/contract-registry.generated';
import { mcpOperationIds, workspaceSnapshotGrant } from '@/lib/mcp/catalog';

/* The Operation contract has always lived in two places: `operationDefinitions`
   in TypeScript, and the `operation_contracts` rows the migrations insert.
   Nothing compared them. A risk class raised in SQL and not in TypeScript --
   or the reverse -- would change what the MCP catalog advertises as
   destructive, and what the database allows, while every test still passed.

   The generated registry is what Postgres holds after a clean reset, so these
   assertions run in the ordinary unit suite with no database. `verify:db`
   fails separately if the registry itself is stale. Drift in either direction
   therefore fails CI: an un-regenerated registry in the database job, and a
   manifest that disagrees with it in the application job. */

// The MCP workspace snapshot is a read grant, not an executable Operation. It
// is registered in the database so a token can be scoped to it and so the read
// leaves a receipt, but there is no handler in `operationDefinitions` and there
// should not be one.
const databaseOnly = new Set<string>([workspaceSnapshotGrant.id]);

describe('the Operation contract TypeScript and Postgres agree on', () => {
  it('registers every executable Operation in the database', () => {
    const missing = Object.keys(operationDefinitions).filter(
      (id) => !(id in databaseOperationContracts)
    );
    expect(missing).toEqual([]);
  });

  it('has a TypeScript handler for every contract that is not a read grant', () => {
    const orphans = Object.keys(databaseOperationContracts).filter(
      (id) => !(id in operationDefinitions) && !databaseOnly.has(id)
    );
    expect(orphans).toEqual([]);
  });

  it('agrees on the risk class of every Operation', () => {
    const drift = Object.entries(operationDefinitions)
      .filter(([id, definition]) => databaseOperationContracts[id]?.riskClass !== definition.risk)
      .map(([id, definition]) => ({
        id,
        typescript: definition.risk,
        database: databaseOperationContracts[id]?.riskClass,
      }));
    expect(drift).toEqual([]);
  });

  it('agrees on where every Operation is exposed', () => {
    const drift = Object.entries(operationDefinitions)
      .filter(([id, definition]) => {
        const database = [...(databaseOperationContracts[id]?.exposures ?? [])].sort();
        return JSON.stringify([...definition.exposure].sort()) !== JSON.stringify(database);
      })
      .map(([id, definition]) => ({
        id,
        typescript: [...definition.exposure].sort(),
        database: [...(databaseOperationContracts[id]?.exposures ?? [])].sort(),
      }));
    expect(drift).toEqual([]);
  });

  it('agrees on whether every Operation is reversible', () => {
    const drift = Object.entries(operationDefinitions)
      .filter(
        ([id, definition]) => databaseOperationContracts[id]?.reversible !== definition.reversible
      )
      .map(([id, definition]) => ({
        id,
        typescript: definition.reversible,
        database: databaseOperationContracts[id]?.reversible,
      }));
    expect(drift).toEqual([]);
  });
});

describe('undo support', () => {
  it('records a strategy for every Operation TypeScript offers undo on', () => {
    const missing = undoableOperationIds.filter((id) => !(id in databaseUndoStrategies));
    expect(missing).toEqual([]);
  });

  it('offers undo in TypeScript for every strategy the database records', () => {
    const unoffered = Object.keys(databaseUndoStrategies).filter(
      (id) => !(undoableOperationIds as readonly string[]).includes(id)
    );
    expect(unoffered).toEqual([]);
  });

  /* An Operation the contract calls irreversible cannot have an undo strategy:
     the two together would mean the catalog tells a person their change cannot
     be taken back while the database stands ready to take it back. */
  it('never records a strategy for an Operation the contract calls irreversible', () => {
    const contradictions = Object.keys(databaseUndoStrategies).filter(
      (id) => databaseOperationContracts[id]?.reversible === false
    );
    expect(contradictions).toEqual([]);
  });

  /* The stronger half of the same rule, and it currently holds for every
     Operation: calling something reversible in the catalog is a promise, and
     the recorded strategy is how the promise is kept. An Operation that says
     reversible with no strategy behind it offers an Undo that cannot run. */
  it('records a strategy for every Operation the contract calls reversible', () => {
    const withoutStrategy = Object.entries(databaseOperationContracts)
      .filter(([id, contract]) => contract.reversible && !(id in databaseUndoStrategies))
      .map(([id]) => id)
      .sort();
    expect(withoutStrategy).toEqual([]);
  });
});

describe('the MCP catalog', () => {
  it('only advertises Operations the database exposes to mcp', () => {
    const notExposed = mcpOperationIds.filter(
      (id) => !databaseOperationContracts[id]?.exposures.includes('mcp')
    );
    expect(notExposed).toEqual([]);
  });

  /* The MCP tool annotation calls anything above low risk destructive, so the
     risk class the database holds is what a client is told. They have to be
     the same value, not two opinions. */
  it('derives its destructive hint from the same risk class the database holds', () => {
    const drift = mcpOperationIds.filter(
      (id) => operationDefinitions[id].risk !== databaseOperationContracts[id]?.riskClass
    );
    expect(drift).toEqual([]);
  });
});
