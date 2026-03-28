export interface HireProfile {
  name: string;
  role: string;
  department: string;
  seniority: string;
  employment_type: string;
  start_date: string;
  manager: string;
  required_systems: string[];
  compliance_flags: string[];
}

export interface ProposedPlanSystem {
  name: string;
  access_level: string;
  fields_to_provision: Record<string, any>;
}

export interface ProposedPlan {
  systems: ProposedPlanSystem[];
  buddy: string;
  orientation_slots: string[];
  welcome_pack: string;
  compliance_attestations: string[];
  plan_rationale: string;
}

export interface SecurityFeedback {
  verdict: "approve" | "reject";
  rule_triggered: string | null;
  corrective_action: string;
}

export interface HRFeedback {
  verdict: "approve" | "reject";
  blocking_items: string[];
  recommendation: string;
}

export interface PolicyFailedCheck {
  check_name: string;
  reason: string;
  correction: string;
}

export interface PolicyFeedback {
  verdict: "approve" | "reject";
  failed_checks: PolicyFailedCheck[];
}

export interface SLAFeedback {
  verdict: "approve" | "reject";
  feasibility: boolean;
  timeline_recommendation: string;
}

export interface AuditFeedbackEntry {
  iteration: number;
  security: SecurityFeedback;
  hr: HRFeedback;
  policy: PolicyFeedback;
  sla: SLAFeedback;
  timestamp: string;
}

export interface ExecutionLogEntry {
  system: string;
  action: string;
  mcp_tool: string;
  response: string;
  status: "success" | "failed";
  timestamp: string;
  mode?: string;
}

export interface ExecutionReceipt {
  all_succeeded: boolean;
  retry_count: number;
  provisioned_accounts?: Record<string, string>;
  buddy_confirmation?: string;
  orientation_events?: string[];
  welcome_pack_status?: string;
  audit_log_id?: string;
}

export interface MetaGovernanceDecision {
  routing: "advance" | "loop" | "escalate";
  priority_rule_applied: string;
  all_rejections?: string[];
  reason: string;
}

export interface RunState {
  payload_type: string;
  raw_payload: Record<string, any>;
  raw_body_bytes_hex: string;
  hire_profile: HireProfile | Record<string, any>;
  payload_confidence: number;
  integrity_check_passed: boolean;
  historical_context: any;
  similarity_gate_passed: boolean;
  proposed_plan: ProposedPlan | Record<string, any>;
  reflection_passed: boolean;
  pydantic_retry_count: number;
  security_feedback: SecurityFeedback | Record<string, any>;
  hr_feedback: HRFeedback | Record<string, any>;
  policy_feedback: PolicyFeedback | Record<string, any>;
  sla_feedback: SLAFeedback | Record<string, any>;
  audit_feedback: AuditFeedbackEntry[];
  meta_governance_decision: MetaGovernanceDecision | Record<string, any>;
  condenser_summary: string;
  iteration_count: number;
  execution_log: ExecutionLogEntry[];
  hitl_status: "pending" | "approved" | "rejected" | "timed_out";
  hitl_approvers: string[];
  zero_shot_success: boolean;
  execution_receipt: ExecutionReceipt | Record<string, any>;
}

export interface RunStateResponse {
  status: string;
  final_state?: RunState;
  detail?: string;
}

export interface AuditTrailResponse {
  run_id: string;
  status: string;
  audit_feedback: AuditFeedbackEntry[];
  meta_governance_decision: MetaGovernanceDecision | Record<string, any>;
  execution_log: ExecutionLogEntry[];
  hitl_status: string;
  iteration_count: number;
}

export type NodeLifecycleStatus =
  | "idle"
  | "active"
  | "completed"
  | "failed"
  | "waiting_hitl";

export interface NodeStatus {
  status: NodeLifecycleStatus;
  state_snapshot: RunState | Record<string, any>;
  last_updated: string;
}

export interface MetricsSummary {
  total_runs: number;
  completed: number;
  errored: number;
  in_progress: number;
  hitl_pending: number;
}

export interface RealtimeEvent {
  run_id: string;
  node_id: string;
  status: NodeLifecycleStatus;
  state_snapshot: Record<string, any>;
  timestamp: string;
}

// Legacy UI compatibility types.
export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rejected";

export interface AutoOpsNode {
  id: string;
  runId: string;
  key: string;
  label: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  details?: string;
}

export interface HITLAction {
  decision: "approve" | "reject";
  comment?: string;
}

export interface SignalItem {
  id: string;
  title: string;
  value: string;
  severity: "low" | "medium" | "high";
}

export interface ImpactItem {
  id: string;
  label: string;
  summary: string;
}

export interface RejectedItem {
  id: string;
  nodeId: string;
  reason: string;
  createdAt: string;
}
