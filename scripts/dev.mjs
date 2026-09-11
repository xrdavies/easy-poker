import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(repo, "node_modules", ".bin", "wrangler");
const vite = path.join(repo, "node_modules", ".bin", "vite");

const children = [];

function run(label, bin, args) {
  const child = spawn(bin, args, { cwd: repo, stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (shutting) return;
    console.error(`[dev] ${label} exited (${signal || code})`);
    shut(code ?? 1);
  });
  children.push(child);
  return child;
}

let shutting = false;
function shut(code = 0) {
  if (shutting) return;
  shutting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shut(130));
process.on("SIGTERM", () => shut(0));

run("vite", vite, ["build", "--watch"]);
run("api", wrangler, ["dev", "--config", "wrangler.toml", "--port", "8789", "--inspector-port", "9229"]);
run("web", wrangler, ["dev", "--config", "wrangler.web.toml", "--port", "8787", "--inspector-port", "9230"]);
