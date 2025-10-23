#!/usr/bin/env bun
import { Command } from "commander";
import ky from "ky";

const api = ky.create({ prefixUrl: "http://localhost:3000" });
const program = new Command();
program.name("vc").description("demo vc cli");

program.command("init").action(async () => {
  await api.post("init").text();
  console.log("initialized");
});

program
  .command("commit")
  .requiredOption("-m, --message <msg>")
  .option("--source <source>", "human")
  .action(async (opts) => {
    let content = "console.log('cli');";
    try {
      content = await Bun.file("index.ts").text();
    } catch {}
    const { treeHash } = await api
      .post("snapshot", { json: { files: { "index.ts": content } } })
      .json<any>();
    const commits = await api.get("commits").json<any[]>();
    const parentId = commits.at(-1)?.id ?? null;
    const body = {
      parentId,
      treeHash,
      message: opts.message,
      author: "cli",
      source: opts.source,
    };
    const res = await api.post("commit", { json: body }).json<any>();
    console.log("Committed", res.id);
  });

program.command("log").action(async () => {
  const cs = await api.get("commits").json<any[]>();
  for (const c of cs) {
    console.log(`${c.id.slice(0, 7)} ${new Date(c.timestamp).toISOString()} ${c.source} ${c.message}`);
  }
});

await program.parseAsync();
