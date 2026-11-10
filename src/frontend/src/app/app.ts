import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NzIconDirective } from 'ng-zorro-antd/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NzIconDirective],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
