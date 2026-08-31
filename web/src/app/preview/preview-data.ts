/* Fixture content for the /preview reference implementation. Kept apart from
   the shell so the page component stays about behaviour, and so the copy can
   be reviewed on its own — most of it is product writing, not code. */

export type PageId =
  | 'personal'
  | 'north-star'
  | 'health'
  | 'planner-ai'
  | 'weekly-reset'
  | 'journal'
  | 'research';
export type CoverStyle = 'focus' | 'north' | 'health' | 'product' | 'journal';
export type CardTone = 'green' | 'blue' | 'coral' | 'yellow';

export type PreviewPage = {
  id: PageId;
  icon: string;
  title: string;
  cover: CoverStyle;
  status: string;
  area: string;
  review: string;
  updated: string;
  connections: number;
  lead: string;
  aiTitle: string;
  aiText: string;
  sectionTitle: string;
  sectionBody: string;
  cards: Array<{ icon: string; title: string; text: string; tone: CardTone }>;
  listTitle: string;
  list: string[];
};

export const previewPages: Record<PageId, PreviewPage> = {
  personal: {
    id: 'personal',
    icon: '🌄',
    title: 'Personal operating system',
    cover: 'focus',
    status: 'Living document',
    area: '🧭 Direction',
    review: 'Every month',
    updated: '4 minutes ago',
    connections: 12,
    lead: 'A simple system for deciding what deserves my attention, connecting everyday actions to a larger direction, and learning from what actually happens.',
    aiTitle: 'One useful connection',
    aiText:
      'Your “Build with calm urgency” principle supports two active goals, but neither has a weekly action yet.',
    sectionTitle: 'What matters now',
    sectionBody:
      'Build a life where focused work, faith, health, and meaningful relationships reinforce each other instead of competing for whatever attention is left.',
    cards: [
      {
        icon: '🌱',
        title: 'Health',
        text: 'Protect energy before optimizing output.',
        tone: 'green',
      },
      {
        icon: '✦',
        title: 'Craft',
        text: 'Build useful things with patience and rigor.',
        tone: 'blue',
      },
    ],
    listTitle: 'Operating principles',
    list: [
      'Choose three meaningful outcomes before the day fills itself.',
      'Turn vague commitments into the next visible action.',
      'Review evidence every week, then adjust without drama.',
    ],
  },
  'north-star': {
    id: 'north-star',
    icon: '🧭',
    title: 'North star & values',
    cover: 'north',
    status: 'Active',
    area: '✨ Vision',
    review: 'Every quarter',
    updated: 'Yesterday',
    connections: 18,
    lead: 'A durable direction for the kind of person I am becoming, the work I want to contribute, and the relationships I refuse to leave to chance.',
    aiTitle: 'A value without evidence',
    aiText:
      '“Generosity” is named here but has no recent reflection, commitment, or relationship connected to it.',
    sectionTitle: 'The direction',
    sectionBody:
      'Live with conviction, make useful things, become dependable to the people I love, and keep enough margin to notice what is happening around me.',
    cards: [
      {
        icon: '✦',
        title: 'Useful work',
        text: 'Create outcomes that make someone’s life meaningfully better.',
        tone: 'blue',
      },
      {
        icon: '◎',
        title: 'Presence',
        text: 'Give full attention to the person and work in front of me.',
        tone: 'yellow',
      },
    ],
    listTitle: 'Values in practice',
    list: [
      'Tell the truth early, especially when it is uncomfortable.',
      'Choose depth over the appearance of busyness.',
      'Leave people and systems stronger than I found them.',
    ],
  },
  health: {
    id: 'health',
    icon: '🌱',
    title: 'Health reset',
    cover: 'health',
    status: 'On track',
    area: '🌿 Health',
    review: 'Every week',
    updated: 'Today, 7:10 AM',
    connections: 9,
    lead: 'Rebuild steady energy through a few repeatable behaviors: train, sleep, eat simply, and recover before fatigue turns into a crisis.',
    aiTitle: 'Your strongest pattern',
    aiText:
      'Training completion is highest on days when the first work block begins after breakfast instead of immediately after waking.',
    sectionTitle: 'This season',
    sectionBody:
      'The goal is not a dramatic transformation. It is a body and routine that support focused work, clear thinking, and a long useful life.',
    cards: [
      {
        icon: '☀',
        title: 'Morning',
        text: 'Water, daylight, protein, then focused work.',
        tone: 'yellow',
      },
      {
        icon: '◒',
        title: 'Recovery',
        text: 'Protect eight hours in bed and one low-intensity day.',
        tone: 'green',
      },
    ],
    listTitle: 'Weekly commitments',
    list: [
      'Complete three strength sessions.',
      'Walk outside for at least thirty minutes each day.',
      'Prepare weekday meals before Monday morning.',
    ],
  },
  'planner-ai': {
    id: 'planner-ai',
    icon: '✦',
    title: 'Planner AI private beta',
    cover: 'product',
    status: 'In progress',
    area: '⚙ Product',
    review: 'Every Friday',
    updated: '12 minutes ago',
    connections: 27,
    lead: 'Build a trustworthy workspace where notes, plans, and AI operate on the same reality without hiding control or locking away the user’s thinking.',
    aiTitle: 'Release risk detected',
    aiText:
      'The frontend direction is now coherent, but the editor round-trip and authenticated provider fixtures still block a dependable beta.',
    sectionTitle: 'Product promise',
    sectionBody:
      'Capture naturally, develop ideas into durable knowledge, connect actions to direction, and delegate safely through direct UI, voice, chat, or MCP.',
    cards: [
      {
        icon: '◫',
        title: 'Workspace',
        text: 'Markdown pages, links, collections, graph, and canvas.',
        tone: 'blue',
      },
      {
        icon: '✦',
        title: 'Agent-native',
        text: 'Every authorized action available through one operation layer.',
        tone: 'coral',
      },
    ],
    listTitle: 'Next release gates',
    list: [
      'Complete the multi-page frontend prototype.',
      'Prove editor fidelity with the golden Markdown corpus.',
      'Run authenticated AI and recovery journeys end to end.',
    ],
  },
  'weekly-reset': {
    id: 'weekly-reset',
    icon: '🗓',
    title: 'Weekly reset',
    cover: 'focus',
    status: 'Template',
    area: '🗓 Planning',
    review: 'Every Sunday',
    updated: 'Aug 23',
    connections: 8,
    lead: 'A repeatable thirty-minute ritual for closing the old week honestly and entering the new one with fewer, clearer commitments.',
    aiTitle: 'Review is ready',
    aiText:
      'Four unfinished actions and three unprocessed captures are ready to reconcile before you choose next week’s commitments.',
    sectionTitle: 'Reset before planning',
    sectionBody:
      'A useful weekly plan begins with evidence. Clear what is stale, name what changed, and only then decide what deserves another week.',
    cards: [
      {
        icon: '✓',
        title: 'Close',
        text: 'Reconcile unfinished work and capture lessons.',
        tone: 'green',
      },
      {
        icon: '→',
        title: 'Choose',
        text: 'Commit to five outcomes with visible next actions.',
        tone: 'coral',
      },
    ],
    listTitle: 'Reset checklist',
    list: [
      'Empty the capture inbox.',
      'Review goals, calendar, and completed work.',
      'Choose five commitments and protect the time.',
    ],
  },
  journal: {
    id: 'journal',
    icon: '☀',
    title: 'August 25 journal',
    cover: 'journal',
    status: 'Private',
    area: '📓 Journal',
    review: 'Never',
    updated: 'Today, 7:42 AM',
    connections: 4,
    lead: 'I feel clearer about the product today. The interface finally has a center of gravity: writing first, planning as one powerful view, AI available but not demanding attention.',
    aiTitle: 'Theme from this week',
    aiText:
      'Three entries mention clarity arriving after reducing scope. This may be worth turning into a working principle.',
    sectionTitle: 'Morning reflection',
    sectionBody:
      'The next useful move is to make the prototype broad enough to feel real, then test whether the navigation still feels simple when there are many pages.',
    cards: [
      { icon: '☁', title: 'Mood', text: 'Calm, curious, ready to refine.', tone: 'blue' },
      {
        icon: '↗',
        title: 'Momentum',
        text: 'Continue the frontend while the direction is vivid.',
        tone: 'yellow',
      },
    ],
    listTitle: 'Do today',
    list: [
      'Review every responsive breakpoint.',
      'Add distinct pages and visual identities.',
      'Write down what still feels artificial.',
    ],
  },
  research: {
    id: 'research',
    icon: '🔬',
    title: 'AI workspace research',
    cover: 'product',
    status: 'Researching',
    area: '🔬 Research',
    review: 'When updated',
    updated: 'Aug 24',
    connections: 21,
    lead: 'Notes on interfaces that combine direct manipulation, durable personal knowledge, and AI-generated task surfaces without collapsing everything into chat.',
    aiTitle: 'Research cluster found',
    aiText:
      'Your notes on GenUI, local-first ownership, and operation parity all point to one design rule: generated surfaces must remain inspectable product objects.',
    sectionTitle: 'Working thesis',
    sectionBody:
      'The frontier workspace is neither a chatbot with files nor a traditional editor with an AI button. It is a stable object system that can compose the right interface for the current decision.',
    cards: [
      {
        icon: '◈',
        title: 'GenUI',
        text: 'Compose trusted components around a concrete task.',
        tone: 'coral',
      },
      {
        icon: '⌂',
        title: 'Local-first',
        text: 'Make the user’s accepted work durable before sync.',
        tone: 'green',
      },
    ],
    listTitle: 'Questions to test',
    list: [
      'When is generated UI faster than a known view?',
      'How much context can users confidently inspect?',
      'Which customizations improve memory instead of adding noise?',
    ],
  },
};

export const files = [
  previewPages.personal,
  previewPages['north-star'],
  previewPages.health,
  previewPages['planner-ai'],
];

export const focusItems = [
  { title: 'Finalize the product story', meta: 'Planner AI · 60 min', color: 'coral' },
  { title: 'Complete morning training', meta: 'Health · 45 min', color: 'green' },
  { title: 'Review August finances', meta: 'Finance · 30 min', color: 'blue' },
];

export const planRows = [
  {
    time: '8:00',
    title: 'Deep work: product direction',
    detail: '90 min · Planner AI',
    color: 'coral',
  },
  { time: '10:00', title: 'Training', detail: '45 min · Health', color: 'green' },
  { time: '12:30', title: 'Lunch + reset', detail: '45 min', color: 'yellow' },
  { time: '2:00', title: 'Build frontend prototype', detail: '2 hr · Planner AI', color: 'blue' },
];
