import { DtEvalError, evaluate, listPrompts } from "@dynatrace-oss/dt-eval-lib";
import type { ErrorResponse, EvaluateRequest, EvaluateResponse } from "./types.js";

export interface ApiResponse {
  statusCode: number;
  body: EvaluateResponse | { metrics: ReturnType<typeof listPrompts> } | { status: string } | ErrorResponse;
}

export async function handleRequest(
  method: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  if (method === "GET" && path === "/health") {
    return { statusCode: 200, body: { status: "ok" } };
  }

  if (method === "GET" && path === "/metrics") {
    return { statusCode: 200, body: { metrics: listPrompts() } };
  }

  if (method === "POST" && path === "/evaluate") {
    const req = body as Partial<EvaluateRequest>;
    if (!req.metric || !req.input || !req.config) {
      return {
        statusCode: 400,
        body: { error: "Missing required fields: metric, input, config" },
      };
    }

    try {
      const result = await evaluate(req.metric, req.input, req.config);
      return { statusCode: 200, body: { result } };
    } catch (err) {
      if (err instanceof DtEvalError) {
        return {
          statusCode: 400,
          body: { error: err.message, code: err.constructor.name },
        };
      }
      throw err;
    }
  }

  return { statusCode: 404, body: { error: "Not found" } };
}
