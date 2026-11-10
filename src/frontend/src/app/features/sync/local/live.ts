import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';

/**
 * A "live query": runs `query` against the local database now, and AGAIN every time something it read changes
 * (whether this tab, another tab, or the sync engine changed it). The result is an RxJS Observable, so the
 * stores can turn it into signals. Unsubscribing stops the watching.
 */
export function live<T>(query: () => T | Promise<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const subscription = liveQuery(query).subscribe({
      next: (value) => subscriber.next(value),
      error: (error) => subscriber.error(error),
    });
    return () => subscription.unsubscribe();
  });
}
