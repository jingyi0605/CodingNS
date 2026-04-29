import { Menu, Submenu, type MenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type DesktopContextMenuItem =
  | DesktopContextMenuActionItem
  | DesktopContextMenuSubmenuItem;

export interface DesktopContextMenuActionItem {
  id: string;
  label: string;
  disabled?: boolean;
  accelerator?: string;
  onSelect: () => void | Promise<void>;
}

export interface DesktopContextMenuSubmenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  items: DesktopContextMenuItem[];
}

export async function showDesktopContextMenu(items: DesktopContextMenuItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const menu = await Menu.new({
    items: await Promise.all(items.map((item) => toTauriMenuItem(item)))
  });

  await menu.popup(undefined, getCurrentWindow());
}

async function toTauriMenuItem(
  item: DesktopContextMenuItem
): Promise<MenuItemOptions | SubmenuOptions | Submenu> {
  if ("items" in item) {
    return Submenu.new({
      id: item.id,
      text: item.label,
      enabled: !item.disabled,
      items: await Promise.all(item.items.map((child) => toTauriMenuItem(child)))
    });
  }

  return {
    id: item.id,
    text: item.label,
    enabled: !item.disabled,
    accelerator: item.accelerator,
    action: () => {
      void item.onSelect();
    }
  };
}
