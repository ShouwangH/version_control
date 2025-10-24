import assert from "node:assert/strict";
import { createRepo } from "../repo.js";
import { createInMemoryStorage } from "../storage.js";
import type { VCRepo } from "../types.js";

function createTestRepo(): VCRepo {
  let current = 1;
  return createRepo({
    storage: createInMemoryStorage(),
    author: "test",
    clock: () => current++,
  });
}

async function seedBaseCommit(repo: VCRepo, content: string) {
  await repo.snapshot({ "note.txt": content });
  return repo.commit("base", "human");
}

async function testMergeConflictMarkers() {
  const repo = createTestRepo();
  await repo.init();

  const base = await seedBaseCommit(repo, "base content");

  await repo.snapshot({ "note.txt": "ours change" });
  const ours = await repo.commit("ours", "human");plea

  await repo.hydrate(base.id);
  await repo.snapshot({ "note.txt": "theirs change" });
  const theirs = await repo.commit("theirs", "human");

  await repo.hydrate(ours.id);
  const result = await repo.merge(theirs.id);

  assert.ok(result.commitId, "merge should create a commit id");
  assert.ok(result.mergedTreeHash, "merge should persist merged tree");
  assert.equal(result.conflicts.length, 1);

  const mergedContent = result.mergedFiles?.["note.txt"] ?? "";
  assert.ok(mergedContent.includes("<<<<<<< ours"));
  assert.ok(mergedContent.includes("======="));
  assert.ok(mergedContent.includes(">>>>>>> theirs"));

  const working = await repo.getWorking();
  assert.equal(working.parentId, result.commitId);
}

async function testMergePrefersLocalChanges() {
  const repo = createTestRepo();
  await repo.init();

  const base = await seedBaseCommit(repo, "base content");

  await repo.snapshot({ "note.txt": "ours change" });
  const ours = await repo.commit("ours", "human");

  await repo.hydrate(base.id);
  await repo.snapshot({ "note.txt": "base content" });
  const theirs = await repo.commit("theirs", "human");

  await repo.hydrate(ours.id);
  const result = await repo.merge(theirs.id);

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.mergedFiles?.["note.txt"], "ours change");
}

async function testHydrateNoopWhenTreeMatches() {
  const repo = createTestRepo();
  await repo.init();

  const base = await seedBaseCommit(repo, "base content");
  const before = await repo.getWorking();

  const files = await repo.hydrate(base.id);
  const after = await repo.getWorking();

  assert.deepEqual(files, { "note.txt": "base content" });
  assert.equal(after.treeHash, before.treeHash);
  assert.equal(after.parentId, base.id);
}

async function main() {
  await testMergeConflictMarkers();
  await testMergePrefersLocalChanges();
  await testHydrateNoopWhenTreeMatches();
  console.log("merge tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
