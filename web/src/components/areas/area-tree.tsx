'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from 'next/navigation';
import { ChevronRight, EyeOff, Plus } from 'lucide-react';
import { createArea } from '@/app/areas/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { flattenAreaTree, type AreaNode } from '@/lib/areas/tree';

function archivedHref(
  pathname: string,
  search: ReadonlyURLSearchParams | null,
  showArchived: boolean
) {
  const next = new URLSearchParams(search?.toString() ?? '');
  if (showArchived) next.delete('archived');
  else next.set('archived', '1');
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/* The shared tree. It is one tree: Planning and Knowledge both open the same
   area, rather than each keeping a list of its own that has to be reconciled
   by the person using them. */
export function AreaTree({
  tree,
  activeAreaId,
  showArchived,
}: {
  tree: AreaNode[];
  activeAreaId: string | null;
  showArchived: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(undefined);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* An area on the path to the open one is never collapsed out from under it:
     the open page must always be reachable in the list beside it. */
  const forcedOpen = useMemo(() => {
    const open = new Set<string>();
    const walk = (nodes: AreaNode[], path: string[]): boolean =>
      nodes.some((node) => {
        const here = [...path, node.id];
        if (node.id === activeAreaId || walk(node.children, here)) {
          for (const id of path) open.add(id);
          return true;
        }
        return false;
      });
    walk(tree, []);
    return open;
  }, [tree, activeAreaId]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitNewArea(parentAreaId: string | null) {
    const name = draftName.trim();
    if (!name) return;
    setError(null);
    /* One key per attempt. Pressing Enter twice is one area, and a retry after
       a failure is the same attempt rather than a second one. */
    const requestKey = `${parentAreaId ?? 'root'}:${name}:${Date.now()}`;
    startTransition(async () => {
      try {
        const created = await createArea({ name, parentAreaId, requestKey });
        setDraftName('');
        setAddingUnder(undefined);
        router.push(`/areas/${created.id}`);
      } catch (caught) {
        setError(actionFailureMessage(caught, 'Planner AI could not create this area.'));
      }
    });
  }

  function renderNode(node: AreaNode) {
    if (node.hiddenByAncestor && !showArchived) return null;
    const hasChildren = node.children.length > 0;
    const isOpen = !collapsed.has(node.id) || forcedOpen.has(node.id);
    return (
      <li key={node.id}>
        <div
          className={node.id === activeAreaId ? 'area-row area-row-active' : 'area-row'}
          style={{ paddingLeft: `${8 + node.depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="area-twisty"
              aria-expanded={isOpen}
              aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
              onClick={() => toggle(node.id)}
            >
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={isOpen ? 'area-twisty-open' : ''}
              />
            </button>
          ) : (
            <span className="area-twisty area-twisty-empty" aria-hidden="true" />
          )}
          <Link className="area-name" href={`/areas/${node.id}`}>
            {node.icon ? (
              <span className="area-icon" aria-hidden="true">
                {node.icon}
              </span>
            ) : null}
            {node.name}
          </Link>
          {node.archivedAt ? (
            <span className="area-badge" title="Archived">
              <EyeOff size={12} aria-hidden="true" />
              <span className="visually-hidden">Archived</span>
            </span>
          ) : null}
          <button
            type="button"
            className="area-add"
            aria-label={`Add a subarea under ${node.name}`}
            onClick={() => {
              setAddingUnder(node.id);
              setDraftName('');
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        {addingUnder === node.id ? (
          <div className="area-draft" style={{ paddingLeft: `${22 + node.depth * 14}px` }}>
            <input
              autoFocus
              value={draftName}
              disabled={pending}
              placeholder="Name this subarea"
              aria-label={`Name of the new subarea under ${node.name}`}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitNewArea(node.id);
                if (event.key === 'Escape') setAddingUnder(undefined);
              }}
            />
          </div>
        ) : null}
        {hasChildren && isOpen ? <ul>{node.children.map(renderNode)}</ul> : null}
      </li>
    );
  }

  const hasArchived = flattenAreaTree(tree).some((node) => node.hiddenByAncestor);

  return (
    <nav className="area-tree" aria-label="Life areas">
      <div className="area-tree-heading">
        <h2>Life areas</h2>
        <button
          type="button"
          className="area-add"
          aria-label="Add a life area"
          onClick={() => {
            setAddingUnder(null);
            setDraftName('');
          }}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="area-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul>{tree.map(renderNode)}</ul>
      {addingUnder === null ? (
        <div className="area-draft">
          <input
            autoFocus
            value={draftName}
            disabled={pending}
            placeholder="Name this area"
            aria-label="Name of the new life area"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitNewArea(null);
              if (event.key === 'Escape') setAddingUnder(undefined);
            }}
          />
        </div>
      ) : null}
      {hasArchived ? (
        /* Carried on the address rather than held in this component, so the
           choice survives opening an area and pressing back. */
        <Link className="area-archived-toggle" href={archivedHref(pathname, search, showArchived)}>
          {showArchived ? 'Hide archived areas' : 'Show archived areas'}
        </Link>
      ) : null}
    </nav>
  );
}
