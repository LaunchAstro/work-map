import type { ReactNode } from 'react';
import type { MapLink } from '../core/map-links.ts';

export function MapLinks({
  maps,
  id,
  title,
  onSwitch,
}: {
  readonly maps: readonly MapLink[] | null;
  readonly id: string | undefined;
  readonly title: string;
  /** Switches in this window; without it a link loads `?map=` on this origin. */
  readonly onSwitch?: ((id: string) => void) | undefined;
}): ReactNode {
  if (!maps?.some((map) => map.id === id)) return <h1>{title}</h1>;
  return (
    <>
      <h1 className="map-title-accessible">{title}</h1>
      <nav className="map-links" aria-label="Work maps">
        {maps.map((map) => (
          <a
            key={map.id}
            href={`?map=${encodeURIComponent(map.id)}`}
            aria-current={map.id === id ? 'page' : undefined}
            onClick={(event) => {
              // A plain click switches in this window (#168); a modified click opens it elsewhere.
              if (!onSwitch || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
              event.preventDefault();
              onSwitch(map.id);
            }}
          >
            {map.title}
          </a>
        ))}
      </nav>
    </>
  );
}
