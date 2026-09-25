type Environment = Record<string, string | undefined>;

export function trustedOrigins(environment: Environment = process.env): string[] {
  const vercel = environment.VERCEL === "1";
  const candidates = [environment.APP_ORIGIN];
  if (vercel) {
    candidates.push(...[environment.VERCEL_URL, environment.VERCEL_BRANCH_URL,
      ...(environment.VERCEL_ENV === "production" ? [environment.VERCEL_PROJECT_PRODUCTION_URL] : [])
    ].filter(Boolean).map(host => `https://${host}`));
  }
  return [...new Set(candidates.flatMap(candidate => {
    if (!candidate) return [];
    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return [];
      if (vercel && url.protocol !== "https:") return [];
      return [url.origin];
    } catch { return []; }
  }))];
}

export function isAllowedOrigin(request: Request, environment: Environment = process.env): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && trustedOrigins(environment).includes(origin);
}

export function secureSessionCookie(environment: Environment = process.env): boolean {
  return environment.VERCEL === "1" || environment.APP_ORIGIN?.startsWith("https://") === true;
}