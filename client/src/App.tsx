import { useEffect, useState } from "react";
import { Graph } from "./components/Graph";
import { getCommits, postSnapshot, postCommit, postDiff } from "./api";

export default function App() {
  const [commits, setCommits] = useState<any[]>([]);
  const [text, setText] = useState<string>("console.log('hello');");
  const [head, setHead] = useState<any | null>(null);
  const [diff, setDiff] = useState<any>({});

  async function refresh() {
    const cs = await getCommits();
    setCommits(cs);
    setHead(cs.at(-1) ?? null);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function doCommit(source: "human" | "ai") {
    const snap = await postSnapshot({ "index.ts": text });
    const parentId = commits.at(-1)?.id ?? null;
    const payload = {
      parentId,
      treeHash: snap.treeHash,
      message: source === "ai" ? "AI edit" : "Human edit",
      author: "demo",
      source,
      aiMeta:
        source === "ai"
          ? {
              model: "gpt-5",
              reasoning: "refactor",
              diffSummary: "minor changes",
            }
          : null,
    };
    await postCommit(payload);
    await refresh();

    const prevTree = head?.treeHash;
    if (prevTree) {
      const d = await postDiff(prevTree, snap.treeHash);
      setDiff(d.perFile);
    }
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>vc demo</h2>
      <Graph commits={commits} />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", height: 160 }}
      />
      
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => doCommit("human")}>commit (human)</button>
        <button onClick={() => doCommit("ai")}>commit (ai)</button>
      </div>
      <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 8 }}>
        {JSON.stringify(diff, null, 2)}
      </pre>
    </div>
  );
}
