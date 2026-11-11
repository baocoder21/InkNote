import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { provideUi } from '../../core/ui.providers';
import { ExportResult, ExportService } from './export.service';
import { ImportReport, ImportService } from './import.service';
import { TransferPageComponent } from './transfer-page.component';

const emptyReport = (over: Partial<ImportReport> = {}): ImportReport => ({ notes: 0, notebooksCreated: 0, tagsCreated: 0, attachments: 0, skipped: [], unusedFiles: 0, ...over });
const exported = (over: Partial<ExportResult> = {}): ExportResult => ({
  blob: new Blob(['zip']),
  fileName: 'inknote-export-2026-03-04.zip',
  notes: 3,
  attachments: 0,
  missingAttachments: 0,
  ...over,
});

describe('TransferPageComponent', () => {
  let fixture: ComponentFixture<TransferPageComponent>;
  let exportAll: ReturnType<typeof vi.fn>;
  let importFiles: ReturnType<typeof vi.fn>;
  let saved: { href: string; download: string }[];

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const exportButton = () => Array.from(el().querySelectorAll('button')).find((b) => b.textContent!.includes('Export all notes'))!;
  const fileInput = () => el().querySelector<HTMLInputElement>('input[type=file]')!;
  const choose = async (...files: File[]) => {
    Object.defineProperty(fileInput(), 'files', { value: files, configurable: true });
    fileInput().dispatchEvent(new Event('change'));
    await settle();
  };

  beforeEach(async () => {
    exportAll = vi.fn(async () => exported());
    importFiles = vi.fn(async () => emptyReport({ notes: 2 }));
    saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.href, download: this.download });
    });
    await TestBed.configureTestingModule({
      imports: [TransferPageComponent],
      providers: [provideUi(), { provide: ExportService, useValue: { exportAll } }, { provide: ImportService, useValue: { importFiles } }],
    }).compileComponents();
    fixture = TestBed.createComponent(TransferPageComponent);
    await settle();
  });

  describe('export', () => {
    it('saves the zip under its own name and says what it contained', async () => {
      exportButton().click();
      await settle();

      expect(exportAll).toHaveBeenCalledTimes(1);
      expect(saved).toEqual([{ href: 'blob:fake', download: 'inknote-export-2026-03-04.zip' }]);
      expect(el().textContent).toContain('Saved "inknote-export-2026-03-04.zip": 3 notes');
    });

    it('says "note" and "file" in the singular', async () => {
      exportAll.mockResolvedValue(exported({ notes: 1, attachments: 1 }));

      exportButton().click();
      await settle();

      expect(el().textContent).toContain('1 note and 1 file');
    });

    it('warns when files could not be included, and says what that means', async () => {
      exportAll.mockResolvedValue(exported({ missingAttachments: 2 }));

      exportButton().click();
      await settle();

      expect(el().querySelector('.result--warning')!.textContent).toContain('2 files are not on this device');
      expect(el().querySelector('.result--warning')!.textContent).toContain('Export again when you are online');
    });

    it('is disabled while it works, so it cannot be started twice', async () => {
      let finish!: (value: ExportResult) => void;
      exportAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));

      exportButton().click();
      await settle();
      expect(exportButton().disabled).toBe(true);

      finish(exported());
      await settle();
      expect(exportButton().disabled).toBe(false);
    });

    it('tells the user when it fails, and saves nothing', async () => {
      const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');
      exportAll.mockRejectedValue(new Error('boom'));

      exportButton().click();
      await settle();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('export failed'));
      expect(saved).toEqual([]);
      expect(exportButton().disabled).toBe(false);
    });
  });

  describe('import', () => {
    it('accepts Markdown files and zips, several at once', () => {
      expect(fileInput().multiple).toBe(true);
      expect(fileInput().accept).toContain('.md');
      expect(fileInput().accept).toContain('.zip');
    });

    it('gives the chosen files to the importer and reports what came in', async () => {
      const success = vi.spyOn(TestBed.inject(NzMessageService), 'success');
      importFiles.mockResolvedValue(emptyReport({ notes: 5, notebooksCreated: 2, tagsCreated: 1, attachments: 3 }));
      const files = [new File(['a'], 'a.md'), new File(['b'], 'b.zip')];

      await choose(...files);

      expect(importFiles).toHaveBeenCalledWith(files);
      expect(el().textContent).toContain('Imported 5 notes.');
      expect(el().textContent).toContain('Created 2 notebooks, 1 tag, and attached 3 files.');
      expect(success).toHaveBeenCalledWith('Imported 5 notes');
    });

    it('lists everything that was left out, with the reason: nothing disappears silently', async () => {
      importFiles.mockResolvedValue(emptyReport({ notes: 1, skipped: [{ name: 'report.docx', reason: 'only .md files' }, { name: 'x.zip: big.md', reason: 'it is larger than 20 MB' }], unusedFiles: 2 }));

      await choose(new File(['a'], 'a.md'));

      const warning = el().querySelector('.result--warning')!;
      expect(warning.textContent).toContain('Left out (2)');
      expect(warning.textContent).toContain('report.docx: only .md files');
      expect(warning.textContent).toContain('x.zip: big.md: it is larger than 20 MB');
      expect(el().textContent).toContain('2 files in the zip were not used');
    });

    it('says plainly when nothing was imported', async () => {
      importFiles.mockResolvedValue(emptyReport({ skipped: [{ name: 'a.docx', reason: 'only .md' }] }));

      await choose(new File(['a'], 'a.docx'));

      expect(el().textContent).toContain('No notes were imported.');
    });

    it('forgets the previous report when new files are chosen', async () => {
      await choose(new File(['a'], 'a.md'));
      expect(el().textContent).toContain('Imported 2 notes.');
      importFiles.mockImplementation(() => new Promise(() => undefined)); // never answers

      await choose(new File(['b'], 'b.md'));

      expect(el().textContent).not.toContain('Imported 2 notes.');
    });

    it('does nothing when no file was chosen', async () => {
      await choose();

      expect(importFiles).not.toHaveBeenCalled();
    });

    it('empties the field afterwards, so that the same file can be chosen again', async () => {
      await choose(new File(['a'], 'a.md'));

      expect(fileInput().value).toBe('');
    });

    it('is disabled while it works', async () => {
      let finish!: (value: ImportReport) => void;
      importFiles.mockReturnValue(new Promise((resolve) => (finish = resolve)));

      await choose(new File(['a'], 'a.md'));
      expect(fileInput().disabled).toBe(true);

      finish(emptyReport({ notes: 1 }));
      await settle();
      expect(fileInput().disabled).toBe(false);
    });

    it('tells the user when it fails', async () => {
      const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');
      importFiles.mockRejectedValue(new Error('boom'));

      await choose(new File(['a'], 'a.md'));

      expect(error).toHaveBeenCalledWith(expect.stringContaining('import failed'));
      expect(fileInput().disabled).toBe(false);
    });
  });
});
