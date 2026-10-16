#!/usr/bin/env node

/**
 * HaloForge MCP
 *
 * MCP server for HaloITSM that can read and safely configure an instance.
 * Based on halo-itsm-mcp (MIT).
 *
 * Transport modes:
 *   - stdio  (default): for Claude Desktop and Claude Code local use
 *   - http:  for Docker or remote deployment (Streamable HTTP + SSE)
 *
 * Authentication modes:
 *   - env:   Client ID and Secret from environment variables (default)
 *   - oauth: proxied OAuth2 via the MCP protocol (Claude connector UI)
 *
 * Safety: HALO_MODE=read (default), write or full; HALO_DISABLE_DELETE=true
 * by default; optional HALO_WRITE_ALLOWLIST. Several instances with
 * HALO_INSTANCES=trial,prod.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express from "express";

// ==================== SECURITY HEADERS ====================

/**
 * Middleware that sets security headers on every response.
 * Defence-in-depth: the reverse proxy should also set these,
 * but we add them here in case the proxy misses any.
 */
function securityHeaders(): express.RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0"); // Modern best practice: rely on CSP, disable legacy XSS filter
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // HSTS is only meaningful over HTTPS — the reverse proxy should set this,
    // but we add it so it's present if the proxy forwards the header through.
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}
import { loadInstances, loadOAuthInstance, validateUrl, type HaloConfig } from "./types/config.js";
import { HaloClient } from "./client/halo-client.js";
import { InstanceManager } from "./client/instance-manager.js";
import { AuditLog } from "./safety/audit.js";
import { configureProxy } from "./utils/proxy.js";
import {
  createHaloOAuthProvider,
  captureClientSecret,
  captureRedirectUri,
  injectPkceIfMissing,
  injectPkceVerifier,
  getCredentialsForToken,
  bindSessionCredentials,
  cleanupSessionCredentials,
} from "./auth/proxy-provider.js";
import { buildAllTools } from "./tools/registry.js";
import { buildResources } from "./resources/context.js";
import { logger, setLogLevel } from "./utils/logger.js";

import type { Request, Response, RequestHandler } from "express";

// ==================== MCP SERVER FACTORY ====================

export const SERVER_NAME = "haloforge-mcp";
export const SERVER_VERSION = "2.0.0";

const audit = new AuditLog();

export function createHaloMcpServer(manager: InstanceManager): McpServer {
  const toolMap = buildAllTools(manager, audit);
  const resources = buildResources(manager);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const [name, tool] of toolMap) {
    server.tool(name, tool.description, tool.shape, async (args: Record<string, unknown>) => {
      logger.debug(`Tool called: ${name}`, { args: Object.keys(args) });
      return await tool.handler(args);
    });
  }

  for (const resource of resources) {
    server.resource(
      resource.name,
      resource.uri,
      { mimeType: resource.mimeType, description: resource.description },
      async () => ({
        contents: [{
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: await resource.handler(),
        }],
      })
    );
  }

  return server;
}

// ==================== TOKEN-AWARE CLIENT ====================

function createOAuthClient(baseUrl: string): { client: HaloClient; config: HaloConfig } {
  const config = loadOAuthInstance(baseUrl);
  return { client: new HaloClient(config), config };
}

// ==================== STDIO TRANSPORT ====================

async function startStdio(manager: InstanceManager): Promise<void> {
  const server = createHaloMcpServer(manager);
  const transport = new StdioServerTransport();
  logger.info("Connecting via stdio transport...");
  await server.connect(transport);
  logger.info("HaloForge MCP running (stdio). Waiting for requests.");
}

// ==================== HTTP TRANSPORT (ENV AUTH) ==============

async function startHttp(manager: InstanceManager): Promise<void> {
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.set("trust proxy", 1);
  app.use(securityHeaders());
  app.use(express.json({ limit: "1mb" }) as express.RequestHandler);
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  setupMcpRoutes(app, transports, () => createHaloMcpServer(manager));

  app.listen(port, () => {
    logger.info(`HaloForge MCP running (HTTP) on port ${port}`);
    logger.info(`  MCP endpoint:    http://0.0.0.0:${port}/mcp`);
    logger.info(`  Health check:    http://0.0.0.0:${port}/health`);
  });

  setupGracefulShutdown(transports);
}

// ==================== HTTP + OAUTH TRANSPORT ================

async function startHttpWithOAuth(haloBaseUrl: string): Promise<void> {
  const port = parseInt(process.env.MCP_PORT || "3000", 10);

  // MCP_PUBLIC_URL is what the reverse proxy exposes (https://...)
  // Defaults to http://localhost:{port} for local dev
  const publicUrl = process.env.MCP_PUBLIC_URL || `http://localhost:${port}`;
  const serverUrl = new URL(publicUrl);
  const mcpEndpoint = new URL(`${publicUrl}/mcp`);

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Trust reverse proxy (ngrok, nginx, etc.) so X-Forwarded-For works correctly
  app.set("trust proxy", 1);
  app.use(securityHeaders());
  app.use(express.json({ limit: "1mb" }) as express.RequestHandler);

  // Debug: log every incoming request to diagnose auth flow issues
  app.use(((req: Request, _res: Response, next: () => void) => {
    logger.debug(`>> ${req.method} ${req.path}`, {
      contentType: req.headers["content-type"] || "none",
      hasBody: req.body ? "yes" : "no",
    });
    next();
  }) as RequestHandler);

  // Custom OAuth server: bridges Claude's Authorization Code flow to Halo's Client Credentials
  const oauthProvider = createHaloOAuthProvider(haloBaseUrl);

  // Parse URL-encoded bodies on /token BEFORE the auth router.
  // OAuth token requests use application/x-www-form-urlencoded.
  // Without this, req.body is empty when our capture middleware runs.
  app.use("/token", express.urlencoded({ extended: false }) as RequestHandler);

  // Capture client_secret from token requests BEFORE the SDK's auth router processes them.
  app.use("/token", captureClientSecret() as unknown as RequestHandler);

  // Inject auto-generated code_verifier for non-PKCE clients (like n8n)
  app.use("/token", injectPkceVerifier() as unknown as RequestHandler);

  // Capture redirect_uri from authorize requests BEFORE the SDK validates it.
  // This allows any MCP client (Claude, n8n, etc.) to connect without pre-registration.
  app.use("/authorize", captureRedirectUri(oauthProvider.clientsStore) as unknown as RequestHandler);

  // Auto-inject PKCE params for clients that don't support it (n8n, etc.)
  app.use("/authorize", injectPkceIfMissing() as unknown as RequestHandler);

  // Install the full OAuth auth router (metadata, token, authorize, register endpoints)
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: serverUrl,
    baseUrl: serverUrl,
    scopesSupported: ["all"],
    resourceName: "HaloForge MCP",
    resourceServerUrl: mcpEndpoint,
  }));

  // The SDK registers protected resource metadata at /.well-known/oauth-protected-resource/mcp
  // (per RFC 9728 path-based discovery). Some clients look at /.well-known/oauth-protected-resource
  // without the /mcp suffix. Serve the same metadata at both paths.
  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: mcpEndpoint.href,
      authorization_servers: [serverUrl.href],
      scopes_supported: ["all"],
      bearer_methods_supported: ["header"],
      resource_name: "HaloForge MCP",
    });
  });

  // Bearer auth middleware for the MCP endpoints
  const authMiddleware = requireBearerAuth({ verifier: oauthProvider });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Health check (no auth required)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // MCP routes with OAuth middleware
  // Extract the Bearer token from the request and pass it to the HaloClient
  // so it uses the real Halo token instead of trying Client Credentials with dummy creds
  setupMcpRoutes(app, transports, (req) => {
    const { client, config } = createOAuthClient(haloBaseUrl);

    // Extract the Halo access token from the Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      client.setToken(token);

      // Look up stored credentials for this token so the client can
      // auto-refresh via Client Credentials when the token expires
      const creds = getCredentialsForToken(token);
      if (creds) {
        client.setCredentials(creds.clientId, creds.clientSecret);
      }
    }

    return createHaloMcpServer(new InstanceManager([config], config.name, undefined, new Map([[config.name, client]])));
  }, authMiddleware as RequestHandler,
  // Bind session to credentials on init for cleanup tracking
  (sessionId: string, req: Request) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      bindSessionCredentials(sessionId, authHeader.slice(7));
    }
  },
  // Clean up credentials when session disconnects
  (sessionId: string) => {
    cleanupSessionCredentials(sessionId);
  });

  // Plain HTTP - reverse proxy handles TLS
  app.listen(port, () => {
    logger.info(`HaloForge MCP running (HTTP + OAuth proxy) on port ${port}`);
    logger.info(`  Internal:        http://0.0.0.0:${port}/mcp`);
    logger.info(`  Public URL:      ${publicUrl}/mcp`);
    logger.info(`  Health check:    http://0.0.0.0:${port}/health`);
    logger.info(`  OAuth metadata:  ${publicUrl}/.well-known/oauth-authorization-server`);
    logger.info("");
    logger.info("Claude connector settings:");
    logger.info(`  URL:                 ${publicUrl}`);
    logger.info("  OAuth Client ID:     (your Halo API Client ID)");
    logger.info("  OAuth Client Secret: (your Halo API Client Secret)");
  });

  setupGracefulShutdown(transports);
}

// ==================== SHARED ROUTE SETUP ====================

function setupMcpRoutes(
  app: ReturnType<typeof createMcpExpressApp>,
  transports: Record<string, StreamableHTTPServerTransport>,
  createServer: (req: Request, res: Response) => McpServer,
  authMiddleware?: RequestHandler,
  onSessionInit?: (sessionId: string, req: Request) => void,
  onSessionClose?: (sessionId: string) => void,
): void {
  const handlers = {
    post: async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      try {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          transport = transports[sessionId];
        } else if (isInitializeRequest(req.body)) {
          // Accept initialize requests even if a stale session ID is provided
          // (e.g., after server restart). This allows clients to reconnect.
          const initReq = req; // Capture for the callback
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              logger.info(`Session initialized: ${sid}`);
              transports[sid] = transport;
              onSessionInit?.(sid, initReq);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              logger.info(`Session closed: ${sid}`);
              delete transports[sid];
              onSessionClose?.(sid);
            }
          };
          const server = createServer(req, res);
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        } else {
          // Per MCP spec, 404 tells the client the session is gone and it
          // should re-initialize. 400 leaves clients stuck on stale IDs
          // across server restarts/redeploys.
          const status = sessionId ? 404 : 400;
          const message = sessionId
            ? "Session not found, please re-initialize"
            : "Bad Request: No valid session ID";
          res.status(status).json({
            jsonrpc: "2.0",
            error: { code: -32000, message },
            id: null,
          });
          return;
        }
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error("Error handling MCP POST", { error: (error as Error).message });
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
        }
      }
    },

    get: async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(sessionId ? 404 : 400).send("Invalid or missing session ID");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    },

    delete: async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(sessionId ? 404 : 400).send("Invalid or missing session ID");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    },
  };

  if (authMiddleware) {
    app.post("/mcp", authMiddleware, handlers.post);
    app.get("/mcp", authMiddleware, handlers.get);
    app.delete("/mcp", authMiddleware, handlers.delete);
  } else {
    app.post("/mcp", handlers.post);
    app.get("/mcp", handlers.get);
    app.delete("/mcp", handlers.delete);
  }
}

// ==================== HELPERS ===============================

function setupGracefulShutdown(transports: Record<string, StreamableHTTPServerTransport>): void {
  const shutdown = async () => {
    logger.info("Shutting down...");
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
        delete transports[sid];
      } catch (err) {
        logger.error(`Error closing session ${sid}`, { error: (err as Error).message });
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ========================= MAIN ==============================

async function main(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT || "stdio";
  const authMode = process.env.MCP_AUTH || "env";

  // OAuth mode only needs HALO_BASE_URL
  if (transport === "http" && authMode === "oauth") {
    const baseUrl = process.env.HALO_BASE_URL;
    if (!baseUrl) {
      process.stderr.write("HALO_BASE_URL environment variable is required for OAuth mode.\n");
      process.exit(1);
    }
    try {
      validateUrl(baseUrl, "HALO_BASE_URL");
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    }
    setLogLevel((process.env.LOG_LEVEL as HaloConfig["logLevel"]) || "info");
    if (configureProxy()) logger.info("Using the outbound proxy from HTTPS_PROXY or HTTP_PROXY");
    logger.info("Starting HaloForge MCP (OAuth proxy mode)", { instance: baseUrl });
    await startHttpWithOAuth(baseUrl.replace(/\/+$/, ""));
    return;
  }

  // Standard mode: needs full credentials in env
  let loaded;
  try {
    loaded = loadInstances();
  } catch (err) {
    process.stderr.write(`Configuration error: ${(err as Error).message}\n`);
    process.stderr.write("Or use MCP_AUTH=oauth with MCP_TRANSPORT=http (only requires HALO_BASE_URL).\n");
    process.exit(1);
  }

  setLogLevel(loaded.instances[0].logLevel);
  if (configureProxy()) logger.info("Using the outbound proxy from HTTPS_PROXY or HTTP_PROXY");
  logger.info("Starting HaloForge MCP", {
    instances: loaded.instances.map((i) => `${i.name} (${i.mode})`).join(", "),
    default: loaded.defaultName,
  });

  const manager = new InstanceManager(loaded.instances, loaded.defaultName);

  if (transport === "http") {
    await startHttp(manager);
  } else {
    await startStdio(manager);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  process.exit(1);
});
