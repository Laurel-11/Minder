// Minder's MCP endpoint (Streamable HTTP, stateless): connect any MCP client to https://<site>/api/mcp.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMinderMcp } from "@/lib/mcp-server";
import { clientIp, overLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (overLimit(`mcp:${ip}`, 120, 60_000).limited) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Wait a minute." }, id: null }, { status: 429 });
  }
  // A fresh server per request: nothing to keep between calls, and any number of agents can connect.
  const server = buildMinderMcp({
    purchase: () => {
      const mine = overLimit(`mcp-buy:${ip}`, 5, 60_000);
      if (mine.limited) return `This demo allows 5 purchases a minute. Try again in ${mine.retryInSeconds} seconds.`;
      const all = overLimit("mcp-buy:all", 40, 10 * 60_000);
      return all.limited ? `The demo is busy. Try again in ${all.retryInSeconds} seconds.` : null;
    },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

const notHere = () =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "This server is stateless: send JSON-RPC requests with POST." }, id: null }, { status: 405, headers: { Allow: "POST" } });

export const GET = notHere;
export const DELETE = notHere;
