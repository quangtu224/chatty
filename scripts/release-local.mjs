// Local release: verify, build, migrate and start exactly the committed HEAD.
// Steps: clean Git -> private tests/lint/build -> Docker image tagged with the SHA ->
// migrate + runtime grants (Compose dependencies) -> app start -> smoke for that SHA.
// Any failing step stops the release before the running app is replaced.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sha = git("rev-parse", "HEAD");
assert.match(sha, /^[a-f0-9]{40}$/);

// The image must contain committed source only, so its SHA label is truthful.
// Checked again after each long step: an edit or checkout meanwhile aborts the release.
const assertUnchanged = () => {
  assert.equal(git("status", "--porcelain"), "", "Commit source changes before releasing.");
  assert.equal(git("rev-parse", "HEAD"), sha, "HEAD changed during the release.");
};
assertUnchanged();
// npm_execpath lets us call the same npm that started this script (works on Windows too).
assert.ok(process.env.npm_execpath, "Run this through npm run release:local.");

// Runs a command with RELEASE_SHA set (Compose tags the image and the app reports it).
const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, RELEASE_SHA: sha },
  });
  if (result.error || result.status !== 0)
    throw new Error("Release stopped: a required command failed.");
};

// Private tests live only in this checkout; CI cannot run them, so this is their gate.
run(process.execPath, [process.env.npm_execpath, "run", "verify"]);
assertUnchanged();
run("docker", ["compose", "build", "app"]);
assertUnchanged();
// Compose runs migrate -> provision before app; if either fails, this revision never starts.
run("docker", ["compose", "up", "-d", "--wait", "--wait-timeout", "60", "app"]);
run(process.execPath, ["scripts/smoke.mjs", `http://127.0.0.1:${process.env.APP_PORT ?? 3000}`, sha]);
console.log(`Local release verified: ${sha}. Retain this image for rollback.`);
