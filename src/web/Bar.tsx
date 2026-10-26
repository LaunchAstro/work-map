// SPDX-License-Identifier: AGPL-3.0-only
import './bar.css';
import type { ReactNode } from 'react';
import type { BarModel } from './bar-models.ts';

export type TipSource = 'pointer' | 'keyboard';
export type Tip = {
  /** Unique across the page, so aria-describedby points at the hovered thing only. */
  readonly key: string;
  readonly text: string;
  readonly anchor: HTMLElement;
  readonly source: TipSource;
};
export type TipControls = {
  readonly tip: Tip | null;
  readonly showTip: (tip: Tip) => void;
  readonly hideTip: (anchor: HTMLElement, source: TipSource) => void;
};

/** Hover handlers that show `text` beside the element, for pointer and keyboard alike. */
export function tipHandlers(
  key: string,
  text: string,
  { tip, showTip, hideTip }: TipControls,
): {
  'aria-describedby': string | undefined;
  'data-tip': string;
  onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: React.PointerEvent<HTMLElement>) => void;
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
} {
  return {
    'aria-describedby': tip?.key === key ? 'scope-tooltip' : undefined,
    // The tooltip reads this live, so an open tooltip follows a data refresh.
    'data-tip': text,
    onPointerEnter: (e) => showTip({ key, text, anchor: e.currentTarget, source: 'pointer' }),
    onPointerLeave: (e) => hideTip(e.currentTarget, 'pointer'),
    onFocus: (e) => showTip({ key, text, anchor: e.currentTarget, source: 'keyboard' }),
    onBlur: (e) => hideTip(e.currentTarget, 'keyboard'),
  };
}

const CLASS = {
  progress: 'scope-bar',
  review: 'review-bar',
  tickets: 'ticket-bar',
} as const;

/** The one bar drawn everywhere: a 1px frame, 1px dividers and a percentage where it fits. */
export function Bar(
  props: TipControls & { readonly id: string; readonly model: BarModel },
): ReactNode {
  const { model } = props;
  const filled = model.segments.some((s) => s.tone !== 'rest');
  return (
    <div
      className={`bar ${CLASS[model.kind]}`}
      data-pending={model.pending === null ? 'no' : 'yes'}
      data-filled={filled ? 'yes' : 'no'}
      role={model.meter === null ? 'img' : 'meter'}
      aria-label={`${model.label} · ${model.pending ?? [...new Set(model.segments.map((s) => s.words))].join('; ')}`}
      {...(model.meter === null
        ? {}
        : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': model.meter })}
    >
      {model.segments.map((segment) => (
        <span
          key={segment.key}
          data-k={segment.key}
          data-tone={segment.tone}
          style={{ width: `${segment.share}%` }}
          tabIndex={0}
          aria-label={segment.words}
          {...tipHandlers(`${props.id}:${segment.key}`, segment.words, props)}
        >
          {model.pending !== null ? (
            <b className="pending-label">Pending</b>
          ) : segment.label !== null ? (
            <b className="bar-label">{segment.label}%</b>
          ) : null}
        </span>
      ))}
    </div>
  );
}
