import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";

export function Graph({ commits }: { commits: any[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const nodes = commits.map((c) => ({
      data: { id: c.id, label: `${c.id.slice(0, 6)}\n${c.source}` },
    }));
    const edges = commits
      .filter((c) => c.parentId)
      .map((c) => ({
        data: { id: `${c.id}->${c.parentId}`, source: c.parentId, target: c.id },
      }));
    const cy = cytoscape({
      container: ref.current,
      elements: [...nodes, ...edges],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.2 },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "80px",
            padding: "8px",
            shape: "round-rectangle",
          },
        },
        {
          selector: "edge",
          style: { "target-arrow-shape": "triangle", "curve-style": "bezier" },
        },
      ],
    });
    return () => cy.destroy();
  }, [commits]);

  return <div ref={ref} style={{ height: 400, border: "1px solid #ddd", borderRadius: 8 }} />;
}
