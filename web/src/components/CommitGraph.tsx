import { useEffect, useRef } from "react";
import cytoscape, { type Core, type ElementDefinition, type EventObject } from "cytoscape";
import type { Commit } from "../types";

interface CommitGraphProps {
  commits: Commit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function buildElements(commits: Commit[]): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  for (const commit of commits) {
    elements.push({
      data: {
        id: commit.id,
        label: `${commit.id.slice(0, 8)}\n${commit.source}`,
      },
    });
    for (const parentId of commit.parents) {
      if (!parentId) continue;
      elements.push({
        data: {
          id: `${commit.id}->${parentId}`,
          source: parentId,
          target: commit.id,
        },
      });
    }
  }
  return elements;
}

export function CommitGraph({ commits, selectedId, onSelect }: CommitGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(commits),
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.2 },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "120px",
            "background-color": "#1f2937",
            "border-width": 2,
            "border-color": "rgba(148,163,184,0.35)",
            color: "#e2e8f0",
            padding: "8px",
            shape: "round-rectangle",
            "font-size": "11px",
          },
        },
        {
          selector: "node.is-selected",
          style: {
            "background-color": "#2563eb",
            "border-color": "#93c5fd",
            color: "#fff",
          },
        },
        {
          selector: "edge",
          style: {
            "line-color": "rgba(148,163,184,0.4)",
            "target-arrow-color": "rgba(148,163,184,0.6)",
            "target-arrow-shape": "triangle",
            width: 2,
            "curve-style": "bezier",
          },
        },
      ],
    });
    cyRef.current = cy;

    const tapHandler = (event: EventObject) => {
      const id = event.target.id();
      if (id) {
        onSelect(id);
      }
    };
    cy.on("tap", "node", tapHandler);

    return () => {
      cy.off("tap", "node", tapHandler);
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const elements = buildElements(commits);
    cy.elements().remove();
    cy.add(elements);
    cy.layout({ name: "breadthfirst", directed: true, spacingFactor: 1.2 }).run();
  }, [commits]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("is-selected");
    if (selectedId) {
      const node = cy.$(`node[id = "${selectedId}"]`);
      if (node && node.length > 0) {
        node.addClass("is-selected");
        cy.center(node);
      }
    }
  }, [selectedId]);

  return <div ref={containerRef} className="commit-graph" />;
}
