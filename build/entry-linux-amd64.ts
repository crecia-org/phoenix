import psqldefGz from "../vendor-bin/linux-amd64/psqldef.gz" with { type: "file" };
import squawkGz from "../vendor-bin/linux-amd64/squawk.gz" with { type: "file" };
import { registerEmbedded } from "../src/vendor/binaries.ts";
import { run } from "../src/cli.ts";

registerEmbedded({ psqldef: psqldefGz, squawk: squawkGz });
await run();
