import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv } from "./env";
import { buildMcpServer } from "./mcp";

// Point d'entrée lancé par Claude Code (voir mcp.ts). Les erreurs partent sur stderr, stdout est réservé au protocole.
const { server } = await buildMcpServer(loadEnv().DATABASE_URL);
await server.connect(new StdioServerTransport());
