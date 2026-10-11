// The same bounded readiness probe is used by Docker, Compose and CI.
try {
  const response=await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health/ready`,{signal:AbortSignal.timeout(5000)});
  const health=await response.json();
  if(!response.ok || health.status!=='ok' || health.sha!==process.env.RELEASE_SHA)throw new Error('not ready');
}catch{process.exitCode=1;}
