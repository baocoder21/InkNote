import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { downloadBlob } from './download';
import { ExportResult, ExportService } from './export.service';
import { ImportReport, ImportService } from './import.service';

/**
 * Import & export (route /notes/transfer): all the notes out as a zip of Markdown files, and Markdown files or zips in.
 * Both work on the data of THIS device, so they also work offline (a file that was never opened on this device is the
 * one exception when exporting).
 */
@Component({
  selector: 'app-transfer-page',
  imports: [NzButtonComponent, NzIconDirective, NzSpinComponent],
  templateUrl: './transfer-page.component.html',
  styleUrl: './transfer-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransferPageComponent {
  private readonly exporter = inject(ExportService);
  private readonly importer = inject(ImportService);
  private readonly message = inject(NzMessageService);

  protected readonly exporting = signal(false);
  protected readonly exported = signal<ExportResult | null>(null);
  protected readonly importing = signal(false);
  protected readonly report = signal<ImportReport | null>(null);

  /** "Saved \"x.zip\": 3 notes and 2 files." Built here, not in the template, so no stray space ends up before the full stop. */
  protected exportSummary(result: ExportResult): string {
    const notes = `${result.notes} ${result.notes === 1 ? 'note' : 'notes'}`;
    const files = result.attachments > 0 ? ` and ${result.attachments} ${result.attachments === 1 ? 'file' : 'files'}` : '';
    return `Saved "${result.fileName}": ${notes}${files}.`;
  }

  protected async exportAll(): Promise<void> {
    this.exporting.set(true);
    try {
      const result = await this.exporter.exportAll();
      this.exported.set(result);
      downloadBlob(result.blob, result.fileName);
    } catch {
      this.message.error('The export failed. Nothing was changed.');
    } finally {
      this.exporting.set(false);
    }
  }

  protected async import(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // so that the same file can be chosen again
    if (files.length === 0) {
      return;
    }

    this.importing.set(true);
    this.report.set(null);
    try {
      const report = await this.importer.importFiles(files);
      this.report.set(report);
      if (report.notes > 0) {
        this.message.success(`Imported ${report.notes} ${report.notes === 1 ? 'note' : 'notes'}`);
      }
    } catch {
      this.message.error('The import failed. Some notes may have been added before the problem.');
    } finally {
      this.importing.set(false);
    }
  }
}
