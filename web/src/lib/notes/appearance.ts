/* Document appearance: the page icon, the cover image and where that cover
 * sits vertically.
 *
 * /preview proved this pattern with fixture pages whose icon and cover were
 * hardcoded literals, and with one CSS class per cover (`coverJournal` was the
 * north-star image at a different vertical offset). Real Notes need the same
 * look driven by owner-chosen, durable values, so the fixed class list becomes
 * a bounded catalogue plus a numeric focal point, and the journal variant
 * disappears: it is `north` at 74%.
 *
 * Everything here is deliberately closed. A cover is a key into a bundled
 * image, never a URL, so nothing the owner types can point the page at a
 * third-party origin or defeat the image CSP. The icon is a short grapheme
 * string, never markup. This is the "no arbitrary executable customization"
 * line the ticket draws.
 */

export type NoteCoverKey = 'focus' | 'north' | 'health' | 'product';

export type NoteCover = {
  key: NoteCoverKey;
  /* Shown in the picker, and used as the image's accessible description.
   * A cover is decoration, but a decorative image the owner deliberately
   * chose still deserves a name in the control that chooses it. */
  label: string;
  imageUrl: string;
  /* Painted under the image so the band has the right weight before the
   * PNG arrives, and behind its transparent edges afterwards. */
  backdrop: string;
};

/* The four images already shipped in public/. No new binaries, and no upload
 * path: WS-05 owns private attachments, and pointing a cover at a quarantined
 * upload before that ticket lands would render unscanned bytes. */
export const NOTE_COVERS: readonly NoteCover[] = [
  {
    key: 'focus',
    label: 'Still water',
    imageUrl: '/preview-focus-cover.png',
    backdrop: '#cdded6',
  },
  {
    key: 'north',
    label: 'Night harbour',
    imageUrl: '/preview-north-star-cover.png',
    backdrop: '#123f65',
  },
  {
    key: 'health',
    label: 'Open field',
    imageUrl: '/preview-health-cover.png',
    backdrop: '#dfe9cf',
  },
  {
    key: 'product',
    label: 'Deep pine',
    imageUrl: '/preview-product-cover.png',
    backdrop: '#26322f',
  },
];

const COVER_KEYS = new Set<string>(NOTE_COVERS.map((cover) => cover.key));

export const DEFAULT_COVER_POSITION = 50;

export type NoteAppearance = {
  iconEmoji: string | null;
  coverKey: NoteCoverKey | null;
  coverPosition: number;
};

export const RESET_APPEARANCE: NoteAppearance = {
  iconEmoji: null,
  coverKey: null,
  coverPosition: DEFAULT_COVER_POSITION,
};

export function findCover(key: NoteCoverKey | null): NoteCover | null {
  if (key === null) return null;
  return NOTE_COVERS.find((cover) => cover.key === key) ?? null;
}

export function isNoteCoverKey(value: unknown): value is NoteCoverKey {
  return typeof value === 'string' && COVER_KEYS.has(value);
}

/* Markup punctuation and the ASCII control range are refused outright rather
 * than stripped, because a value that needed sanitising is a value the owner
 * did not mean to set. */
const UNSAFE_ICON = /[\u0000-\u001f\u007f<>&"'\\]/;

/* An emoji is one or two visible characters, not a paragraph. Counting code
 * points rather than UTF-16 units matters in both directions: a single flag or
 * a skin-toned person is several units long and would otherwise be rejected,
 * while a short label would sail through a naive `.length` check. */
export function normalizeNoteIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (UNSAFE_ICON.test(trimmed)) return null;
  if ([...trimmed].length > 8) return null;
  return trimmed;
}

/* The cover is positioned by moving its focal point up and down inside a fixed
 * band, which is all /preview's per-cover offsets ever did. Bounding it to
 * 0-100 and rounding to a whole percent keeps the value renderable as a
 * `background-position` and keeps the stored number small and comparable. */
export function normalizeCoverPosition(value: unknown): number {
  /* null and '' are the two values that reach here from a column written
     before this migration, and Number() turns both into 0 -- which is a
     legitimate position, so the cover would silently pin to the top of the
     band instead of falling back to centre. */
  if (value === null || value === undefined || value === '') return DEFAULT_COVER_POSITION;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_COVER_POSITION;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

/* One place that turns whatever came back from the database into a shape the
 * document header can render. A row written before this migration, or an
 * import that carried no appearance, resolves to the reset value rather than
 * to undefined, so the header never has to branch on "not set yet". */
export function normalizeNoteAppearance(value: {
  iconEmoji?: unknown;
  coverKey?: unknown;
  coverPosition?: unknown;
}): NoteAppearance {
  const coverKey = isNoteCoverKey(value.coverKey) ? value.coverKey : null;
  return {
    iconEmoji: normalizeNoteIcon(value.iconEmoji),
    coverKey,
    /* Position is meaningless without a cover, and storing a stale offset
     * against no image makes two Notes that look identical compare unequal.
     * Removing the cover returns the offset to centre. */
    coverPosition:
      coverKey === null ? DEFAULT_COVER_POSITION : normalizeCoverPosition(value.coverPosition),
  };
}

export function isDefaultAppearance(appearance: NoteAppearance): boolean {
  return (
    appearance.iconEmoji === null &&
    appearance.coverKey === null &&
    appearance.coverPosition === DEFAULT_COVER_POSITION
  );
}

/* The inline style the document header hands to the cover band. Kept beside
 * the catalogue so the CSS-shaped string and the values it interpolates can
 * never drift apart, and so a test can assert the exact declaration. */
export function coverStyle(appearance: NoteAppearance): {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
} | null {
  const cover = findCover(appearance.coverKey);
  if (!cover) return null;
  return {
    backgroundColor: cover.backdrop,
    backgroundImage: `url('${cover.imageUrl}')`,
    backgroundPosition: `center ${normalizeCoverPosition(appearance.coverPosition)}%`,
  };
}
