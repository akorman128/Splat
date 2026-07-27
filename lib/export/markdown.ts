import { topoOrder } from "@/lib/graph/topo-order";
import type { NodeRow } from "@/lib/types";
import type { ConversationExport } from "./conversation";

export function cardTitle(node: NodeRow): string {
  return node.title?.trim() || "Untitled";
}

function blockquote(text: string): string {
  const body = text.trim();
  if (!body) return "> _Empty prompt._";
  return body
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

export function toMarkdown({
  conversation,
  nodes,
  edges,
}: ConversationExport): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = topoOrder(
    nodes.map((node) => node.id),
    nodes,
    edges,
  );
  const numbers = new Map(order.map((id, index) => [id, index + 1]));

  const sources = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source_node_id)) continue;
    sources.set(edge.node_id, [
      ...(sources.get(edge.node_id) ?? []),
      edge.source_node_id,
    ]);
  }

  const reference = (id: string) => {
    const node = byId.get(id);
    return node ? `#${numbers.get(id)} ${cardTitle(node)}` : "a deleted card";
  };

  const lines = [
    `# ${conversation.title}`,
    "",
    `${nodes.length} card${nodes.length === 1 ? "" : "s"} · exported from Splat on ${new Date().toLocaleDateString()}`,
    "",
  ];

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;

    const meta = [node.model];
    meta.push(
      node.parent_id && byId.has(node.parent_id)
        ? `branches from ${reference(node.parent_id)}`
        : "root card",
    );
    const context = sources.get(id);
    if (context?.length) {
      meta.push(`context: ${context.map(reference).join(", ")}`);
    }
    if (node.status !== "complete") meta.push(node.status);

    lines.push(
      "---",
      "",
      `## ${numbers.get(id)}. ${cardTitle(node)}`,
      "",
      `*${meta.join(" · ")}*`,
      "",
      "**Prompt**",
      "",
      blockquote(node.prompt),
      "",
      "**Response**",
      "",
    );

    const response = node.response.trim();
    if (response) {
      lines.push(response, "");
    } else if (node.status === "error") {
      lines.push(
        `_Interrupted: ${node.error_message ?? "the answer never arrived."}_`,
        "",
      );
    } else {
      lines.push("_No response yet._", "");
    }
  }

  return lines.join("\n");
}
