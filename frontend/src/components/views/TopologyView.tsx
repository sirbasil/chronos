import React, { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  Node,
  Edge,
  NodeProps,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import { ChronosRun, ChronosEvent, ServiceSummary } from '../../types/events';
import { TopologyResponse } from '../../types/api';
import { AppMode } from '../../types/api';
import { Network, Server, Activity, AlertTriangle, ShieldCheck } from 'lucide-react';

interface TopologyNodeData {
  service: ServiceSummary;
  isSelected: boolean;
  onSelect: (service: ServiceSummary) => void;
  [key: string]: unknown;
}

// Custom Bertone / Lamborghini Athon Instrument Node
const ServiceNodeComponent: React.FC<NodeProps<Node<TopologyNodeData>>> = ({ data }) => {
  const { service, isSelected, onSelect } = data;

  const getStatusColor = () => {
    switch (service.status) {
      case 'HEALTHY':
        return {
          border: 'border-[#22c55e]',
          text: 'text-[#4ade80]',
          bg: 'bg-[#051a08]',
          lamp: 'bg-[#22c55e] shadow-[0_0_8px_#22c55e]',
        };
      case 'DEGRADED':
        return {
          border: 'border-chrono-amber',
          text: 'text-chrono-amber',
          bg: 'bg-[#1f1403]',
          lamp: 'bg-chrono-amber shadow-[0_0_8px_#ff9e00]',
        };
      case 'FAILED':
        return {
          border: 'border-chrono-red',
          text: 'text-chrono-red',
          bg: 'bg-[#240808]',
          lamp: 'bg-chrono-red shadow-[0_0_8px_#ff3333]',
        };
      default:
        return {
          border: 'border-chrono-grid',
          text: 'text-chrono-muted',
          bg: 'bg-[#080d07]',
          lamp: 'bg-chrono-muted shadow-[0_0_4px_#6b7280]',
        };
    }
  };

  const colors = getStatusColor();

  return (
    <div
      onClick={() => onSelect(service)}
      className={`min-w-[210px] bg-[#070b05] border transition-all cursor-pointer select-none rounded-none ${
        isSelected
          ? 'border-chrono-phosphor shadow-[0_0_14px_rgba(184,255,0,0.5)] bg-[#0b1408]'
          : `${colors.border} hover:border-chrono-phosphor`
      }`}
    >
      {/* Input Handle (Left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-chrono-phosphor !border !border-black"
      />

      {/* Node Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#030602] border-b border-chrono-grid">
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-chrono-phosphor" />
          <span className="font-ui font-bold text-xs tracking-wider text-chrono-text uppercase">
            {service.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${colors.lamp}`} />
          <span className={`text-[9px] font-mono font-bold ${colors.text}`}>
            {service.status}
          </span>
        </div>
      </div>

      {/* Node Telemetry Body */}
      <div className="p-2.5 space-y-1.5 font-mono text-[10px]">
        <div className="flex justify-between items-center text-chrono-muted border-b border-[#121c0e] pb-1">
          <span>PORT:</span>
          <span className="text-chrono-phosphor font-bold">:{service.port}</span>
        </div>
        <div className="flex justify-between items-center text-chrono-muted border-b border-[#121c0e] pb-1">
          <span>INBOUND / OUTBOUND:</span>
          <span className="text-chrono-text">
            {service.inbound_calls} / {service.outbound_calls}
          </span>
        </div>
        <div className="flex justify-between items-center text-chrono-muted">
          <span>OBSERVED ERRORS:</span>
          <span className={service.error_count > 0 ? 'text-chrono-red font-bold' : 'text-chrono-text'}>
            {service.error_count}
          </span>
        </div>
      </div>

      {/* Node Footer */}
      <div className="px-2.5 py-1 bg-[#020402] border-t border-chrono-grid/60 flex items-center justify-between text-[8px] font-mono text-chrono-muted">
        <span>{service.compose_service}</span>
        <span className="text-chrono-phosphor/80 font-bold tracking-widest uppercase">
          {isSelected ? 'INSPECTING' : 'CLICK TO INSPECT'}
        </span>
      </div>

      {/* Output Handle (Right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-chrono-phosphor !border !border-black"
      />
    </div>
  );
};

const nodeTypes = {
  serviceNode: ServiceNodeComponent,
};

interface TopologyViewProps {
  run: ChronosRun;
  services: ServiceSummary[];
  topologyData?: TopologyResponse | null;
  mode: AppMode;
  selectedServiceId?: string | null;
  onSelectService: (service: ServiceSummary) => void;
  onSelectEvent?: (event: ChronosEvent) => void;
  onReturnToMonitor: () => void;
}

export const TopologyView: React.FC<TopologyViewProps> = ({
  run,
  services,
  topologyData,
  mode,
  selectedServiceId,
  onSelectService,
  onSelectEvent,
  onReturnToMonitor,
}) => {
  // Build Flow Nodes
  const nodes = useMemo<Node<TopologyNodeData>[]>(() => {
    // If we have API topology nodes, map them. Otherwise fallback to run's services
    const activeServiceIds = topologyData?.nodes?.length
      ? topologyData.nodes.map((n) => n.service_id)
      : services.map((s) => s.id);

    // Filter relevant services
    const relevantServices = services.filter((s) => activeServiceIds.includes(s.id));

    // DAG layout positioning
    return relevantServices.map((service, index) => {
      let x = 120;
      let y = 140;

      if (service.id === 'orders') {
        x = 80;
        y = 160;
      } else if (service.id === 'payment') {
        x = 440;
        y = 100;
      } else if (service.id === 'postgres') {
        x = 440;
        y = 260;
      } else {
        x = 100 + (index % 3) * 320;
        y = 100 + Math.floor(index / 3) * 160;
      }

      return {
        id: service.id,
        type: 'serviceNode',
        position: { x, y },
        data: {
          service,
          isSelected: selectedServiceId === service.id,
          onSelect: onSelectService,
        },
      };
    });
  }, [services, topologyData, selectedServiceId, onSelectService]);

  // Build Flow Edges
  const edges = useMemo<Edge[]>(() => {
    if (topologyData?.edges?.length) {
      return topologyData.edges.map((edge, i) => ({
        id: `e-${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        animated: true,
        style: {
          stroke: '#b8ff00',
          strokeWidth: 2,
          filter: 'drop-shadow(0 0 4px rgba(184,255,0,0.8))',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#b8ff00',
          width: 14,
          height: 14,
        },
        label: edge.event_type || 'SERVICE_CALL',
        labelStyle: {
          fill: '#b8ff00',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          fontWeight: 700,
        },
        labelBgStyle: {
          fill: '#050a04',
          stroke: '#1b2d16',
          strokeWidth: 1,
          rx: 2,
        },
      }));
    }

    // Default: if run has SERVICE_CALL events, synthesize edges
    const serviceCalls = run.events.filter((e) => e.event_type === 'SERVICE_CALL');
    const uniquePairs = new Map<string, { source: string; dest: string }>();

    for (const call of serviceCalls) {
      const dest = call.payload?.destination_service as string | undefined;
      if (dest) {
        uniquePairs.set(`${call.service_id}->${dest}`, {
          source: call.service_id,
          dest,
        });
      }
    }

    return Array.from(uniquePairs.values()).map((pair, idx) => ({
      id: `edge-${pair.source}-${pair.dest}-${idx}`,
      source: pair.source,
      target: pair.dest,
      animated: true,
      style: {
        stroke: '#b8ff00',
        strokeWidth: 2,
        filter: 'drop-shadow(0 0 4px rgba(184,255,0,0.8))',
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#b8ff00',
        width: 14,
        height: 14,
      },
      label: 'SERVICE_CALL',
      labelStyle: {
        fill: '#b8ff00',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: '#050a04',
        stroke: '#1b2d16',
        strokeWidth: 1,
        rx: 2,
      },
    }));
  }, [topologyData, run.events]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>(nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>(edges);

  useEffect(() => {
    setFlowNodes(nodes);
  }, [nodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(edges);
  }, [edges, setFlowEdges]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (onSelectEvent) {
        const matchingEvent = run.events.find(
          (e) =>
            e.event_type === 'SERVICE_CALL' &&
            e.service_id === edge.source &&
            (e.payload?.destination_service === edge.target || !e.payload?.destination_service)
        );
        if (matchingEvent) {
          onSelectEvent(matchingEvent);
        }
      }
    },
    [onSelectEvent, run.events]
  );

  const hasData = nodes.length > 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#030602] text-chrono-text relative overflow-hidden select-none">
      {/* 1. Header Toolbar */}
      <div className="h-10 bg-[#070b05] border-b border-chrono-grid flex items-center justify-between px-4 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <Network className="w-4 h-4 text-chrono-phosphor drop-shadow-[0_0_6px_#b8ff00]" />
          <div className="font-ui font-bold text-xs tracking-wider text-chrono-phosphor flex items-center gap-2">
            SERVICE TOPOLOGY <span className="text-[10px] text-chrono-muted font-mono">// OBSERVED RUN DAG</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 bg-[#0b1009] border border-chrono-grid text-chrono-text">
            RUN: <span className="text-chrono-phosphor font-bold">{run.run_id.slice(0, 8)}</span>
          </span>
          {mode === 'LIVE' ? (
            <span className="text-[9px] font-mono px-2 py-0.5 bg-[#051a08] border border-[#22c55e] text-[#4ade80] flex items-center gap-1 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              LIVE TOPOLOGY
            </span>
          ) : (
            <span className="text-[9px] font-mono px-2 py-0.5 bg-[#1f1403] border border-chrono-amber text-chrono-amber flex items-center gap-1 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-chrono-amber" />
              PREVIEW FIXTURE
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="font-mono text-[10px] text-chrono-muted">
            NODES: <span className="text-chrono-phosphor font-bold">{nodes.length}</span> | EDGES:{' '}
            <span className="text-chrono-phosphor font-bold">{edges.length}</span>
          </div>
          <button
            onClick={onReturnToMonitor}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold bg-[#0c1209] border border-chrono-grid hover:border-chrono-phosphor text-chrono-muted hover:text-chrono-phosphor transition-colors"
          >
            RETURN TO MONITOR
          </button>
        </div>
      </div>

      {/* 2. Main Graph Canvas or Empty State */}
      <div className="flex-1 relative overflow-hidden w-full h-full">
        {hasData ? (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onEdgeClick={handleEdgeClick}
            fitView
            attributionPosition="bottom-right"
            className="bg-[#030602]"
          >
            <Background color="#162512" gap={24} size={1.2} />
            <Controls className="!bg-[#070b05] !border !border-chrono-grid !fill-chrono-text" />
          </ReactFlow>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-[#050804]">
            <div className="p-4 bg-[#0a0f07] border border-chrono-grid max-w-md shadow-2xl">
              <AlertTriangle className="w-8 h-8 text-chrono-amber mx-auto mb-3 drop-shadow-[0_0_8px_#ff9e00]" />
              <div className="font-ui font-bold text-sm tracking-widest text-chrono-phosphor uppercase mb-2">
                NO TOPOLOGY RECORDED
              </div>
              <p className="font-mono text-xs text-chrono-muted leading-relaxed mb-4">
                No inter-service RPC telemetry or events were recorded for Run{' '}
                <span className="text-chrono-text font-bold">{run.run_id}</span>.
              </p>
              <div className="p-3 bg-[#030502] border border-chrono-grid/60 text-left font-mono text-[11px] text-chrono-muted space-y-1 mb-4">
                <div className="flex items-center gap-2 text-chrono-text">
                  <Activity className="w-3.5 h-3.5 text-chrono-phosphor" />
                  <span>Run Status: {run.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-chrono-muted" />
                  <span>Recorded Events: {run.events.length}</span>
                </div>
              </div>
              <button
                onClick={onReturnToMonitor}
                className="px-4 py-1.5 bg-[#121c0e] border border-chrono-phosphor text-chrono-phosphor font-mono text-xs font-bold hover:bg-chrono-phosphor hover:text-black transition-colors"
              >
                RETURN TO INSTRUMENT MONITOR
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Bottom Information Banner */}
      <div className="h-7 bg-[#070b05] border-t border-chrono-grid flex items-center justify-between px-4 text-[10px] font-mono text-chrono-muted shrink-0">
        <div className="flex items-center gap-3">
          <span>INTERACTION HINT: CLICK SERVICE NODE OR EDGE TO INSPECT TELEMETRY PAYLOAD</span>
        </div>
        <div className="flex items-center gap-2">
          <span>TOPOLOGY GRAPH ENGINE:</span>
          <span className="text-chrono-phosphor font-bold">REACT FLOW // XYFLOW</span>
        </div>
      </div>
    </div>
  );
};
