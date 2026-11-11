import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitDividerComponent } from './split-divider.component';

@Component({
  imports: [SplitDividerComponent],
  template: `<div class="grid"><app-split-divider [(ratio)]="ratio" (committed)="committed.push($event)" /></div>`,
})
class HostComponent {
  readonly ratio = signal(0.5);
  readonly committed: number[] = [];
}

describe('SplitDividerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let divider: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    divider = fixture.nativeElement.querySelector('app-split-divider') as HTMLElement;
    // jsdom has no layout: the grid is 1000 px wide and starts at x = 100.
    (divider.parentElement as HTMLElement).getBoundingClientRect = () => ({ left: 100, width: 1000, top: 0, height: 500, right: 1100, bottom: 500, x: 100, y: 0, toJSON: () => ({}) });
  });

  const fire = (type: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    divider.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  const key = (k: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
    divider.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  it('is a vertical separator that screen readers can read, with its value and limits', () => {
    expect(divider.getAttribute('role')).toBe('separator');
    expect(divider.getAttribute('aria-orientation')).toBe('vertical');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(divider.getAttribute('aria-valuemin')).toBe('20');
    expect(divider.getAttribute('aria-valuemax')).toBe('80');
    expect(divider.getAttribute('tabindex')).toBe('0');
  });

  describe('dragging', () => {
    it('follows the pointer while it is down, and tells the parent only when it is let go', () => {
      fire('pointerdown', { clientX: 600 });
      expect(divider.classList).toContain('dragging');

      fire('pointermove', { clientX: 400 }); // (400 - 100) / 1000
      expect(host.ratio()).toBeCloseTo(0.3);
      expect(divider.getAttribute('aria-valuenow')).toBe('30');
      expect(host.committed).toEqual([]); // still dragging: nothing to remember yet

      fire('pointerup', { clientX: 400 });
      expect(host.committed).toHaveLength(1);
      expect(host.committed[0]).toBeCloseTo(0.3);
      expect(divider.classList).not.toContain('dragging');
    });

    it('never goes beyond the limits', () => {
      fire('pointerdown');

      fire('pointermove', { clientX: -500 });
      expect(host.ratio()).toBe(0.2);

      fire('pointermove', { clientX: 5000 });
      expect(host.ratio()).toBe(0.8);
    });

    it('ignores a pointer that moves without being pressed on the divider, and the other mouse buttons', () => {
      fire('pointermove', { clientX: 300 });
      expect(host.ratio()).toBe(0.5);

      fire('pointerdown', { button: 2 });
      fire('pointermove', { clientX: 300 });
      expect(host.ratio()).toBe(0.5);
      expect(divider.classList).not.toContain('dragging');
    });

    it('stops following after the pointer is let go', () => {
      fire('pointerdown');
      fire('pointerup');
      host.committed.length = 0;

      fire('pointermove', { clientX: 300 });

      expect(host.ratio()).toBe(0.5);
      expect(host.committed).toEqual([]);
    });

    it('a cancelled gesture ends the drag like a release', () => {
      fire('pointerdown');
      fire('pointermove', { clientX: 400 });

      fire('pointercancel');

      expect(divider.classList).not.toContain('dragging');
      expect(host.committed).toHaveLength(1);
    });
  });

  describe('keyboard', () => {
    it('the arrow keys move it by 2% (10% with Shift) and each step is remembered', () => {
      key('ArrowRight');
      expect(host.ratio()).toBeCloseTo(0.52);

      key('ArrowLeft', true);
      expect(host.ratio()).toBeCloseTo(0.42);
      expect(host.committed).toHaveLength(2);
    });

    it('Home and End go to the limits, Enter goes back to half and half', () => {
      key('Home');
      expect(host.ratio()).toBe(0.2);
      key('End');
      expect(host.ratio()).toBe(0.8);
      key('Enter');
      expect(host.ratio()).toBe(0.5);
    });

    it('stops at the limits and leaves other keys alone', () => {
      host.ratio.set(0.8);
      fixture.detectChanges();

      key('ArrowRight');
      expect(host.ratio()).toBe(0.8);

      const other = key('a');
      expect(other.defaultPrevented).toBe(false);
      expect(key('ArrowLeft').defaultPrevented).toBe(true); // the keys it uses do not also scroll the page
    });
  });

  it('a double click goes back to half and half', () => {
    host.ratio.set(0.3);
    fixture.detectChanges();

    fire('dblclick');

    expect(host.ratio()).toBe(0.5);
    expect(host.committed).toEqual([0.5]);
  });
});
