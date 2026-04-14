import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleRequest } from "./handler.js";

// Lambda handler — exported so the runtime can invoke it
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { method, path } = event.requestContext.http;

  let body: unknown;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;
    body = JSON.parse(raw);
  }

  const response = await handleRequest(method, path, body);
  return {
    statusCode: response.statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response.body),
  };
};

// Plain HTTP server — used for Cloud Run, Azure Functions, and local dev
// Activated by setting DT_EVAL_MODE=http
if (process.env.DT_EVAL_MODE === "http") {
  const port = Number(process.env.PORT ?? 8080);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    let body: unknown;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw) body = JSON.parse(raw) as unknown;
    }

    const response = await handleRequest(method, path, body);
    res.writeHead(response.statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response.body));
  });

  server.listen(port, () => {
    console.log(`dt-eval-engine listening on port ${port}`);
  });
}
