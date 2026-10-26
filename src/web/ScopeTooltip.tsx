// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Tip } from './Bar.tsx';
import type { View } from './words.ts';

export function ScopeTooltip({
  tip,
  text: captured,
  viewport,
  view,
}: {
  readonly tip: Tip;
  readonly text: string;
  readonly viewport: HTMLElement;
  readonly view: View;
}): ReactNode {
  const el = useRef<HTMLDivElement | null>(null);
  // Follow the anchor's current words, so an open tooltip updates when the data refreshes.
  const [text, setText] = useState(captured);
  useLayoutEffect(() => {
    const read = (): void => setText(tip.anchor.dataset['tip'] ?? captured);
    read();
    const observer = new MutationObserver(read);
    observer.observe(tip.anchor, { attributes: true, attributeFilter: ['data-tip'] });
    return () => observer.disconnect();
  }, [tip, captured]);
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    arrow: 12,
    below: false,
    visible: true,
  });
  useLayoutEffect(() => {
    const place = (): void => {
      const box = tip.anchor.getBoundingClientRect(),
        vp = viewport.getBoundingClientRect();
      const width = el.current?.offsetWidth ?? 0,
        height = el.current?.offsetHeight ?? 0;
      const centre = box.left - vp.left + box.width / 2;
      const left = Math.max(8, Math.min(centre - width / 2, vp.width - width - 8));
      const below = box.top - vp.top < height + 18;
      const top = below ? box.bottom - vp.top + 9 : box.top - vp.top - height - 9;
      setPosition({
        left,
        top: Math.max(8, Math.min(top, vp.height - height - 8)),
        arrow: Math.max(8, Math.min(centre - left, width - 8)),
        below,
        visible:
          box.right > vp.left && box.left < vp.right && box.bottom > vp.top && box.top < vp.bottom,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(viewport);
    observer.observe(tip.anchor);
    const diagram = tip.anchor.closest('.board');
    if (diagram) observer.observe(diagram);
    if (el.current) observer.observe(el.current);
    return () => observer.disconnect();
  }, [tip, viewport, view, text]);
  return createPortal(
    <div
      id="scope-tooltip"
      className="scope-tooltip"
      role="tooltip"
      ref={el}
      data-below={position.below ? 'yes' : 'no'}
      style={
        {
          left: position.left,
          top: position.top,
          visibility: position.visible ? 'visible' : 'hidden',
          '--arrow-x': `${position.arrow}px`,
        } as React.CSSProperties
      }
    >
      {tip.key.startsWith('agent:') || !text.includes(' · ') ? (
        text
      ) : (
        <>
          <span className="tooltip-label">{text.slice(0, text.indexOf(' · '))}</span>
          <strong className="tooltip-value">{text.slice(text.indexOf(' · ') + 3)}</strong>
        </>
      )}
    </div>,
    viewport,
  );
}
