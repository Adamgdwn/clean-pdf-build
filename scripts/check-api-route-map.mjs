import { readdirSync, readFileSync } from "node:fs";

const apiFiles = readdirSync("apps/web/api")
  .filter((fileName) => fileName.endsWith(".ts") && !fileName.startsWith("_"))
  .map((fileName) => fileName.replace(/\.ts$/, ""))
  .sort();

const routerSource = readFileSync("api/[...route].ts", "utf8");
const routeEntries = Array.from(
  routerSource.matchAll(/^[ \t]*(?:"([^"]+)"|([a-zA-Z_$][\w$]*)):\s*[a-zA-Z_$][\w$]*Handler,/gm),
  (match) => match[1] ?? match[2],
).sort();

const missingRoutes = apiFiles.filter((apiFile) => !routeEntries.includes(apiFile));
const staleRoutes = routeEntries.filter((routeEntry) => !apiFiles.includes(routeEntry));

if (missingRoutes.length > 0 || staleRoutes.length > 0) {
  if (missingRoutes.length > 0) {
    console.error(`Missing API route registrations: ${missingRoutes.join(", ")}`);
  }

  if (staleRoutes.length > 0) {
    console.error(`Stale API route registrations: ${staleRoutes.join(", ")}`);
  }

  process.exit(1);
}

console.log(`API route map covers ${apiFiles.length} handlers.`);
