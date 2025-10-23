import ky from "ky";

const api = ky.create({ prefixUrl: "http://localhost:3000" });

export async function getCommits() {
  return api.get("commits").json<any[]>();
}

export async function getRefs() {
  return api.get("refs").json<any[]>();
}

export async function postSnapshot(files: Record<string, string>) {
  return api.post("snapshot", { json: { files } }).json<{ treeHash: string }>();
}

export async function postCommit(body: any) {
  return api.post("commit", { json: body }).json<{ id: string }>();
}

export async function getTree(hash: string) {
  return api.get(`tree/${hash}`).json<{ files: Record<string, string> }>();
}

export async function postDiff(a: string, b: string) {
  return api
    .post("diff", { json: { olderTreeHash: a, newerTreeHash: b } })
    .json<{ perFile: any }>();
}
