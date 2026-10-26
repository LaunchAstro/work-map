// SPDX-License-Identifier: AGPL-3.0-only
//
// The work map page: polls the map data, owns the shared state (camera, inspection, tooltip, sync)
// and lays out the header, the overview strip, the board and the section callout.
import { currentSeatGauge, seatGaugeExpiry } from '../core/seat-gauge.ts';
import { currentVersions, type VersionsSnapshot } from '../core/versions.ts';
import { currentMapLinks, type MapLink } from '../core/map-links.ts';
import { pendingTicketProgress, ticketCountMap } from '../core/ticket-progress.ts';
import { showTimesIn } from '../core/time.ts';
import type { Tip, TipSource } from './Bar.tsx';
import { transitionInspection } from './interactions.ts';
import { useMapCamera } from './useMapCamera.ts';
import { currentAgents, currentSnapshot } from './snapshot.ts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  type ReactNode,
} from 'react';
import type { AgentsSnapshot, Snapshot } from '../core/contract.ts';
import { unread, usePoll } from './usePoll.ts';
import { drawWires } from './wires.ts';
import { ScopeTooltip } from './ScopeTooltip.tsx';
import { SectionCallout } from './SectionCallout.tsx';
import { readSavedView, rememberHomeMap, savedMapId, writeSavedView } from './saved-view.ts';
import { mapPath } from './map-path.ts';
import { Header } from './Header.tsx';
import { Overview } from './Overview.tsx';
import { Board } from './Board.tsx';
import { useSync } from './Sync.tsx';

const SNAPSHOT_EVERY_MS = 60_000;
const AGENTS_EVERY_MS = 30_000;

export function App(): ReactNode {
  // The map this page showed last, read before its data arrives so the first frame is already right.
  const [opened] = useState(() => {
    const id = savedMapId(globalThis.location?.search ?? '');
    return { id, saved: readSavedView(id) };
  });
  const [showPercentages, setShowPercentages] = useState(opened.saved.percentages ?? true);
  const [showAgents, setShowAgents] = useState(opened.saved.agents ?? true);
  const [theme, setTheme] = useState<'light' | 'dark'>(opened.saved.theme ?? 'light');
  const [statsTab, setStatsTab] = useState<'scope' | 'merges'>(opened.saved.tab ?? 'merges');
  // The map this window shows is the address's `?map=` (#168); switching changes it in place.
  const [search, setSearch] = useState(() => globalThis.location?.search ?? '');
  useEffect(() => {
    const follow = (): void => setSearch(globalThis.location.search);
    globalThis.addEventListener('popstate', follow);
    return () => globalThis.removeEventListener('popstate', follow);
  }, []);
  const [, setNow] = useState(Date.now);
  const now = Date.now();
  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const maps = usePoll<readonly MapLink[]>('/data/maps.json', SNAPSHOT_EVERY_MS, currentMapLinks);
  const snap = usePoll<Snapshot>(
    mapPath('/data/snapshot.json', search),
    SNAPSHOT_EVERY_MS,
    currentSnapshot,
    true,
  );
  // Before anything below formats a time: the map's own zone and locale, not the viewer's.
  showTimesIn(snap.data?.display);
  const versions = usePoll<VersionsSnapshot>(
    mapPath('/data/versions.json', search),
    SNAPSHOT_EVERY_MS,
    currentVersions,
  );
  const agentsRead = usePoll<AgentsSnapshot>(
    mapPath('/data/agents.json', search),
    AGENTS_EVERY_MS,
    currentAgents,
  );
  // Agents are read for the map in the address. Until that map's own snapshot is painted they
  // belong to another map's board, so they show as not yet read (#184).
  const painted = snap.source === mapPath('/data/snapshot.json', search);
  const agents = painted ? agentsRead : unread(agentsRead);

  const [inspection, dispatch] = useReducer(transitionInspection, { hovered: null, pinned: null });
  const inspected = inspection.pinned?.id ?? inspection.hovered;
  const open = inspection.pinned?.id ?? null;
  const [tip, setTip] = useState<Tip | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const clearNavigation = useCallback((): void => {
    setTip(null);
    dispatch({ type: 'clearHover' });
  }, []);
  const mapId = snap.data?.id;
  useEffect(() => {
    if (snap.current && mapId && !new URLSearchParams(search).get('map')) rememberHomeMap(mapId);
  }, [snap.current, mapId, search]);
  const savedView = useMemo(() => readSavedView(mapId), [mapId]);
  // The map whose own theme, % toggle and tab are in force; until then nothing is saved for it.
  const [shownMap, setShownMap] = useState<string | null>(null);
  useEffect(() => {
    if (!mapId || mapId === shownMap) return;
    // The map read at start already has its own; any other map (or a switch) brings its own.
    if (shownMap !== null || mapId !== opened.id) {
      setShowPercentages(savedView.percentages ?? true);
      setShowAgents(savedView.agents ?? true);
      setTheme(savedView.theme ?? 'light');
      setStatsTab(savedView.tab ?? 'merges');
    }
    setShownMap(mapId);
  }, [mapId, shownMap, opened.id, savedView]);
  useLayoutEffect(() => {
    // Mirrors the theme onto <html>, where index.html sets it before the first paint.
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  const camera = useMapCamera(
    board,
    snap.data?.stages.length ?? 0,
    clearNavigation,
    savedView.view ?? null,
    mapId,
  );
  const { atHome, view: cameraView, zoom: cameraZoom } = camera;
  useEffect(() => {
    // Written straight away, not debounced: a switch right after a change must not lose it.
    if (!mapId || mapId !== shownMap || cameraZoom === null) return;
    writeSavedView(mapId, {
      view: atHome ? undefined : cameraView,
      theme,
      percentages: showPercentages,
      agents: showAgents,
      tab: statsTab,
    });
  }, [
    mapId,
    shownMap,
    atHome,
    cameraView,
    cameraZoom,
    theme,
    showPercentages,
    showAgents,
    statsTab,
  ]);
  const { ref, view, dragging, moved, gesturing } = camera;
  // The picker switches in this window: the address gains `?map=`, the open map stays painted until
  // the chosen map's data arrives, and that map's own saved view comes back.
  const switchMap = (id: string): void => {
    if (id === new URLSearchParams(search).get('map')) return;
    dispatch({ type: 'close' });
    globalThis.history.pushState(null, '', `?map=${encodeURIComponent(id)}`);
    setSearch(globalThis.location.search);
  };
  const close = useCallback(
    (restore = true): void => {
      if (restore && inspection.pinned?.activation === 'keyboard')
        board.current
          ?.querySelector<HTMLElement>(`#n-${CSS.escape(inspection.pinned.id)}`)
          ?.focus();
      dispatch({ type: 'close' });
    },
    [inspection.pinned],
  );
  const enter = (id: string): void => {
    if (!gesturing()) dispatch({ type: 'enter', id });
  };
  const leave = (id: string): void => dispatch({ type: 'leave', id });
  const showTip = (next: Tip): void => {
    if (!gesturing()) setTip(next);
  };
  const hideTip = (anchor: HTMLElement, source: TipSource): void => {
    setTip((current) => (current?.anchor === anchor && current.source === source ? null : current));
  };
  const [showUnmapped, setShowUnmapped] = useState(false);
  const svg = useRef<SVGSVGElement | null>(null);
  const labels = useRef<HTMLDivElement | null>(null);
  const s = snap.data;
  const tickets = ticketCountMap(s) ? (s?.ticketProgress ?? pendingTicketProgress()) : undefined;
  const visibleWires =
    s?.view.wires.filter((w) => w.kind !== 'blocked' || w.to[0] === inspected) ?? [];

  useEffect(() => {
    let pressedInside = false;
    const inside = (target: EventTarget | null): boolean => {
      if (!open || !(target instanceof Node)) return false;
      const anchor = board.current?.querySelector(`#n-${CSS.escape(open)}`);
      const popup = ref.current?.querySelector('.callout');
      return Boolean(anchor?.contains(target) || popup?.contains(target));
    };
    const press = (e: PointerEvent): void => {
      pressedInside = inside(e.target);
    };
    const outside = (e: MouseEvent): void => {
      if (!open || (e.detail !== 0 && (moved() || pressedInside)) || inside(e.target)) return;
      close(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setTip(null);
        close();
      }
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('click', outside, true);
    globalThis.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('click', outside, true);
      globalThis.removeEventListener('keydown', key);
    };
  }, [open, close, ref, moved]);

  useEffect(() => {
    if (dragging) clearNavigation();
  }, [dragging, clearNavigation]);
  useEffect(() => {
    if (!tip) return;
    const clearDetached = (): void => {
      if (!tip.anchor.isConnected) setTip(null);
    };
    const observer = new MutationObserver(clearDetached);
    if (board.current) observer.observe(board.current, { childList: true, subtree: true });
    clearDetached();
    return () => observer.disconnect();
  }, [tip]);
  useEffect(() => {
    if (open && s && !s.stages.some((st) => st.nodes.some((n) => n.id === open))) close(false);
  }, [s, open, close]);

  useLayoutEffect(() => {
    const bEl = board.current;
    const sEl = svg.current;
    const labelEl = labels.current;
    if (!s || !bEl || !sEl || !labelEl) return;
    let live = true;
    const draw = (): void => {
      if (live) drawWires(bEl, sEl, visibleWires, view.scale, labelEl, inspected);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(bEl);
    void document.fonts.ready.then(draw);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [s, agents.data, inspected, view.scale]);

  const a = agents.data;
  const seatGauge = s ? currentSeatGauge(a?.seatGauge, s.id, now, agents.failed !== null) : null;
  useEffect(() => {
    const report = a?.seatGauge;
    if (!report) return;
    const expiry = seatGaugeExpiry(report, now);
    if (expiry === null) return;
    const timer = setTimeout(() => setNow(Date.now()), expiry - now);
    return () => clearTimeout(timer);
  }, [a?.seatGauge, now]);
  const activate = (id: string, activation: 'pointer' | 'keyboard'): void => {
    if (moved() && activation === 'pointer') return;
    setTip(null);
    dispatch({ type: 'activate', id, activation });
  };
  const related = new Set(
    visibleWires
      .filter((wire) => wire.from[0] === inspected || wire.to[0] === inspected)
      .flatMap((wire) => [String(wire.from[0]), String(wire.to[0])]),
  );
  const { syncState, syncMap } = useSync(snap, agentsRead, versions, search, snap.current);
  const openNode = open
    ? s?.stages.flatMap((st) => st.nodes).find((x) => x.id === open)
    : undefined;
  const openAnchor = open
    ? board.current?.querySelector<HTMLElement>(`#n-${CSS.escape(open)}`)
    : undefined;

  return (
    <div
      className="app"
      data-theme={theme}
      data-percentages={showPercentages ? 'shown' : 'hidden'}
      data-agents={showAgents ? 'shown' : 'hidden'}
    >
      <Header
        maps={maps}
        switchMap={switchMap}
        s={s}
        a={a}
        snapFailed={snap.failed}
        versions={versions}
        tickets={tickets}
        seatGauge={seatGauge}
        now={now}
        camera={camera}
        showPercentages={showPercentages}
        setShowPercentages={setShowPercentages}
        showAgents={showAgents}
        setShowAgents={setShowAgents}
        theme={theme}
        setTheme={setTheme}
        syncState={syncState}
        syncMap={syncMap}
      />
      {s ? (
        <Overview
          s={s}
          tickets={tickets}
          snapFailed={snap.failed}
          now={now}
          statsTab={statsTab}
          setStatsTab={setStatsTab}
          setTip={setTip}
          tip={tip}
          showTip={showTip}
          hideTip={hideTip}
          showUnmapped={showUnmapped}
          setShowUnmapped={setShowUnmapped}
        />
      ) : null}
      <div
        className={`viewport${dragging ? ' dragging' : ''}`}
        ref={ref}
        tabIndex={-1}
        onPointerLeave={clearNavigation}
        onWheel={(e) => {
          if (!(e.target as HTMLElement).closest('.callout')) clearNavigation();
        }}
      >
        {s ? (
          <Board
            s={s}
            board={board}
            svg={svg}
            labels={labels}
            view={view}
            inspected={inspected}
            open={open}
            related={related}
            activate={activate}
            enter={enter}
            leave={leave}
            tip={tip}
            showTip={showTip}
            hideTip={hideTip}
            tickets={tickets}
            snapFailed={snap.failed}
            now={now}
            seatGauge={seatGauge}
          />
        ) : (
          <p className="loading" role="status">
            {snap.failed ? 'Awaiting updated work-map data…' : 'Loading work map…'}
          </p>
        )}
        {s && openNode && openAnchor && ref.current ? (
          <SectionCallout
            key={openNode.id}
            n={openNode}
            snapshot={s}
            snapshotFailed={snap.failed !== null}
            anchor={openAnchor}
            viewport={ref.current}
            view={view}
            close={() => close()}
            keyboard={inspection.pinned?.activation === 'keyboard'}
            ticketFailed={snap.failed !== null}
            now={now}
          />
        ) : null}
        {tip && tip.anchor.isConnected && ref.current ? (
          <ScopeTooltip
            tip={tip}
            text={tip.text}
            viewport={
              // Header anchors (merge hours, project bars) sit above the map viewport.
              ref.current.contains(tip.anchor)
                ? ref.current
                : (ref.current.parentElement ?? ref.current)
            }
            view={view}
          />
        ) : null}
      </div>
    </div>
  );
}
