'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';

/**
 * An element whose size or offset is data, applied through the CSSOM.
 *
 * The Content Security Policy authorises stylesheets and `<style>` elements by
 * nonce, and a nonce does not extend to `style` attributes. Every progress bar
 * width, chart bar height, and indentation written as `style={{ … }}` was
 * therefore parsed and discarded, so those elements rendered at nothing: the
 * budget bar sat empty however much had been spent, and the usage chart was
 * flat whatever the traffic. Development allowed inline styles, so this was
 * only ever visible in a real build.
 *
 * Widening the policy is not an option worth taking. `style-src-attr` is not
 * supported everywhere, and `'unsafe-inline'` is ignored on `style-src` once a
 * nonce is present, so neither would fix this in every browser. Writing through
 * the CSSOM is unrestricted, works everywhere, and leaves the policy as strict
 * as it was.
 */
export function MeasuredFill({
  as: Tag = 'span',
  declarations,
  className,
  children,
}: {
  as?: ElementType;
  declarations: Record<string, string>;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  // Compared by content: these are recomputed on every render, so the object
  // identity changes even when the measurement has not.
  const serialized = JSON.stringify(declarations);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    for (const [property, value] of Object.entries(
      JSON.parse(serialized) as Record<string, string>
    )) {
      node.style.setProperty(property, value);
    }
  }, [serialized]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
