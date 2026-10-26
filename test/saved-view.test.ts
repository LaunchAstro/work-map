// Each map keeps its own view in this browser (#148): zoom and position, theme, % toggle and tab.
import { describe, expect, it } from 'vitest';
import {
  readSavedView,
  rememberHomeMap,
  savedMapId,
  writeSavedView,
} from '../src/web/saved-view.ts';

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
} as unknown as Storage;

describe('saved view', () => {
  it('keeps each map apart and opens the home theme at the bare address after a switch', () => {
    const storage = memory();
    rememberHomeMap('ops', storage);
    writeSavedView(
      'ops',
      {
        view: { x: -40, y: 12, scale: 1.2 },
        theme: 'dark',
        percentages: false,
        agents: false,
        tab: 'scope',
      },
      storage,
    );
    writeSavedView('agency', { theme: 'light', tab: 'merges' }, storage);
    expect(readSavedView('ops', storage)).toEqual({
      view: { x: -40, y: 12, scale: 1.2 },
      theme: 'dark',
      percentages: false,
      agents: false,
      tab: 'scope',
    });
    expect(readSavedView('agency', storage)).toEqual({ theme: 'light', tab: 'merges' });
    expect(savedMapId('', storage)).toBe('ops');
    expect(savedMapId('?map=ops', storage)).toBe('ops');
  });

  it('drops anything malformed rather than restoring it', () => {
    const storage = memory();
    storage.setItem('work-map:view:ops', '{not json');
    expect(readSavedView('ops', storage)).toEqual({});
    storage.setItem(
      'work-map:view:ops',
      JSON.stringify({ view: { x: 'far', y: 0, scale: -1 }, theme: 'sepia', tab: 'merges' }),
    );
    expect(readSavedView('ops', storage)).toEqual({ tab: 'merges' });
    expect(readSavedView(null, storage)).toEqual({});
  });

  it('renders without storage: blocked reads give nothing and writes are dropped', () => {
    expect(readSavedView('ops', broken)).toEqual({});
    expect(() => writeSavedView('ops', { theme: 'dark' }, broken)).not.toThrow();
    expect(savedMapId('', broken)).toBeNull();
  });

  it('renders when merely reading localStorage throws, as where site data is blocked', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage access denied', 'SecurityError');
      },
    });
    try {
      expect(readSavedView('ops')).toEqual({});
      expect(() => writeSavedView('ops', { theme: 'dark' })).not.toThrow();
      expect(savedMapId('')).toBeNull();
      expect(() => rememberHomeMap('ops')).not.toThrow();
    } finally {
      if (real) Object.defineProperty(globalThis, 'localStorage', real);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
