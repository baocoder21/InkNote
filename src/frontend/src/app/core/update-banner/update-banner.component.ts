import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { UpdateNotifier } from '../update-notifier.service';

/**
 * "Presentational" notice in the bottom right corner: a new version of the app is ready (or the app must reload to
 * keep working). Shown by the shell, over whatever page is open. It never reloads by itself: the user chooses.
 */
@Component({
  selector: 'app-update-banner',
  imports: [NzButtonComponent],
  templateUrl: './update-banner.component.html',
  styleUrl: './update-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateBannerComponent {
  protected readonly updates = inject(UpdateNotifier);
}
