const inputOrigin = process.argv[2] ?? process.env.EASYDRAFT_APP_ORIGIN ?? "https://easydraftdocs.app";
const origin = inputOrigin.replace(/\/+$/, "");
const publicPaths = ["/pricing", "/privacy", "/terms", "/security"];

const failures = [];

for (const path of publicPaths) {
  const url = `${origin}${path}`;
  let response;

  try {
    response = await fetch(url, {
      redirect: "follow",
    });
  } catch (error) {
    failures.push(`${url} -> request failed: ${(error instanceof Error ? error.message : String(error))}`);
    continue;
  }

  if (!response.ok) {
    failures.push(`${url} -> HTTP ${response.status}`);
    continue;
  }

  console.log(`OK  ${response.status}  ${url}`);
}

if (failures.length > 0) {
  console.error("Public route smoke check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Public route smoke check passed for ${origin}.`);
