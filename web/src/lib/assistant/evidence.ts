export type EvidenceType = 'vision' | 'goal' | 'action' | 'note' | 'memory';

export type EvidenceReference = {
  type: EvidenceType;
  id: string;
};

export type AssistantEvidence = EvidenceReference & {
  label: string;
  href: string;
};

export type AssistantClaimStatus = 'supported' | 'inferred' | 'needs_input';

export type AssistantClaim = {
  text: string;
  status: AssistantClaimStatus;
  evidence: EvidenceReference[];
};

export type ResolvedAssistantClaim = Omit<AssistantClaim, 'evidence'> & {
  evidence: AssistantEvidence[];
};

type ContextItem = {
  id?: unknown;
  title?: unknown;
  statement?: unknown;
  aiExcluded?: unknown;
};

type AssistantContext = {
  vision?: { id?: unknown } | null;
  goals?: ContextItem[];
  actions?: ContextItem[];
  noteTitles?: ContextItem[];
  explicitMemories?: ContextItem[];
};

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function buildEvidenceCatalog(context: unknown): AssistantEvidence[] {
  if (!context || typeof context !== 'object') return [];
  const typedContext = context as AssistantContext;
  const evidence: AssistantEvidence[] = [];
  if (typedContext.vision && validId(typedContext.vision.id)) {
    evidence.push({ type: 'vision', id: typedContext.vision.id, label: 'Vision', href: '/vision' });
  }
  const add = (
    type: EvidenceType,
    items: ContextItem[] | undefined,
    label: (item: ContextItem) => string,
    href: (id: string) => string,
    include: (item: ContextItem) => boolean = () => true
  ) => {
    for (const item of items ?? []) {
      if (!include(item) || !validId(item.id)) continue;
      evidence.push({ type, id: item.id, label: label(item).slice(0, 120), href: href(item.id) });
    }
  };
  add(
    'goal',
    typedContext.goals,
    (item) => String(item.title ?? 'Goal'),
    () => '/goals'
  );
  add(
    'action',
    typedContext.actions,
    (item) => String(item.title ?? 'Action'),
    () => '/'
  );
  add(
    'note',
    typedContext.noteTitles,
    (item) => String(item.title ?? 'Note'),
    (id) => `/notes?note=${encodeURIComponent(id)}`,
    (item) => item.aiExcluded !== true
  );
  add(
    'memory',
    typedContext.explicitMemories,
    (item) => String(item.statement ?? 'Memory'),
    () => '/settings/memory'
  );
  return evidence;
}

export function resolveEvidence(
  requested: EvidenceReference[],
  catalog: AssistantEvidence[]
): AssistantEvidence[] {
  const available = new Map(catalog.map((item) => [`${item.type}:${item.id}`, item]));
  const seen = new Set<string>();
  const resolved: AssistantEvidence[] = [];
  for (const reference of requested) {
    const key = `${reference.type}:${reference.id}`;
    const item = available.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    resolved.push(item);
    if (resolved.length === 8) break;
  }
  return resolved;
}

export function resolveClaims(
  claims: AssistantClaim[],
  catalog: AssistantEvidence[]
): ResolvedAssistantClaim[] | null {
  const resolved = claims.map((claim) => ({
    ...claim,
    evidence: resolveEvidence(claim.evidence, catalog),
  }));
  if (resolved.some((claim, index) => claim.evidence.length !== claims[index].evidence.length)) {
    return null;
  }
  return resolved;
}
