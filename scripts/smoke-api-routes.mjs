import { readdirSync } from "node:fs";

const inputOrigin = process.argv[2] ?? process.env.EASYDRAFT_APP_ORIGIN ?? "https://easydraftdocs.app";
const origin = inputOrigin.replace(/\/+$/, "");
const routes = readdirSync("apps/web/api")
  .filter((fileName) => fileName.endsWith(".ts") && !fileName.startsWith("_"))
  .map((fileName) => fileName.replace(/\.ts$/, ""))
  .sort();

const failures = [];

for (const route of routes) {
  const path = `/api/${route}`;
  const response = await fetch(`${origin}${path}`, { method: "GET" });
  const body = await response.text();

  if (response.status === 404 && body.includes("Endpoint not found")) {
    failures.push(`${path} -> ${body}`);
  }
}

if (failures.length > 0) {
  console.error("API route smoke check found missing deployed handlers:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`API route smoke check passed for ${routes.length} routes at ${origin}.`);
