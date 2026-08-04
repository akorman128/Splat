import type { ConversationExport } from "./conversation";

export const EXPORT_FORMAT = "splat.conversation";
export const EXPORT_VERSION = 1;

export function toJson({
  conversation,
  nodes,
  edges,
}: ConversationExport): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
      nodes: nodes.map((node) => ({
        id: node.id,
        parentId: node.parent_id,
        title: node.title,
        prompt: node.prompt,
        response: node.response,
        provider: node.provider,
        model: node.model,
        thinkingLevel: node.thinking_level,
        status: node.status,
        errorMessage: node.error_message,
        promptTokens: node.prompt_tokens,
        completionTokens: node.completion_tokens,
        createdAt: node.created_at,
        canvas: {
          x: node.canvas_x,
          y: node.canvas_y,
          w: node.canvas_w,
          h: node.canvas_h,
        },
      })),
      contextEdges: edges.map((edge) => ({
        id: edge.id,
        nodeId: edge.node_id,
        sourceNodeId: edge.source_node_id,
        position: edge.position,
      })),
    },
    null,
    2,
  );
}
