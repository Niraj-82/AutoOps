"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { NodeStatus, RealtimeEvent, RunState } from "../types/autoops";

const CHANNEL_NAME = "autoops_node_states";
const BROADCAST_EVENT_NAME = "node_transition";
const RECONNECT_DELAY_MS = 3000;

export type RealtimeConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface UseRealtimeNodesResult {
  nodeStatusMap: Record<string, NodeStatus>;
  currentRunId: string | null;
  latestSnapshot: RunState | null;
  connectionStatus: RealtimeConnectionStatus;
}

export function useRealtimeNodes(): UseRealtimeNodesResult {
  const [nodeStatusMap, setNodeStatusMap] = useState<Record<string, NodeStatus>>({});
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<RunState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>("disconnected");

  const supabase = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setConnectionStatus("disconnected");
      return;
    }

    // Ignore stale events from before this page mounted; otherwise the UI can
    // "pick up" old runs from Supabase Realtime broadcasts.
    const mountTimeMs = Date.now();

    let channel: RealtimeChannel | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const clearReconnectTimeout = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const removeChannel = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (isUnmounted) {
        return;
      }

      setConnectionStatus("reconnecting");
      clearReconnectTimeout();

      reconnectTimeout = setTimeout(() => {
        if (isUnmounted) {
          return;
        }
        removeChannel();
        subscribe();
      }, RECONNECT_DELAY_MS);
    };

    const subscribe = () => {
      removeChannel();

      channel = supabase
        .channel(CHANNEL_NAME)
        .on("broadcast", { event: BROADCAST_EVENT_NAME }, (payload) => {
          const data = payload.payload as Partial<RealtimeEvent>;

          const nodeId = data.node_id;
          const status = data.status;
          const timestamp = data.timestamp;

          if (typeof nodeId !== "string" || typeof status !== "string" || typeof timestamp !== "string") {
            return;
          }

          const eventTimeMs = Date.parse(timestamp);
          if (Number.isNaN(eventTimeMs) || eventTimeMs < mountTimeMs) {
            return;
          }

          const stateSnapshot = data.state_snapshot as RunState | undefined;

          setNodeStatusMap((prev) => ({
            ...prev,
            [nodeId]: {
              status: status as NodeStatus["status"],
              state_snapshot: stateSnapshot ?? {},
              last_updated: timestamp,
            },
          }));

          setCurrentRunId(data.run_id ?? null);
          setLatestSnapshot(stateSnapshot ?? null);
        })
        .subscribe((status) => {
          if (isUnmounted) {
            return;
          }

          if (status === "SUBSCRIBED") {
            setConnectionStatus("connected");
            clearReconnectTimeout();
            return;
          }

          if (status === "CHANNEL_ERROR") {
            setConnectionStatus("reconnecting");
            scheduleReconnect();
            return;
          }

          if (status === "CLOSED") {
            setConnectionStatus("disconnected");
            scheduleReconnect();
          }
        });
    };

    setConnectionStatus("reconnecting");
    subscribe();

    return () => {
      isUnmounted = true;
      clearReconnectTimeout();
      removeChannel();
    };
  }, [supabase]);

  return {
    nodeStatusMap,
    currentRunId,
    latestSnapshot,
    connectionStatus,
  };
}
