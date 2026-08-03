import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Inline, no-modal creation. Enter commits, Escape cancels, blur on an empty
 * field quietly closes — adding a goal should cost one keystroke to start and
 * one to finish, not a dialog round trip.
 */
export function InlineComposer({
  placeholder,
  onCommit,
  onCancel,
  className,
}: {
  placeholder: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const title = value.trim();
    if (!title) {
      onCancel();
      return;
    }
    onCommit(title);
    // Stay open so several goals can be added in a row without re-reaching for
    // the affordance — the common case when planning a quarter.
    setValue("");
  }

  return (
    <Input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (!value.trim()) onCancel();
      }}
      className={cn(
        "h-8 border-0 border-b border-dashed border-muted-foreground/40 bg-transparent px-0 text-sm shadow-none",
        "focus-visible:border-primary focus-visible:ring-0",
        className,
      )}
    />
  );
}
