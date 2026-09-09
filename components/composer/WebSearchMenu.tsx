"use client";

import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ON = "on";

export function WebSearchMenu({
  value,
  onChange,
  className,
}: {
  value: boolean;
  onChange: (webSearch: boolean) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            title="Let the model search the web as it answers"
            className={cn(
              "font-normal",
              value ? "text-foreground" : "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <Globe />
        {value ? "On" : "Off"}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={value ? ON : "off"}
          onValueChange={(next) => onChange(next === ON)}
        >
          {/* base-ui keeps a radio item's menu open by default. */}
          <DropdownMenuRadioItem value="off" closeOnClick>
            Off
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={ON} closeOnClick>
            On
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
