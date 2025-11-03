#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RequestPayloadSchema } from "./types.js";
import { Fetcher } from "./Fetcher.js";
import process from "process";
import { downloadLimit } from "./types.js";
import express from "express";
import cors from "cors";

type TransportMap = Map<string, SSEServerTransport>;

function createServer() {
  const server = new Server(
    {
      name: "zcaceres/fetch",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "fetch_html",
        description: "Fetch a website and return its unmodified contents as HTML",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the website to fetch",
            },
            headers: {
              type: "object",
              description: "Optional headers to include in the request",
            },
            max_length: {
              type: "number",
              description: `Maximum number of characters to return (default: ${downloadLimit})`,
            },
            start_index: {
              type: "number",
              description: "Start content from this character index (default: 0)",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "fetch_markdown",
        description: "Fetch a website and return its contents converted content to Markdown",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the website to fetch",
            },
            headers: {
              type: "object",
              description: "Optional headers to include in the request",
            },
            max_length: {
              type: "number",
              description: `Maximum number of characters to return (default: ${downloadLimit}})`,
            },
            start_index: {
              type: "number",
              description: "Start content from this character index (default: 0)",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "fetch_txt",
        description:
          "Fetch a website, convert the content to plain text (no HTML)",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the website to fetch",
            },
            headers: {
              type: "object",
              description: "Optional headers to include in the request",
            },
            max_length: {
              type: "number",
              description: `Maximum number of characters to return (default: ${downloadLimit})`,
            },
            start_index: {
              type: "number",
              description: "Start content from this character index (default: 0)",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "fetch_json",
        description: "Fetch a JSON file from a URL",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the JSON to fetch",
            },
            headers: {
              type: "object",
              description: "Optional headers to include in the request",
            },
            max_length: {
              type: "number",
              description: `Maximum number of characters to return (default: ${downloadLimit})`,
            },
            start_index: {
              type: "number",
              description: "Start content from this character index (default: 0)",
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const validatedArgs = RequestPayloadSchema.parse(args);

  if (request.params.name === "fetch_html") {
    const fetchResult = await Fetcher.html(validatedArgs);
    return fetchResult;
  }
  if (request.params.name === "fetch_json") {
    const fetchResult = await Fetcher.json(validatedArgs);
    return fetchResult;
  }
  if (request.params.name === "fetch_txt") {
    const fetchResult = await Fetcher.txt(validatedArgs);
    return fetchResult;
  }
  if (request.params.name === "fetch_markdown") {
    const fetchResult = await Fetcher.markdown(validatedArgs);
    return fetchResult;
  }
  throw new Error("Tool not found");
});

  return server;
}

async function main() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : null;
  
  // If PORT is set, use HTTP/SSE transport (for Render.com/agent-kit)
  if (PORT) {
    const app = express();
    app.use(cors());
    app.use(express.json());
  const transports: TransportMap = new Map();

    app.get("/", (_req, res) => {
      res.status(200).send("Fetch MCP server is running");
    });

    app.get("/healthz", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });

    app.get("/sse", async (req, res) => {
      console.log("[MCP] Incoming SSE connection");
      try {
        const server = createServer();
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
          console.log(`[MCP] SSE connection closed: ${sessionId}`);
          transports.delete(sessionId);
        };

        await server.connect(transport);
        console.log(`[MCP] SSE connection established: ${sessionId}`);
      } catch (error) {
        console.error("[MCP] Failed to establish SSE connection", error);
        if (!res.headersSent) {
          res.status(500).send("Failed to establish SSE connection");
        }
      }
    });

    app.post("/message", async (req, res) => {
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      if (!sessionId) {
        res.status(400).send("Missing sessionId parameter");
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).send("Session not found");
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error(`[MCP] Error handling message for session ${sessionId}`, error);
        if (!res.headersSent) {
          res.status(500).send("Error handling message");
        }
      }
    });

    app.listen(PORT, () => {
      console.log(`MCP Server running on port ${PORT}`);
      console.log(`SSE endpoint available at http://localhost:${PORT}/sse`);
    });
  } else {
    // Otherwise use stdio transport (for local/desktop use)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
