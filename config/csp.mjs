function buildScriptSrc({ reportOnly }) {
  const sources = ["'self'", "'unsafe-inline'"];
  if (reportOnly) {
    sources.push("'unsafe-eval'");
  }
  return sources.join(" ");
}

export function buildContentSecurityPolicy({ reportOnly }) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    `script-src ${buildScriptSrc({ reportOnly })}`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: wss:",
    "font-src 'self' data: https:",
  ].join("; ");
}

export function buildSecurityHeaders({
  nodeEnv = process.env.NODE_ENV,
  cspReportOnly = process.env.PARARIA_CSP_REPORT_ONLY === "1",
} = {}) {
  const production = nodeEnv === "production";
  const reportOnly = !production || cspReportOnly;
  const cspKey = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  const headers = [
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    {
      key: cspKey,
      value: buildContentSecurityPolicy({ reportOnly }),
    },
  ];

  if (production) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
