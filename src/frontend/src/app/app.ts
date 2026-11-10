import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { HealthResponse, HealthService } from './core/health.service';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error' };

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly healthService = inject(HealthService);

  // Turn the HTTP Observable into a Signal the template can read directly.
  protected readonly health = toSignal(
    this.healthService.getHealth().pipe(
      map((data): HealthState => ({ kind: 'ok', data })),
      catchError(() => of<HealthState>({ kind: 'error' })),
    ),
    { initialValue: { kind: 'loading' } as HealthState },
  );
}
