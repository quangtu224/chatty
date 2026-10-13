// Docker HEALTHCHECK (also used by Compose and CI): the container is healthy only when
// the database answers (/health/ready) and the server reports this image's own SHA.
// Exit code 0 = healthy, 1 = unhealthy; the 5 s timeout keeps a hung server from
// blocking the probe.
try {
  const port = process.env.PORT ?? 3000;
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
    signal: AbortSignal.timeout(5000),
  });
  const health = await response.json();
  // Same SHA source as server/index.js (Render's RENDER_GIT_COMMIT wins when set).
  const expected = process.env.RENDER_GIT_COMMIT || process.env.RELEASE_SHA;
  if (!response.ok || health.status !== "ok" || health.sha !== expected)
    throw new Error("not ready");
} catch {
  process.exitCode = 1;
}
