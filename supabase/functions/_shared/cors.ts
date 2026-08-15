const ALLOWED_ORIGINS_ENV = "BROWSER_ALLOWED_ORIGINS";

export type CorsPolicy = {
  allowed: boolean;
  headers: Record<string, string>;
};

function configuredOrigins(): Set<string> {
  const values = (Deno.env.get(ALLOWED_ORIGINS_ENV) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return new Set(values);
}

export function corsPolicyFor(req: Request): CorsPolicy {
  const origin = req.headers.get("Origin");
  if (!origin) return { allowed: true, headers: {} };

  if (!configuredOrigins().has(origin)) {
    return { allowed: false, headers: { Vary: "Origin" } };
  }

  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    }
  };
}

export function corsForbiddenResponse(policy: CorsPolicy): Response {
  return new Response(JSON.stringify({ error: "origin_not_allowed", errorCode: "origin_not_allowed" }), {
    status: 403,
    headers: { ...policy.headers, "Content-Type": "application/json" }
  });
}

export function corsPreflightResponse(policy: CorsPolicy): Response {
  return new Response(null, { status: 204, headers: policy.headers });
}

export function jsonHeadersWithCors(policy: CorsPolicy): Record<string, string> {
  return { ...policy.headers, "Content-Type": "application/json" };
}
