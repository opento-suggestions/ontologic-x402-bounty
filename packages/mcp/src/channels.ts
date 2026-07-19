/**
 * channels.ts — the three-channel return separation (hologlass-mcp anatomy):
 *   content           → the agent's reasoning context: verdicts and next steps
 *   structuredContent → full record for a viewer/dashboard
 *   _meta             → timestamps + protocol tag, never hash-input
 *
 * Private key material is banned from ALL channels — the keystore is the only
 * place a testimony key exists.
 */

export const PROTOCOL = "witness-required/0.1";

export interface ToolResult {
  [key: string]: unknown; // MCP CallToolResult carries an index signature
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export function ok(agentView: Record<string, unknown>, full?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(agentView, null, 2) }],
    structuredContent: full ?? agentView,
    _meta: { protocol: PROTOCOL, at: new Date().toISOString() },
  };
}

export function fail(message: string, detail?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...detail }, null, 2) }],
    isError: true,
    _meta: { protocol: PROTOCOL, at: new Date().toISOString() },
  };
}
