import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  GUTTER,
  clampView,
  homeView,
  sameGeometry,
  readout,
  startsPan,
  stepZoom,
  wheelPixels,
  zoomTo,
  type Geometry,
} from './camera.ts';
import type { View } from './words.ts';

type MapCamera = {
  ref: RefObject<HTMLDivElement | null>;
  view: View;
  /** Zoom as a whole percentage of 100% (four columns across), or null before measuring. */
  zoom: number | null;
  /** At the home view, which follows the window size, rather than a place the viewer chose. */
  atHome: boolean;
  dragging: boolean;
  moved: () => boolean;
  gesturing: () => boolean;
  home: () => void;
  /** + (1) or − (−1): the next whole ten of the readout. */
  zoomStep: (direction: 1 | -1) => void;
};
type State = { view: View; home: boolean };
const START: State = { view: { x: 0, y: 0, scale: 1 }, home: true };

/** Safari's trackpad pinch: non-standard GestureEvent with a cumulative scale. */
type GestureLike = Event & { scale: number; clientX: number; clientY: number };

export function useMapCamera(
  board: RefObject<HTMLDivElement | null>,
  stageCount: number,
  onNavigate: () => void,
  /** A view saved for this map, restored (within the limits) on the first measure instead of home. */
  saved: View | null = null,
  /** The map shown: when it changes the camera starts again, at that map's saved view or home. */
  restoreKey?: string | undefined,
): MapCamera {
  const ref = useRef<HTMLDivElement | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const keyRef = useRef(restoreKey);
  const [state, setState] = useState<State>(START);
  const stateRef = useRef(state);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(
    null,
  );
  const lastMoved = useRef(false);
  const change = useCallback((update: (current: State, g: Geometry) => State): void => {
    const g = geometryRef.current;
    if (!g) return;
    const next = update(stateRef.current, g);
    stateRef.current = next;
    setState(next);
  }, []);
  const end = useCallback((): void => {
    if (drag.current) lastMoved.current = drag.current.moved;
    drag.current = null;
    setDragging(false);
  }, []);
  useLayoutEffect(() => {
    const b = board.current,
      vp = ref.current;
    if (!b || !vp || stageCount < 1) return;
    if (keyRef.current !== restoreKey) {
      keyRef.current = restoreKey;
      geometryRef.current = null;
    }
    let live = true;
    const measure = (): void => {
      if (!live) return;
      const bounds = b.getBoundingClientRect(),
        scale = stateRef.current.view.scale;
      const local = (el: Element): DOMRect => {
        const r = el.getBoundingClientRect();
        return new DOMRect(
          (r.left - bounds.left) / scale,
          (r.top - bounds.top) / scale,
          r.width / scale,
          r.height / scale,
        );
      };
      const stages = Array.from(b.querySelectorAll('.stage'))
        .map(local)
        .map((r) => ({ left: r.left, right: r.right, top: r.top }))
        .toSorted((a, z) => a.left - z.left);
      const first = stages[0];
      if (!first || vp.clientWidth <= 24 || vp.clientHeight <= 24) return;
      const bottom = Math.max(
        first.top,
        ...Array.from(b.querySelectorAll('.node')).map((el) => local(el).bottom),
      );
      const g: Geometry = {
        width: vp.clientWidth,
        height: vp.clientHeight,
        boardWidth: b.offsetWidth,
        boardHeight: b.offsetHeight,
        content: {
          left: first.left,
          top: Math.min(...stages.map((s) => s.top)),
          right: Math.max(...stages.map((s) => s.right)),
          bottom,
        },
        stages,
      };
      const old = geometryRef.current;
      if (old && sameGeometry(old, g)) return;
      geometryRef.current = g;
      setGeometry(g);
      const restore = old ? null : savedRef.current;
      change((current, next) =>
        restore
          ? {
              view: zoomTo(restore, restore.scale, next.width / 2, next.height / 2, next),
              home: false,
            }
          : !old || current.home
            ? { view: homeView(next), home: true }
            : {
                ...current,
                // Re-apply the zoom limits too: they change with the window size.
                view: zoomTo(
                  current.view,
                  current.view.scale,
                  next.width / 2,
                  next.height / 2,
                  next,
                ),
              },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(b);
    observer.observe(vp);
    for (const el of b.querySelectorAll('.stage, .node')) observer.observe(el);
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [board, stageCount, change, restoreKey]);
  const zoomAround = useCallback(
    (factor: number, cx?: number, cy?: number): void => {
      const el = ref.current;
      if (!el) return;
      onNavigate();
      change((c, g) => ({
        home: false,
        view: zoomTo(
          c.view,
          c.view.scale * factor,
          cx ?? el.clientWidth / 2,
          cy ?? el.clientHeight / 2,
          g,
        ),
      }));
    },
    [change, onNavigate],
  );
  const zoomStep = useCallback(
    (direction: 1 | -1): void => {
      const el = ref.current;
      if (!el) return;
      onNavigate();
      change((c, g) => ({
        home: false,
        view: stepZoom(c.view, direction, el.clientWidth / 2, el.clientHeight / 2, g),
      }));
    },
    [change, onNavigate],
  );
  const home = useCallback((): void => {
    // Clear any native scroll first, so a scroll event still queued can't move the view off home.
    if (ref.current) {
      ref.current.scrollLeft = 0;
      ref.current.scrollTop = 0;
    }
    onNavigate();
    change((_, g) => ({ view: homeView(g), home: true }));
  }, [change, onNavigate]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pan = (dx: number, dy: number): void =>
      change((c, g) => ({
        home: false,
        view: clampView({ ...c.view, x: c.view.x + dx, y: c.view.y + dy }, g),
      }));
    const wheel = (e: WheelEvent): void => {
      if ((e.target as Element).closest('.callout')) return;
      e.preventDefault();
      const g = geometryRef.current;
      if (!g) return;
      const r = el.getBoundingClientRect();
      // A trackpad pinch arrives as ctrl+wheel in Chrome; ⌘+wheel zooms for a mouse.
      if (e.ctrlKey || e.metaKey) {
        zoomAround(
          Math.exp(-wheelPixels(e.deltaY, e.deltaMode, g.height) * 0.01),
          e.clientX - r.left,
          e.clientY - r.top,
        );
        return;
      }
      onNavigate();
      const x = wheelPixels(e.deltaX, e.deltaMode, g.width),
        y = wheelPixels(e.deltaY, e.deltaMode, g.height);
      pan(e.shiftKey && !x ? -y : -x, e.shiftKey && !x ? 0 : -y);
    };
    let pinch = 1;
    const gestureStart = (e: Event): void => {
      e.preventDefault();
      pinch = 1;
    };
    const gestureChange = (e: Event): void => {
      e.preventDefault();
      const ge = e as GestureLike;
      const r = el.getBoundingClientRect();
      zoomAround(ge.scale / pinch, ge.clientX - r.left, ge.clientY - r.top);
      pinch = ge.scale;
    };
    const reset = (): void => {
      lastMoved.current = false;
    };
    // The camera is the only offset: native scroll (focus scrolls even a clipping viewport) is
    // always zeroed, never turned into a pan, so a late scroll event can't move the view.
    const nativeScroll = (): void => {
      if (el.scrollLeft) el.scrollLeft = 0;
      if (el.scrollTop) el.scrollTop = 0;
    };
    // Keyboard focus on an off-screen card pans the camera just far enough to show it.
    // Only keyboard focus reveals: a mouse press focuses the card too, and moving it then would
    // pull it from under the pointer before the click lands.
    let pointerFocus = false;
    const pointerDown = (): void => {
      pointerFocus = true;
    };
    const keyDown = (): void => {
      pointerFocus = false;
    };
    const reveal = (e: FocusEvent): void => {
      const card = (e.target as Element).closest('.node');
      if (!card || pointerFocus) return;
      // Where the card sits by the camera alone: add back any native scroll still pending reset.
      const box = card.getBoundingClientRect(),
        v = el.getBoundingClientRect();
      const r = {
        left: box.left + el.scrollLeft,
        right: box.right + el.scrollLeft,
        top: box.top + el.scrollTop,
        bottom: box.bottom + el.scrollTop,
      };
      const dx =
        r.left < v.left + GUTTER
          ? v.left + GUTTER - r.left
          : r.right > v.right - GUTTER
            ? Math.max(v.left + GUTTER - r.left, v.right - GUTTER - r.right)
            : 0;
      const dy =
        r.top < v.top + GUTTER
          ? v.top + GUTTER - r.top
          : r.bottom > v.bottom - GUTTER
            ? Math.max(v.top + GUTTER - r.top, v.bottom - GUTTER - r.bottom)
            : 0;
      if (dx || dy) pan(dx, dy);
    };
    const down = (e: PointerEvent): void => {
      const target = e.target as Element;
      if (e.button !== 0 || !startsPan(target)) return;
      // Cards, links and buttons keep their press so they still take focus and a click still lands;
      // the board's CSS stops the drag selecting text or dragging a link out.
      if (!target.closest('.node,a,button')) e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    };
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) {
        setDragging(true);
        onNavigate();
      }
      d.moved = true;
      pan(dx - d.dx, dy - d.dy);
      d.dx = dx;
      d.dy = dy;
    };
    const key = (e: KeyboardEvent): void => {
      const target = e.target as Element;
      if (target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '0') {
        e.preventDefault();
        home();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomStep(1);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep(-1);
      }
    };
    // A drag that started on a link or button ends in a pointer click on it: swallow that one
    // click. Keyboard activation (detail 0) is never a drag's end.
    const afterDrag = (e: MouseEvent): void => {
      if (e.detail === 0 || !lastMoved.current || !(e.target as Element).closest('a,button'))
        return;
      lastMoved.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const noNativeDrag = (e: DragEvent): void => e.preventDefault();
    document.addEventListener('pointerdown', reset, true);
    el.addEventListener('click', afterDrag, true);
    el.addEventListener('dragstart', noNativeDrag);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', nativeScroll);
    el.addEventListener('focusin', reveal);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown, true);
    el.addEventListener('gesturestart', gestureStart);
    el.addEventListener('gesturechange', gestureChange);
    el.addEventListener('pointerdown', down);
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', end);
    globalThis.addEventListener('pointercancel', end);
    globalThis.addEventListener('keydown', key);
    globalThis.addEventListener('blur', end);
    return () => {
      document.removeEventListener('pointerdown', reset, true);
      el.removeEventListener('click', afterDrag, true);
      el.removeEventListener('dragstart', noNativeDrag);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('scroll', nativeScroll);
      el.removeEventListener('focusin', reveal);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('keydown', keyDown, true);
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
      el.removeEventListener('pointerdown', down);
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', end);
      globalThis.removeEventListener('pointercancel', end);
      globalThis.removeEventListener('keydown', key);
      globalThis.removeEventListener('blur', end);
    };
  }, [change, end, home, onNavigate, zoomAround, zoomStep]);
  const moved = useCallback((): boolean => drag.current?.moved ?? lastMoved.current, []);
  const gesturing = useCallback((): boolean => drag.current !== null, []);
  return {
    ref,
    view: state.view,
    zoom: geometry ? readout(state.view, geometry) : null,
    atHome: state.home,
    dragging,
    moved,
    gesturing,
    home,
    zoomStep,
  };
}
