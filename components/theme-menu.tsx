"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Theme picker for the account menu. Light / Dark / System, with System the
 * default — the palette in globals.css is applied by next-themes putting the
 * `.dark` class on <html> (see components/theme-provider.tsx).
 */
export function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // No mounted-flag dance here: this lives inside the account menu's popup,
  // which base-ui only mounts once the menu is opened. By then next-themes has
  // long since resolved, so there is no server render to disagree with.
  const TriggerIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <TriggerIcon className="size-4" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (typeof value === "string") setTheme(value);
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="size-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
