import {
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  Image,
} from "lucide-react";
import type { AttachmentKind } from "@/lib/attachments/types";

const ICONS = {
  image: Image,
  pdf: FileText,
  document: FileType,
  spreadsheet: FileSpreadsheet,
  text: FileCode,
} as const;

export function AttachmentIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const Icon = ICONS[kind as AttachmentKind] ?? File;
  return <Icon className={className} aria-hidden />;
}
