'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { Image as ImageIcon, RotateCcw, Trash2 } from 'lucide-react';
import { setNoteAppearance } from '@/app/notes/actions';
import {
  DEFAULT_COVER_POSITION,
  NOTE_COVERS,
  RESET_APPEARANCE,
  coverStyle,
  findCover,
  isDefaultAppearance,
  normalizeNoteIcon,
  type NoteAppearance,
} from '@/lib/notes/appearance';

/* The document header /preview accepted: a cover band, a page icon overlapping
 * its lower edge, then the title. /preview's version was a picture of the
 * feature -- the buttons had no handlers and the values came from a fixture
 * table. This is the same shape driven by the Note's own durable metadata.
 *
 * Two things from /preview are deliberately not carried over. The Star button
 * belongs to favorites, which WS-02 owns, and the Status/Area/Review property
 * strip described fields real Notes do not have; inventing them here would put
 * fake data on a real page. Both are recorded in the pull request rather than
 * approximated.
 */
export function NoteAppearanceHeader({
  noteId,
  appearance,
  versionRef,
  onSaved,
  onError,
}: {
  noteId: string;
  appearance: NoteAppearance;
  versionRef: { current: number };
  onSaved: (version: number) => void;
  onError: (message: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [panel, setPanel] = useState<'none' | 'icon' | 'cover'>('none');
  /* The server is the authority, but the slider has to move at pointer speed.
   * Local state renders every drag frame; the commit happens on release. */
  const [draft, setDraft] = useState(appearance);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  /* A reload, another tab, or the router refresh that follows a save can land
   * new stored values on a component that is already showing a draft. When
   * that happens the stored values win, immediately.
   *
   * This is React's adjust-state-during-render pattern rather than an effect.
   * An effect would paint the stale draft for one frame first, and it compares
   * the three stored values rather than the object holding them: mapNote
   * builds a fresh appearance object on every server render, so comparing
   * identity would reset the draft on each parent render and make a drag
   * impossible to finish. */
  const { iconEmoji, coverKey, coverPosition } = appearance;
  const [stored, setStored] = useState({ iconEmoji, coverKey, coverPosition });
  if (
    stored.iconEmoji !== iconEmoji ||
    stored.coverKey !== coverKey ||
    stored.coverPosition !== coverPosition
  ) {
    setStored({ iconEmoji, coverKey, coverPosition });
    setDraft({ iconEmoji, coverKey, coverPosition });
    setPanel('none');
  }

  const commit = (next: NoteAppearance) => {
    setDraft(next);
    startTransition(async () => {
      try {
        const saved = await setNoteAppearance({
          id: noteId,
          iconEmoji: next.iconEmoji,
          coverKey: next.coverKey,
          coverPosition: next.coverPosition,
          expectedVersion: versionRef.current,
        });
        onSaved(saved.version);
      } catch (caught) {
        /* Put the stored values back on screen. Leaving the failed draft
         * visible would claim a change that is not saved anywhere. */
        setDraft({ iconEmoji, coverKey, coverPosition });
        onError(caught instanceof Error ? caught.message : 'Unable to change how this Note looks.');
      }
    });
  };

  const commitPosition = () => {
    if (draft.coverPosition === appearance.coverPosition) return;
    commit(draft);
  };

  const cover = findCover(draft.coverKey);
  const style = coverStyle(draft);

  return (
    <div className="note-appearance">
      {cover && style ? (
        <div
          className="note-cover"
          style={style}
          /* The image conveys nothing the page does not already say, so it is
           * presentational. Its name lives in the control that changes it,
           * where it is a choice rather than content. */
          role="presentation"
        >
          <div className="note-cover-actions">
            <button
              type="button"
              className="note-cover-action"
              aria-expanded={panel === 'cover'}
              aria-controls={panelId}
              onClick={() => setPanel(panel === 'cover' ? 'none' : 'cover')}
            >
              <ImageIcon size={14} aria-hidden="true" /> Change cover
            </button>
            <button
              type="button"
              className="note-cover-action"
              onClick={() =>
                commit({ ...draft, coverKey: null, coverPosition: DEFAULT_COVER_POSITION })
              }
            >
              <Trash2 size={14} aria-hidden="true" /> Remove cover
            </button>
          </div>
        </div>
      ) : null}

      <div className="note-appearance-controls">
        <button
          type="button"
          className="note-page-icon"
          data-empty={draft.iconEmoji === null ? 'true' : 'false'}
          aria-expanded={panel === 'icon'}
          aria-controls={panelId}
          onClick={() => setPanel(panel === 'icon' ? 'none' : 'icon')}
        >
          <span aria-hidden="true">{draft.iconEmoji ?? '+'}</span>
          <span className="visually-hidden">
            {draft.iconEmoji ? `Page icon ${draft.iconEmoji}. Change it` : 'Add a page icon'}
          </span>
        </button>

        <div className="note-appearance-buttons">
          {cover ? null : (
            <button
              type="button"
              className="note-appearance-button"
              aria-expanded={panel === 'cover'}
              aria-controls={panelId}
              onClick={() => setPanel(panel === 'cover' ? 'none' : 'cover')}
            >
              <ImageIcon size={14} aria-hidden="true" /> Add cover
            </button>
          )}
          {isDefaultAppearance(draft) ? null : (
            <button
              type="button"
              className="note-appearance-button"
              disabled={isPending}
              onClick={() => {
                setPanel('none');
                commit(RESET_APPEARANCE);
              }}
            >
              <RotateCcw size={14} aria-hidden="true" /> Reset appearance
            </button>
          )}
        </div>
      </div>

      {panel === 'none' ? null : (
        <div className="note-appearance-panel" id={panelId}>
          {panel === 'icon' ? (
            <div className="note-appearance-field">
              <label htmlFor={`${panelId}-icon`}>Page icon</label>
              <input
                id={`${panelId}-icon`}
                ref={iconInputRef}
                className="note-appearance-input"
                defaultValue={draft.iconEmoji ?? ''}
                maxLength={32}
                autoComplete="off"
                /* Typed rather than picked from a grid on purpose: the
                 * platform emoji keyboard is already the best picker on every
                 * device the owner uses, and a bundled grid would be a
                 * smaller, staler copy of it. */
                placeholder="Paste or type one emoji"
              />
              <div className="note-appearance-field-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isPending}
                  onClick={() => {
                    const typed = normalizeNoteIcon(iconInputRef.current?.value);
                    if (typed === null && (iconInputRef.current?.value ?? '').trim() !== '') {
                      onError('That icon is not a single emoji.');
                      return;
                    }
                    setPanel('none');
                    commit({ ...draft, iconEmoji: typed });
                  }}
                >
                  Use icon
                </button>
                {draft.iconEmoji ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isPending}
                    onClick={() => {
                      setPanel('none');
                      commit({ ...draft, iconEmoji: null });
                    }}
                  >
                    Remove icon
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="note-appearance-field">
              <fieldset className="note-cover-choices">
                <legend>Cover image</legend>
                {NOTE_COVERS.map((option) => (
                  <label key={option.key} className="note-cover-choice">
                    <input
                      type="radio"
                      name={`${panelId}-cover`}
                      value={option.key}
                      checked={draft.coverKey === option.key}
                      disabled={isPending}
                      onChange={() =>
                        commit({
                          ...draft,
                          coverKey: option.key,
                          coverPosition: draft.coverPosition,
                        })
                      }
                    />
                    <span
                      className="note-cover-swatch"
                      style={{
                        backgroundColor: option.backdrop,
                        backgroundImage: `url('${option.imageUrl}')`,
                      }}
                      aria-hidden="true"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>

              {cover ? (
                <div className="note-appearance-field">
                  <label htmlFor={`${panelId}-position`}>
                    Cover position ({draft.coverPosition}% from the top)
                  </label>
                  {/* A range input rather than a drag handle on the image:
                      it is keyboard-operable by default, announces its value,
                      and the bounded 0-100 it produces is exactly what is
                      stored. */}
                  <input
                    id={`${panelId}-position`}
                    className="note-cover-position"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.coverPosition}
                    disabled={isPending}
                    onChange={(event) =>
                      setDraft({ ...draft, coverPosition: Number(event.target.value) })
                    }
                    /* Saved when the drag ends, not on every frame: pointer
                       release covers the mouse and touch cases, blur covers
                       arrow keys, and a committed value equal to the stored
                       one is dropped rather than written again. */
                    onPointerUp={() => commitPosition()}
                    onBlur={() => commitPosition()}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
