import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface DesktopContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  accelerator?: string;
  onSelect: () => void | Promise<void>;
}

export async function showDesktopContextMenu(items: DesktopContextMenuItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const menu = await Menu.new({
    items: items.map((item) => ({
      id: item.id,
      text: item.label,
      enabled: !item.disabled,
      accelerator: item.accelerator,
      action: () => {
        void item.onSelect();
      }
    }))
  });

  await menu.popup(undefined, getCurrentWindow());
}
