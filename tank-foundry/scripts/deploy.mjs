import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
const DEPLOY_BRANCH = "main";
const BUILD_DIR = "play";

class DeployError extends Error {}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: PROJECT_DIR, encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit" });
}

function git(...args) {
  return run("git", args, { quiet: true }).trim();
}

function ensureDeployable() {
  const branch = git("branch", "--show-current");
  if (branch !== DEPLOY_BRANCH) throw new DeployError(`GitHub Pages serves ${DEPLOY_BRANCH}. Switch to it first (on ${branch}).`);
  const tracked = git("status", "--porcelain", "--untracked-files=no", ".");
  if (tracked) throw new DeployError(`Commit or stash Tank Foundry changes before deploying:\n${tracked}`);
}

function main() {
  ensureDeployable();
  run("git", ["pull", "--ff-only"]);
  run("npm", ["test"]);
  run("npm", ["run", "build"]);
  run("git", ["add", "-A", BUILD_DIR]);
  if (!git("diff", "--cached", "--name-only", "--", BUILD_DIR)) {
    console.log("play/ already matches the source. Nothing to publish.");
    return;
  }
  run("git", ["commit", "-m", "chore: rebuild Tank Foundry for GitHub Pages", "-m", `- Rebuild tank-foundry/${BUILD_DIR}/ from ${git("rev-parse", "--short", "HEAD")}`]);
  run("git", ["push", "origin", DEPLOY_BRANCH]);
  console.log("Pushed. GitHub Pages publishes https://kairisameshima.github.io/games/tank-foundry/play/ in about a minute.");
}

try {
  main();
} catch (error) {
  if (!(error instanceof DeployError)) throw error;
  console.error(error.message);
  process.exit(1);
}
