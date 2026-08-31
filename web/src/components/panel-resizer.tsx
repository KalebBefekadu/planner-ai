'use client';

/* A shell panel separator that works with a pointer and with a keyboard.
   planner_ai_next_ui_ux_direction.md §14.3 makes both shell panels resizable
   (sidebar 200–320, context 288–480), and §16 requires that every drag has a
   keyboard equivalent — so pointer drag and the arrow keys drive the same
   clamped handler. Shared by the app shell and the /preview reference. */

export function PanelResizer({
  label,
  value,
  min,
  max,
  edge,
  defaultValue,
  className,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  edge: 'left' | 'right';
  defaultValue: number;
  className: string;
  onChange: (next: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));
  const direction = edge === 'left' ? 1 : -1;

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const originX = event.clientX;
    const originWidth = value;
    const move = (moveEvent: PointerEvent) =>
      onChange(clamp(originWidth + (moveEvent.clientX - originX) * direction));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 32 : 8;
    const moves: Record<string, number> = {
      ArrowLeft: value - step * direction,
      ArrowRight: value + step * direction,
      Home: min,
      End: max,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next));
  }

  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(defaultValue)}
    />
  );
}
