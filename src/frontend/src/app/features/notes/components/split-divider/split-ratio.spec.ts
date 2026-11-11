import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, clampRatio, loadSplitRatio, saveSplitRatio } from './split-ratio';

describe('split ratio', () => {
  afterEach(() => localStorage.clear());

  it('keeps a ratio between the minimum and the maximum', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0)).toBe(SPLIT_MIN);
    expect(clampRatio(-3)).toBe(SPLIT_MIN);
    expect(clampRatio(1)).toBe(SPLIT_MAX);
    expect(clampRatio(42)).toBe(SPLIT_MAX);
  });

  it('turns anything that is not a number into the default', () => {
    expect(clampRatio(NaN)).toBe(SPLIT_DEFAULT);
    expect(clampRatio(Infinity)).toBe(SPLIT_DEFAULT);
  });

  it('remembers the choice', () => {
    saveSplitRatio(0.35);

    expect(loadSplitRatio()).toBe(0.35);
  });

  it('gives half and half when nothing was saved', () => {
    expect(loadSplitRatio()).toBe(0.5);
  });

  it('does not trust what is in the storage: text and out-of-range values are fixed', () => {
    localStorage.setItem('inknote.splitRatio', 'wide');
    expect(loadSplitRatio()).toBe(SPLIT_DEFAULT);

    localStorage.setItem('inknote.splitRatio', '0.99');
    expect(loadSplitRatio()).toBe(SPLIT_MAX);
  });

  it('works when the storage is blocked (a private window)', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(loadSplitRatio()).toBe(SPLIT_DEFAULT);
    expect(() => saveSplitRatio(0.4)).not.toThrow();
    vi.restoreAllMocks();
  });
});
