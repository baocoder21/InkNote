import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';

/**
 * A "live query": runs `query` against the local database now, and AGAIN every time something it read changes
 * (whether this tab, another tab, or the sync engine changed it). The result is an RxJS Observable, so the
 * stores can turn it into signals. Unsubscribing stops the watching.
 *
 * Whatever goes wrong inside `query` (even an exception thrown at once, such as "the database is not open",
 * which happens when it is closed while a query is waiting to run again) reaches the subscriber as an ERROR of the
 * Observable. Without the `async` below Dexie would run the function inside a timer, and the exception would
 * escape as an uncaught error that nobody can handle.
 */
export function live<T>(query: () => T | Promise<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const subscription = liveQuery(async () => query()).subscribe({
      next: (value) => subscriber.next(value),
      error: (error) => subscriber.error(error),
    });
    return () => subscription.unsubscribe();
  });
}
