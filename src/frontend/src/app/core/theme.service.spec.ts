import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { THEME_OPTIONS, ThemeService } from './theme.service';

const html = () => document.documentElement;
const zorroLinks = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-zorro]'));

describe('ThemeService', () => {
  const create = () => TestBed.inject(ThemeService);

  beforeEach(() => {
    localStorage.clear();
    html().removeAttribute('data-theme');
    zorroLinks().forEach((l) => l.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    zorroLinks().forEach((l) => l.remove());
  });

  it('offers Light, Dark and Warm', () => {
    expect(THEME_OPTIONS.map((t) => t.label)).toEqual(['Light', 'Dark', 'Warm']);
  });

  it('starts with the dark theme when nothing was saved, and puts it on <html>', () => {
    const service = create();

    expect(service.theme()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  it('starts with the saved theme', () => {
    localStorage.setItem('inknote.theme', 'warm');

    const service = create();

    expect(service.theme()).toBe('warm');
    expect(html().getAttribute('data-theme')).toBe('warm');
  });

  it('ignores a saved value that is not a theme', () => {
    localStorage.setItem('inknote.theme', 'neon');

    expect(create().theme()).toBe('dark');
  });

  it('set() changes the page, the signal and the saved choice', () => {
    const service = create();

    service.set('light');

    expect(service.theme()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('inknote.theme')).toBe('light');
  });

  it('set() ignores a name that is not a theme', () => {
    const service = create();

    service.set('neon' as never);

    expect(service.theme()).toBe('dark');
    expect(localStorage.getItem('inknote.theme')).toBeNull();
  });

  it('still switches when the browser blocks storage', () => {
    const service = create();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    service.set('warm');

    expect(service.theme()).toBe('warm');
    expect(html().getAttribute('data-theme')).toBe('warm');
  });

  describe('ng-zorro stylesheet', () => {
    it('loads the dark build for dark and the light build for light and warm', () => {
      const service = create();
      expect(zorroLinks().map((l) => l.dataset['zorro'])).toEqual(['dark']);
      expect(zorroLinks()[0].getAttribute('href')).toBe('themes/ng-zorro-antd.dark.min.css');

      service.set('light');
      expect(zorroLinks().map((l) => l.dataset['zorro'])).toEqual(['dark', 'variable']);
      expect(zorroLinks()[1].getAttribute('href')).toBe('themes/ng-zorro-antd.variable.min.css');
    });

    it('removes the old stylesheet only after the new one has loaded (no unstyled flash)', () => {
      const service = create();
      service.set('light');
      const [oldLink, newLink] = zorroLinks();

      expect(oldLink.dataset['zorro']).toBe('dark'); // still there: the new one is loading

      newLink.dispatchEvent(new Event('load'));

      expect(zorroLinks().map((l) => l.dataset['zorro'])).toEqual(['variable']);
    });

    it('puts the new stylesheet right after the old one, so our own styles still come last', () => {
      const ours = document.createElement('link');
      ours.rel = 'stylesheet';
      ours.href = 'styles.css';
      document.head.appendChild(ours);
      const service = create(); // appends the dark link at the end (no index.html script in tests)
      zorroLinks()[0].after(ours); // order now: zorro dark, ours

      service.set('warm');

      const order = Array.from(document.head.querySelectorAll('link[rel=stylesheet]')).map(
        (l) => (l as HTMLLinkElement).dataset['zorro'] ?? 'ours',
      );
      expect(order).toEqual(['dark', 'variable', 'ours']);
      ours.remove();
    });

    it('does not load another stylesheet when going between light and warm (same build)', () => {
      const service = create();
      service.set('light');
      zorroLinks()[1].dispatchEvent(new Event('load'));
      expect(zorroLinks()).toHaveLength(1);

      service.set('warm');

      expect(zorroLinks()).toHaveLength(1);
      expect(zorroLinks()[0].dataset['zorro']).toBe('variable');
    });
  });
});
