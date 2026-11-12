import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark' | 'warm';

/** The themes offered to the user. `swatch` is the background color shown in the picker. */
export const THEME_OPTIONS: readonly { id: ThemeName; label: string; swatch: string }[] = [
  { id: 'light', label: 'Light', swatch: '#edeeec' },
  { id: 'dark', label: 'Dark', swatch: '#181616' },
  { id: 'warm', label: 'Warm', swatch: '#f1e9d2' },
];

// Same key and default as the small script in index.html (which runs before Angular starts).
const STORAGE_KEY = 'inknote.theme';
const DEFAULT_THEME: ThemeName = 'dark';

function isThemeName(value: unknown): value is ThemeName {
  return THEME_OPTIONS.some((t) => t.id === value);
}

/**
 * The current theme. Switching does three things:
 *  1. sets <html data-theme="..."> : our design tokens (--ink-*) are defined per theme in
 *     styles/_tokens.scss, so every component changes color at once;
 *  2. swaps the ng-zorro stylesheet: it comes in a dark build and a light build and they
 *     cannot be loaded together ("dark" uses the dark one, "light" and "warm" the light one);
 *  3. remembers the choice in localStorage (guarded: storage can be blocked).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<ThemeName>(this.saved() ?? DEFAULT_THEME);

  constructor() {
    // Normally index.html already did this; it matters when that script did not run (tests).
    this.apply(this.theme());
  }

  set(theme: ThemeName): void {
    if (!isThemeName(theme)) {
      return;
    }
    // The page changes FIRST, then the signal: anything that reacts to the signal (for example
    // the Mermaid diagrams, which read the CSS colors) already sees the new colors.
    this.apply(theme);
    this.theme.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* not remembered, nothing else to do */
    }
  }

  private saved(): ThemeName | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return isThemeName(value) ? value : null;
    } catch {
      return null;
    }
  }

  private apply(theme: ThemeName): void {
    this.document.documentElement.setAttribute('data-theme', theme);

    // The title bar of the installed app takes the color of the page (see index.html, which sets it first).
    const background = THEME_OPTIONS.find((t) => t.id === theme)?.swatch;
    if (background) {
      this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    }

    const file = theme === 'dark' ? 'dark' : 'variable';
    const current = this.document.querySelector<HTMLLinkElement>('link[data-zorro]');
    if (current?.dataset['zorro'] === file) {
      return; // light <-> warm: same ng-zorro build, only our tokens change
    }
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `themes/ng-zorro-antd.${file}.min.css`;
    link.dataset['zorro'] = file;
    // Remove the old stylesheet only once the new one is ready, so the page does not flash unstyled.
    link.addEventListener('load', () => current?.remove(), { once: true });
    // It goes right after the old one, i.e. BEFORE our own styles.css: at equal weight the later
    // stylesheet wins, and our overrides (styles/_zorro-overrides.scss) must win over ng-zorro's.
    if (current) {
      current.after(link);
    } else {
      this.document.head.appendChild(link);
    }
  }
}
