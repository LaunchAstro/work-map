import type { ReactNode } from 'react';

export function ComponentControls(props: {
  readonly title: string;
  readonly copy?: (() => void) | undefined;
  readonly close: () => void;
}): ReactNode {
  return (
    <div className="callout-actions">
      {props.copy ? (
        <button
          type="button"
          className="copy-brief"
          title={`Copy ${props.title}`}
          aria-label={`Copy ${props.title}`}
          onClick={props.copy}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V4H4v12h4" />
          </svg>
        </button>
      ) : null}
      <button
        type="button"
        className="close"
        aria-label={`Close ${props.title}`}
        onClick={props.close}
      >
        ×
      </button>
    </div>
  );
}
