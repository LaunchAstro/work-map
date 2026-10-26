// SPDX-License-Identifier: AGPL-3.0-only
//
// The one callout: section details and every header inventory open in it. It owns
// placement (beside a card or below a header button, inside the window), the header controls, the
// title and snapshot line; callers supply the body, usually CalloutGroups.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeCallout, type CalloutPlace } from './callout-place.ts';
import { ComponentControls } from './ComponentControls.tsx';

export function Callout(props: {
  readonly label: string;
  readonly title: string;
  readonly snapshot?: string | undefined;
  readonly anchor: HTMLElement;
  /** Card callouts render in the map viewport; header callouts are fixed to the window. */
  readonly container: HTMLElement | 'window';
  readonly side: 'beside' | 'below';
  /** Anything whose change should re-place the callout, such as the camera view. */
  readonly watch?: unknown;
  readonly keyboard?: boolean | undefined;
  readonly section?: string | undefined;
  readonly copy?: (() => void) | undefined;
  readonly close: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<CalloutPlace>({
    left: 12,
    top: 12,
    width: 440,
    maxHeight: 500,
  });
  const { anchor, container, side, watch } = props;
  useLayoutEffect(() => {
    const measure = (): void => {
      const a = anchor.getBoundingClientRect();
      const c =
        container === 'window'
          ? new DOMRect(0, 0, document.documentElement.clientWidth, window.innerHeight)
          : container.getBoundingClientRect();
      setPlace(placeCallout(a, c, side));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    observer.observe(container === 'window' ? document.documentElement : container);
    // The card's board, or the header a button sits in: either can move the anchor.
    const moving = anchor.closest('.board') ?? anchor.closest('header');
    if (moving) observer.observe(moving);
    globalThis.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('resize', measure);
    };
  }, [anchor, container, side, watch]);
  useEffect(() => {
    if (props.keyboard) ref.current?.focus();
  }, [props.keyboard]);
  const host = container === 'window' ? (anchor.closest('.app') ?? document.body) : container;
  return createPortal(
    <div
      className="callout"
      data-section={props.section}
      data-fixed={container === 'window' ? 'yes' : 'no'}
      ref={ref}
      role="dialog"
      tabIndex={-1}
      aria-label={props.label}
      style={place}
    >
      <ComponentControls title={props.title} copy={props.copy} close={props.close} />
      <h2>{props.title}</h2>
      {props.snapshot ? <p className="brief-date">{props.snapshot}</p> : null}
      {props.children}
    </div>,
    host,
  );
}

/** A collapsible group inside a callout: title, count, rows. */
export function CalloutGroup(props: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly open?: boolean | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <details className="brief-group" open={props.open}>
      <summary>
        <h3>{props.title}</h3>
        {props.count === undefined ? null : <span>{props.count}</span>}
      </summary>
      {props.children}
    </details>
  );
}

/** A header button that opens a callout below it; Escape or a click elsewhere closes it. */
export function HeaderCallout(props: {
  readonly button: string;
  readonly label: string;
  readonly title: string;
  readonly snapshot?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const outside = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (!target.closest('.callout[data-fixed="yes"]') && !button.current?.contains(target))
        setOpen(false);
    };
    globalThis.addEventListener('keydown', key);
    document.addEventListener('click', outside, true);
    return () => {
      globalThis.removeEventListener('keydown', key);
      document.removeEventListener('click', outside, true);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="header-button"
        ref={button}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {props.button}
      </button>
      {open && button.current ? (
        <Callout
          label={props.label}
          title={props.title}
          snapshot={props.snapshot}
          anchor={button.current}
          container="window"
          side="below"
          close={() => setOpen(false)}
        >
          {props.children}
        </Callout>
      ) : null}
    </>
  );
}
