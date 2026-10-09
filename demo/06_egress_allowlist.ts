// On-camera demo 6: lock a box's outbound traffic to an allowlist.
import "../src/http.js";
import { Box } from "@upstash/box";
const c = { b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", cy: "\x1b[1;36m", d: "\x1b[2m", x: "\x1b[0m" };
console.log(`\n${c.cy}▸ Create a box that may only reach the npm registry${c.x}`);
console.log(`  ${c.d}networkPolicy: { mode: "custom", allowedDomains: ["registry.npmjs.org"] }${c.x}`);
const box = await Box.create({ runtime: "node", size: "small", name: "locked-box", networkPolicy: { mode: "custom", allowedDomains: ["registry.npmjs.org"] } });
try {
  const code = async (url: string) => (await box.exec.command(`curl -s --max-time 8 -o /dev/null -w '%{http_code}' ${url} || true`)).result.trim();
  for (const [url, allowed] of [["https://registry.npmjs.org/zod", true], ["https://example.com", false], ["https://api.github.com", false]] as const) {
    const res = await code(url);
    const ok = res === "200";
    console.log(`  ${ok ? c.g + "✓ reached" : c.r + "✗ blocked"}${c.x}  ${url.padEnd(34)} ${c.d}${ok ? "HTTP " + res : "no connection"}${c.x}`);
  }
} finally { await box.delete(); }
