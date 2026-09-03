"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Braces, Download, FileText, Image } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchConversation } from "@/lib/export/conversation";
import { downloadBlob, filenameFor } from "@/lib/export/download";
import { toJson } from "@/lib/export/json";
import { toMarkdown } from "@/lib/export/markdown";
import { toPng } from "@/lib/export/png";

const FORMATS = [
  { value: "md", label: "Markdown", Icon: FileText },
  { value: "json", label: "JSON", Icon: Braces },
  { value: "png", label: "Image", Icon: Image },
] as const;

type Format = (typeof FORMATS)[number]["value"];

async function fileFor(conversationId: string, format: Format) {
  const data = await fetchConversation(conversationId);
  if (data.nodes.length === 0) return null;

  const name = filenameFor(data.conversation.title, format);
  if (format === "png") return { blob: await toPng(data), name };
  if (format === "json") {
    return {
      blob: new Blob([toJson(data)], { type: "application/json" }),
      name,
    };
  }
  return {
    blob: new Blob([toMarkdown(data)], { type: "text/markdown" }),
    name,
  };
}

export function DownloadMenu({ conversationId }: { conversationId: string }) {
  const [busy, setBusy] = useState(false);

  async function download(format: Format) {
    if (busy) return;
    setBusy(true);
    try {
      const file = await fileFor(conversationId, format);
      if (!file) {
        toast.error("Nothing to download", {
          description: "This canvas has no cards yet.",
        });
        return;
      }
      downloadBlob(file.blob, file.name);
    } catch (error) {
      toast.error("Could not download canvas", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Download className="size-4" />
        Download
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-36">
        {FORMATS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            disabled={busy}
            onClick={() => download(value)}
          >
            <Icon className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
