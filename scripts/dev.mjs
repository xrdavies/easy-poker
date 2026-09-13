import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(repo, "node_modules", ".bin", "wrangler");

const children = [];

function freePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  });
}

async function pickPort(preferred) {
  for (let port = preferred; port < preferred + 20; port++) {
    if (await freePort(port)) return port;
  }
  throw new Error(`no free port near ${preferred}`);
}

function run(label, args) {
  const child = spawn(wrangler, args, { cwd: repo, stdio: "inherit", env: process.env });
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

const apiPort = Number(process.env.EASY_POKER_API_PORT) || await pickPort(8789);
const webPort = Number(process.env.EASY_POKER_WEB_PORT) || await pickPort(apiPort === 8787 ? 8790 : 8787);
const apiInspector = await pickPort(9229);
const webInspector = await pickPort(apiInspector + 1);
console.log(`[dev] api http://127.0.0.1:${apiPort}, web http://127.0.0.1:${webPort}`);
run("api", ["dev", "--config", "wrangler.toml", "--port", String(apiPort), "--inspector-port", String(apiInspector)]);
run("web", ["dev", "--config", "wrangler.web.toml", "--port", String(webPort), "--inspector-port", String(webInspector), "--var", `API_ORIGIN:http://127.0.0.1:${apiPort}`]);
