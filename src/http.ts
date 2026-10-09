// Node's fetch gives up after 300 s without response headers, which cuts any Box call longer
// than 5 minutes ("fetch failed"). Measured Oct 3 2026: with this off, a 6-minute exec.command
// returns normally. This is the cause of what looked like Upstash issue #160 in our smoke test.
import { Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));
