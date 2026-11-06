import { openApiDocument } from "@/lib/api-v1/openapi";

/** The OpenAPI document of the public API (verikora#202): public, like the contract it describes. */
export function GET(req: Request) {
  return Response.json(openApiDocument(new URL(req.url).origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
