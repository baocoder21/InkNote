import { EnvironmentProviders, Provider } from '@angular/core';
import {
  BgColorsOutline,
  CheckOutline,
  CloseOutline,
  DeleteOutline,
  DownOutline,
  EditOutline,
  EllipsisOutline,
  FileAddOutline,
  FileTextOutline,
  FolderAddOutline,
  FolderOpenOutline,
  FolderOutline,
  PushpinFill,
  PushpinOutline,
  RightOutline,
  TagOutline,
} from '@ant-design/icons-angular/icons';
import { provideNzNoAnimation } from 'ng-zorro-antd/core/animation';
import { en_US, provideNzI18n } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';

/**
 * Everything ng-zorro needs at application level, in one place.
 * Used by app.config.ts and by the component tests, so they stay identical.
 *
 * NzModalService and NzContextMenuService are NOT here: they are not provided automatically,
 * but only the notes feature needs them, so they are provided in its (lazy) route
 * (notes.routes.ts). A test of a component that opens dialogs or menus provides them itself.
 */
export function provideUi(): (Provider | EnvironmentProviders)[] {
  return [
    provideNzI18n(en_US),
    // Icons are registered one by one (tree-shaking): only these end up in the bundle.
    // When you use a new <nz-icon nzType="...">, add its icon here.
    provideNzIcons([
      BgColorsOutline,
      CheckOutline,
      CloseOutline,
      DeleteOutline,
      DownOutline,
      EditOutline,
      EllipsisOutline,
      FileAddOutline,
      FileTextOutline,
      FolderAddOutline,
      FolderOpenOutline,
      FolderOutline,
      PushpinFill,
      PushpinOutline,
      RightOutline,
      TagOutline,
    ]),
    // We do not install @angular/animations, so ng-zorro runs without its own animations.
    provideNzNoAnimation(),
  ];
}
