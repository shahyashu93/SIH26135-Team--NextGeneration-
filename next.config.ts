import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL !== "1" ? { output: "standalone" as const } : {}),
  outputFileTracingExcludes: { "*": ["./.env", "./.env.*"] },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
    ] }];
  }
};
export default nextConfig;