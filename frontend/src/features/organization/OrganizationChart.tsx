import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  ORG_ROLE_LABEL,
  ORG_STATUS_LABEL,
  type OrganizationTree,
  type OrgTreeNode,
} from "./organization.types";

/** Lebar kartu node (px) — sinkron dengan `w-[200px]` pada OrgChartNode. */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 132;

type OrgNodeData = Record<string, unknown> & {
  node: OrgTreeNode;
  isRoot: boolean;
};

type OrgFlowNode = FlowNode<OrgNodeData, "orgNode">;

/**
 * Kartu node bagan: nama, jabatan (title) bila ada, label role, status.
 * INACTIVE tampil redup/grayscale (bukan badge ramai).
 * Root (Ketua Event) diberi penanda halus: aksen amber.
 */
function OrgChartNode({ data, selected }: NodeProps<OrgFlowNode>) {
  const member = data.node;
  const inactive = member.status === "INACTIVE";

  return (
    <div
      className={[
        "w-[200px] rounded-lg border bg-white px-3 py-2 shadow-sm",
        data.isRoot
          ? "border-amber-300 ring-1 ring-amber-200"
          : "border-slate-200",
        selected ? "ring-2 ring-slate-900" : "",
        inactive ? "opacity-60 grayscale" : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-2 !w-2 !border-2 !border-white !bg-slate-400"
        aria-hidden="true"
      />
      {data.isRoot ? (
        <p className="text-[10px] font-semibold tracking-widest text-amber-600 uppercase">
          Ketua Event · Root
        </p>
      ) : null}
      <p
        className="truncate text-sm font-semibold text-slate-900"
        title={member.name}
      >
        {member.name}
      </p>
      {member.title ? (
        <p
          className="truncate text-xs text-slate-500 italic"
          title={member.title}
        >
          {member.title}
        </p>
      ) : null}
      <p className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-slate-600">
          {ORG_ROLE_LABEL[member.role]}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 ${inactive ? "text-slate-400" : "text-emerald-700"}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${inactive ? "bg-slate-400" : "bg-emerald-500"}`}
          />
          {ORG_STATUS_LABEL[member.status]}
        </span>
      </p>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!h-2 !w-2 !border-2 !border-white !bg-slate-400"
        aria-hidden="true"
      />
    </div>
  );
}

/** Susun node memakai dagre top-to-bottom; tanpa drag-and-drop. */
function buildLayout(tree: OrganizationTree, selectedId: string | null) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "TB",
    nodesep: 28,
    ranksep: 72,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of tree.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of tree.edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  const nodes: OrgFlowNode[] = tree.nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      id: node.id,
      type: "orgNode",
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      data: { node, isRoot: node.id === tree.root },
      selected: node.id === selectedId,
      draggable: false,
    };
  });

  const edges: FlowEdge[] = tree.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}

interface OrganizationChartProps {
  tree: OrganizationTree;
  selectedId: string | null;
  onSelect: (memberId: string) => void;
}

/**
 * Bagan struktur organisasi (React Flow + layout dagre TB).
 * Mendukung zoom/pan (Controls), Background, fitView.
 * Klik node → callback pilih anggota. Node tidak bisa di-drag
 * (pemindahan parent hanya via dialog eksplisit).
 */
export function OrganizationChart({
  tree,
  selectedId,
  onSelect,
}: OrganizationChartProps) {
  const nodeTypes = useMemo(() => ({ orgNode: OrgChartNode }), []);
  const { nodes, edges } = useMemo(
    () => buildLayout(tree, selectedId),
    [tree, selectedId],
  );

  return (
    <div
      aria-label="Bagan struktur organisasi"
      className="h-[600px] w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50"
    >
      <div className="h-full min-w-[720px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background color="#cbd5e1" gap={24} />
          <Controls showZoom showFitView showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
