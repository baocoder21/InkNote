import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { UpdateBannerComponent } from './core/update-banner/update-banner.component';
import { UpdateNotifier } from './core/update-notifier.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UpdateBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    inject(ThemeService); // creating it applies the saved theme
    inject(UpdateNotifier).start(); // tells the user when a newer version of the app is ready (production build only)
  }
}
