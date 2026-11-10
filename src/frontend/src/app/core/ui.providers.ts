import { EnvironmentProviders, Provider } from '@angular/core';
import {
  DeleteOutline,
  EditOutline,
  FileTextOutline,
  PlusOutline,
  SaveOutline,
} from '@ant-design/icons-angular/icons';
import { provideNzNoAnimation } from 'ng-zorro-antd/core/animation';
import { en_US, provideNzI18n } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';

/**
 * Everything ng-zorro needs at application level, in one place.
 * Used by app.config.ts and by the component tests, so they stay identical.
 */
export function provideUi(): (Provider | EnvironmentProviders)[] {
  return [
    provideNzI18n(en_US),
    // Icons are registered one by one (tree-shaking): only these end up in the bundle.
    // When you use a new <nz-icon nzType="...">, add its icon here.
    provideNzIcons([DeleteOutline, EditOutline, FileTextOutline, PlusOutline, SaveOutline]),
    // We do not install @angular/animations, so ng-zorro runs without its own animations.
    provideNzNoAnimation(),
    // NzModalService (used for the delete confirmation) is not provided automatically.
    NzModalService,
  ];
}
