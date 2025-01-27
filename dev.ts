#!/usr/bin/env -S deno run -A --watch=static/
import dev from "$live/dev.ts";
import liveManifest from "$live/live.gen.ts";

await dev(import.meta.url, "./main.ts", {
  imports: [liveManifest],
});
