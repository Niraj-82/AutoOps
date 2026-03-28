"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeLifecycleStatus, NodeStatus } from "@/types/autoops";

interface AutoOpsDAGProps {
  nodeStatusMap: Record<string, NodeStatus>;
  onNodeClick: (nodeId: string) => void;
  currentRunId: string | null;
}

interface DagNodeLayout {
  id: string;
  label: string;
  position: { x: number; y: number };
}

type DagNode = Node<{ label: string }>;

const TERMINAL_VISUAL_ONLY_NODE_IDS = new Set(["node_hard_block", "node_complete"]);

const NODE_LAYOUT: DagNodeLayout[] = [
  { id: "node_ingestion", label: "Ingestion", position: { x: 300, y: 0 } },
  { id: "node_hard_block", label: "Hard Block", position: { x: 560, y: 100 } },
  { id: "node_hitl_escalation", label: "HITL Escalation", position: { x: 40, y: 100 } },
  { id: "node_rag_retrieval", label: "RAG Retrieval", position: { x: 300, y: 120 } },
  { id: "node_plan_generation", label: "Plan Generation", position: { x: 300, y: 240 } },
  { id: "node_security_guard", label: "Security Guard", position: { x: 40, y: 380 } },
  { id: "node_hr_guard", label: "HR Guard", position: { x: 180, y: 380 } },
  { id: "node_policy_guard", label: "Policy Guard", position: { x: 320, y: 380 } },
  { id: "node_sla_guard", label: "SLA Guard", position: { x: 460, y: 380 } },
  { id: "node_fan_in_reducer", label: "Fan-In Reducer", position: { x: 300, y: 500 } },
  { id: "node_meta_governance", label: "Meta Governance", position: { x: 300, y: 600 } },
  { id: "node_execution", label: "Execution", position: { x: 300, y: 720 } },
  { id: "node_retry", label: "Retry", position: { x: 560, y: 780 } },
  { id: "node_feedback_loop", label: "Feedback Loop", position: { x: 300, y: 840 } },
  { id: "node_complete", label: "Complete", position: { x: 300, y: 940 } },
];

const NODE_STATE_CLASS_MAP: Record<NodeLifecycleStatus, string> = {
  idle: "text-slate-200",
  active: "text-cyan-100",
  completed: "text-emerald-100",
  failed: "cursor-pointer text-rose-100",
  waiting_hitl: "text-amber-100",
};

const EDGE_COLORS = {
  neutral: "#71717a",
  green: "#10b981",
  red: "#f43f5e",
  amber: "#f59e0b",
};

const DEFAULT_PROPS: AutoOpsDAGProps = {
  nodeStatusMap: {},
  onNodeClick: () => {
    return;
  },
  currentRunId: null,
};

function resolveNodeStatus(
  nodeId: string,
  nodeStatusMap: Record<string, NodeStatus>,
  currentRunId: string | null,
): NodeLifecycleStatus {
  if (!currentRunId) {
    return "idle";
  }

  if (TERMINAL_VISUAL_ONLY_NODE_IDS.has(nodeId)) {
    return "idle";
  }

  return nodeStatusMap[nodeId]?.status ?? "idle";
}

function nodeStyleByStatus(status: NodeLifecycleStatus): Node["style"] {
  if (status === "active") {
    return {
      width: 170,
      borderRadius: 14,
      border: "1px solid rgba(34, 211, 238, 0.45)",
      background: "linear-gradient(150deg, rgba(8, 47, 73, 0.82), rgba(49, 46, 129, 0.76))",
      boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28), 0 0 22px rgba(99, 102, 241, 0.35)",
      backdropFilter: "blur(6px)",
    };
  }

  if (status === "waiting_hitl") {
    return {
      width: 170,
      borderRadius: 14,
      border: "1px solid rgba(251, 191, 36, 0.46)",
      background: "linear-gradient(150deg, rgba(113, 63, 18, 0.78), rgba(120, 53, 15, 0.74))",
      boxShadow: "0 0 0 1px rgba(251, 191, 36, 0.2), 0 0 20px rgba(245, 158, 11, 0.28)",
      backdropFilter: "blur(6px)",
    };
  }

  if (status === "completed") {
    return {
      width: 170,
      borderRadius: 14,
      border: "1px solid rgba(16, 185, 129, 0.42)",
      background: "linear-gradient(160deg, rgba(6, 78, 59, 0.74), rgba(15, 118, 110, 0.64))",
      boxShadow: "0 0 0 1px rgba(16, 185, 129, 0.18), 0 10px 20px rgba(4, 47, 46, 0.3)",
      backdropFilter: "blur(4px)",
    };
  }

  if (status === "failed") {
    return {
      width: 170,
      borderRadius: 14,
      border: "1px solid rgba(251, 113, 133, 0.55)",
      background: "linear-gradient(160deg, rgba(127, 29, 29, 0.72), rgba(136, 19, 55, 0.74))",
      boxShadow: "0 0 0 1px rgba(251, 113, 133, 0.26), 0 0 24px rgba(225, 29, 72, 0.35)",
      backdropFilter: "blur(5px)",
    };
  }

  return {
    width: 170,
    borderRadius: 14,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "linear-gradient(160deg, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.65))",
    boxShadow: "0 8px 20px rgba(3, 8, 20, 0.28)",
    backdropFilter: "blur(4px)",
  };
}

export default function AutoOpsDAG({
  nodeStatusMap,
  onNodeClick,
  currentRunId,
}: AutoOpsDAGProps = DEFAULT_PROPS) {
  const nodes = useMemo<DagNode[]>(() => {
    return NODE_LAYOUT.map((node) => {
      const status = resolveNodeStatus(node.id, nodeStatusMap, currentRunId);

      return {
        id: node.id,
        position: node.position,
        data: { label: node.label },
        className: [
          "rounded-xl px-3 py-2 text-center text-xs font-semibold tracking-wide transition duration-200",
          NODE_STATE_CLASS_MAP[status],
        ].join(" "),
        style: nodeStyleByStatus(status),
      };
    });
  }, [currentRunId, nodeStatusMap]);

  const edges = useMemo<Edge[]>(() => {
    const activeNodeIds = new Set(
      Object.entries(nodeStatusMap)
        .filter(([, node]) => node.status === "active" || node.status === "waiting_hitl")
        .map(([nodeId]) => nodeId),
    );

    const withActiveFlow = (edge: Edge): Edge => {
      const sourceActive = activeNodeIds.has(edge.source);
      const targetActive = activeNodeIds.has(edge.target);
      if (!sourceActive && !targetActive) {
        return edge;
      }

      const nextStyle = {
        ...(edge.style ?? {}),
        strokeWidth: 2,
        strokeDasharray: "9 6",
        animation: "autoops-edge-flow 1.2s linear infinite",
      };

      return {
        ...edge,
        animated: true,
        style: nextStyle,
      };
    };

    return [
      {
        id: "node_ingestion-node_rag_retrieval",
        source: "node_ingestion",
        target: "node_rag_retrieval",
        label: ">80%",
        labelStyle: { fill: EDGE_COLORS.green, fontSize: 12 },
        style: { stroke: EDGE_COLORS.green, strokeWidth: 1.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.green },
      },
      {
        id: "node_ingestion-node_hard_block",
        source: "node_ingestion",
        target: "node_hard_block",
        label: "<50%",
        labelStyle: { fill: EDGE_COLORS.red, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.red,
          strokeWidth: 1.6,
          strokeDasharray: "7 5",
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.red },
      },
      {
        id: "node_ingestion-node_hitl_escalation",
        source: "node_ingestion",
        target: "node_hitl_escalation",
        label: "50-80%",
        labelStyle: { fill: EDGE_COLORS.amber, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.amber,
          strokeWidth: 1.6,
          strokeDasharray: "7 5",
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.amber },
      },
      {
        id: "node_rag_retrieval-node_plan_generation",
        source: "node_rag_retrieval",
        target: "node_plan_generation",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_plan_generation-node_security_guard",
        source: "node_plan_generation",
        target: "node_security_guard",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_plan_generation-node_hr_guard",
        source: "node_plan_generation",
        target: "node_hr_guard",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_plan_generation-node_policy_guard",
        source: "node_plan_generation",
        target: "node_policy_guard",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_plan_generation-node_sla_guard",
        source: "node_plan_generation",
        target: "node_sla_guard",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_security_guard-node_fan_in_reducer",
        source: "node_security_guard",
        target: "node_fan_in_reducer",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_hr_guard-node_fan_in_reducer",
        source: "node_hr_guard",
        target: "node_fan_in_reducer",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_policy_guard-node_fan_in_reducer",
        source: "node_policy_guard",
        target: "node_fan_in_reducer",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_sla_guard-node_fan_in_reducer",
        source: "node_sla_guard",
        target: "node_fan_in_reducer",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_fan_in_reducer-node_meta_governance",
        source: "node_fan_in_reducer",
        target: "node_meta_governance",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
      {
        id: "node_meta_governance-node_execution",
        source: "node_meta_governance",
        target: "node_execution",
        label: "approved",
        labelStyle: { fill: EDGE_COLORS.green, fontSize: 12 },
        style: { stroke: EDGE_COLORS.green, strokeWidth: 1.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.green },
      },
      {
        id: "node_meta_governance-node_plan_generation",
        source: "node_meta_governance",
        target: "node_plan_generation",
        label: "loop ↩",
        type: "smoothstep",
        labelStyle: { fill: EDGE_COLORS.amber, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.amber,
          strokeWidth: 1.6,
          strokeDasharray: "7 5",
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.amber },
      },
      {
        id: "node_execution-node_retry",
        source: "node_execution",
        target: "node_retry",
        label: "503 error",
        labelStyle: { fill: EDGE_COLORS.red, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.red,
          strokeWidth: 1.6,
          strokeDasharray: "7 5",
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.red },
      },
      {
        id: "node_retry-node_execution",
        source: "node_retry",
        target: "node_execution",
        label: "retry ↻",
        type: "smoothstep",
        labelStyle: { fill: EDGE_COLORS.amber, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.amber,
          strokeWidth: 1.8,
          strokeDasharray: "7 5",
          strokeDashoffset: 0,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.amber },
      },
      {
        id: "node_retry-node_hitl_escalation",
        source: "node_retry",
        target: "node_hitl_escalation",
        label: "2nd fail",
        labelStyle: { fill: EDGE_COLORS.red, fontSize: 12 },
        style: {
          stroke: EDGE_COLORS.red,
          strokeWidth: 1.6,
          strokeDasharray: "7 5",
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.red },
      },
      {
        id: "node_execution-node_feedback_loop",
        source: "node_execution",
        target: "node_feedback_loop",
        label: "success ✓",
        labelStyle: { fill: EDGE_COLORS.green, fontSize: 12 },
        style: { stroke: EDGE_COLORS.green, strokeWidth: 1.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.green },
      },
      {
        id: "node_feedback_loop-node_complete",
        source: "node_feedback_loop",
        target: "node_complete",
        style: { stroke: EDGE_COLORS.neutral, strokeWidth: 1.5 },
      },
    ].map(withActiveFlow);
  }, [nodeStatusMap]);

  return (
    <ReactFlowProvider>
      <div className="relative h-full min-h-[60vh] w-full overflow-hidden surface-grid">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.08),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.11),transparent_42%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-lg border border-slate-400/30 bg-slate-900/45 px-2.5 py-1.5 font-mono text-[11px] text-slate-200 backdrop-blur-md">
          Run: {currentRunId ?? "none"}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode="dark"
          className="bg-transparent"
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => onNodeClick(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(148,163,184,0.2)" gap={18} size={1} />
          <Controls className="!border !border-slate-500/45 !bg-slate-900/85 !text-slate-200" />
        </ReactFlow>

        <style jsx global>{`
          @keyframes autoops-edge-flow {
            to {
              stroke-dashoffset: -24;
            }
          }
        `}</style>
      </div>
    </ReactFlowProvider>
  );
}
