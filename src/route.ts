import { createPineconeSearchService, type PineconeSearchService } from "./service";
import type { PineconeSearchServiceOptions } from "./types";

interface RequestPayload {
  search?: string;
  query?: string;
  topK?: number;
  rerankTopN?: number;
}

export function createPineconeSearchRouteHandler(
  serviceOrOptions: PineconeSearchService | PineconeSearchServiceOptions
): (request: Request) => Promise<Response> {
  const service =
    "search" in serviceOrOptions
      ? serviceOrOptions
      : createPineconeSearchService(serviceOrOptions as PineconeSearchServiceOptions);

  return async function handler(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as RequestPayload;
      const search = body.search?.trim();
      const query = body.query?.trim();

      if (!search || !query) {
        return jsonResponse({ error: "Both `search` and `query` are required" }, 400);
      }

      const response = await service.search(search, query, {
        topK: body.topK,
        rerankTopN: body.rerankTopN
      });

      return jsonResponse(response, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ error: message }, 500);
    }
  };
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
