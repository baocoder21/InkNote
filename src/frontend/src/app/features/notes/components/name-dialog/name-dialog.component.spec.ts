import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { vi } from 'vitest';
import { NameDialogComponent, NameDialogData } from './name-dialog.component';

describe('NameDialogComponent', () => {
  let fixture: ComponentFixture<NameDialogComponent>;
  const close = vi.fn();
  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector<HTMLInputElement>('input')!;
  const saveButton = () => el().querySelector<HTMLButtonElement>('button[type=submit]')!;

  async function open(initialName = '') {
    close.mockClear();
    const data: NameDialogData = { title: 'New tag', initialName, maxLength: 50 };
    await TestBed.configureTestingModule({
      imports: [NameDialogComponent],
      providers: [
        { provide: NZ_MODAL_DATA, useValue: data },
        { provide: NzModalRef, useValue: { close } }, // the real one needs a real modal
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NameDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable(); // ngModel writes its first value asynchronously
    fixture.detectChanges();
  }

  async function type(text: string) {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('starts with the given name (rename) and the length limit', async () => {
    await open('Old name');

    expect(input().value).toBe('Old name');
    expect(input().getAttribute('maxlength')).toBe('50');
    expect(saveButton().disabled).toBe(false);
  });

  it('is ready for typing: the box has the focus and the old name is selected', async () => {
    await open('Old name');
    await new Promise((resolve) => setTimeout(resolve, 20)); // focus is taken one tick after opening

    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe('Old name'.length);
  });

  it('cannot be saved while the name is empty or only spaces', async () => {
    await open();
    expect(saveButton().disabled).toBe(true);

    await type('   ');
    expect(saveButton().disabled).toBe(true);
  });

  it('closes with the trimmed name when saved', async () => {
    await open();

    await type('  Projects  ');
    saveButton().click();

    expect(close).toHaveBeenCalledExactlyOnceWith('Projects');
  });

  it('closes with nothing when cancelled', async () => {
    await open('Keep');

    el().querySelector<HTMLButtonElement>('button[type=button]')!.click();

    expect(close).toHaveBeenCalledExactlyOnceWith();
  });
});
