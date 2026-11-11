import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import { AttachmentDto, AttachmentUrl } from '../models/attachment.model';

/** The HTTP calls for attached files. Only the sync engine uploads, and only the resolver asks for addresses. */
@Injectable({ providedIn: 'root' })
export class AttachmentsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/attachments`;

  /** Sends a file as multipart/form-data (the browser sets the boundary). The id is ours, so repeating this is harmless. */
  upload(id: string, noteId: string, file: Blob, name: string): Observable<AttachmentDto> {
    const form = new FormData();
    form.append('id', id);
    form.append('noteId', noteId);
    form.append('file', file, name);
    return this.http.post<AttachmentDto>(this.base, form);
  }

  /** A short-lived address to show or download the file. `download` makes the browser save it instead of showing it. */
  url(id: string, download = false): Observable<AttachmentUrl> {
    return this.http.get<AttachmentUrl>(`${this.base}/${id}/url`, { params: download ? { download: true } : {} });
  }
}
