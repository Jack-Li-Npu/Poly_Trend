"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { MarketData } from "@/types/polymarket";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  eventId?: string;
  market: MarketData;
  pinned: boolean;
  connectionCount: number;
}

interface Edge {
  source: string;
  target: string;
  type: "correlation" | "causality" | "exclusion";
  relationType?: "intra-event" | "inter-event";
  strength: number;
  reason?: string;
}

interface InsightGraphProps {
  markets: MarketData[];
  highCorrelationPairs: Array<{ 
    marketA: MarketData; 
    marketB: MarketData; 
    correlation: number; 
    relationType?: "intra-event" | "inter-event" 
  }>;
}

// Physics constants
const REPULSION = 5000;
const SPRING_STRENGTH = 0.01;
const IDEAL_LENGTH = 100;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.001;
const EVENT_CLUSTER_STRENGTH = 0.05;

// Visual constants
const EVENT_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function InsightGraph({ markets, highCorrelationPairs }: InsightGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<number>();
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Event grouping
  const eventGroups = React.useMemo(() => {
    const groups = new Map<string, MarketData[]>();
    markets.forEach(m => {
      const key = m.eventId || 'uncategorized';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    });
    return groups;
  }, [markets]);

  const eventIds = Array.from(eventGroups.keys());
  
  // Get color for event
  const getEventColor = useCallback((eventId?: string) => {
    if (!eventId) return '#6b7280'; // gray for uncategorized
    const index = eventIds.indexOf(eventId);
    return EVENT_COLORS[index % EVENT_COLORS.length];
  }, [eventIds]);

  // Get node size based on connections and probability - reduced for better visibility
  const getNodeSize = useCallback((node: Node) => {
    const baseSize = 8; // Reduced from 12
    const sizeMultiplier = 1 + (node.connectionCount * 0.15) + (node.market.probability / 400);
    return baseSize * Math.min(sizeMultiplier, 2);
  }, []);

  // Initialize layout
  useEffect(() => {
    if (markets.length === 0) return;

    const width = containerRef.current?.offsetWidth || 800;
    const height = containerRef.current?.offsetHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Build edges first to count connections
    const newEdges: Edge[] = [];
    const connectionCounts = new Map<string, number>();

    // Add correlation edges only
    highCorrelationPairs.forEach(p => {
      if (p.marketA && p.marketB) {
        newEdges.push({
          source: p.marketA.id,
          target: p.marketB.id,
          type: "correlation",
          relationType: p.relationType,
          strength: p.correlation
        });
        connectionCounts.set(p.marketA.id, (connectionCounts.get(p.marketA.id) || 0) + 1);
        connectionCounts.set(p.marketB.id, (connectionCounts.get(p.marketB.id) || 0) + 1);
      }
    });

    // Initialize nodes with event-based clustering
    const newNodes: Node[] = [];
    const groupCount = eventGroups.size;
    const groupRadius = Math.min(width, height) * 0.25;

    let groupIdx = 0;
    eventGroups.forEach((groupMarkets, eventId) => {
      const angle = (groupIdx / groupCount) * Math.PI * 2;
      const groupX = centerX + groupRadius * Math.cos(angle);
      const groupY = centerY + groupRadius * Math.sin(angle);
      
      // Position nodes within group
      const localRadius = Math.min(50, 30 + groupMarkets.length * 3);
      groupMarkets.forEach((m, i) => {
        const localAngle = (i / groupMarkets.length) * Math.PI * 2;
        newNodes.push({
          id: m.id,
          label: m.title,
          x: groupX + localRadius * Math.cos(localAngle) + (Math.random() - 0.5) * 20,
          y: groupY + localRadius * Math.sin(localAngle) + (Math.random() - 0.5) * 20,
          vx: 0,
          vy: 0,
          eventId: m.eventId,
          market: m,
          pinned: false,
          connectionCount: connectionCounts.get(m.id) || 0
        });
      });
      groupIdx++;
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [markets, highCorrelationPairs, eventGroups]);

  // Physics simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const width = containerRef.current?.offsetWidth || 800;
    const height = containerRef.current?.offsetHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    let iterationCount = 0;
    const maxIterations = 300;

    const simulate = () => {
      if (iterationCount++ > maxIterations) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
        return;
      }

      setNodes(prevNodes => {
        const newNodes = [...prevNodes];

        // Apply forces
        newNodes.forEach((n1, i) => {
          if (n1.pinned) return;

          // Repulsion between all nodes
          newNodes.forEach((n2, j) => {
            if (i >= j) return;
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = REPULSION / (dist * dist);
            
            if (!n1.pinned) {
              n1.vx -= force * dx / dist;
              n1.vy -= force * dy / dist;
            }
            if (!n2.pinned) {
              n2.vx += force * dx / dist;
              n2.vy += force * dy / dist;
            }
          });

          // Event clustering force
          if (n1.eventId) {
            const eventNodes = newNodes.filter(n => n.eventId === n1.eventId && n.id !== n1.id);
            if (eventNodes.length > 0) {
              let avgX = 0, avgY = 0;
              eventNodes.forEach(n => {
                avgX += n.x;
                avgY += n.y;
              });
              avgX /= eventNodes.length;
              avgY /= eventNodes.length;
              
              const dx = avgX - n1.x;
              const dy = avgY - n1.y;
              n1.vx += dx * EVENT_CLUSTER_STRENGTH;
              n1.vy += dy * EVENT_CLUSTER_STRENGTH;
            }
          }

          // Center gravity
          const dx = centerX - n1.x;
          const dy = centerY - n1.y;
          n1.vx += dx * CENTER_GRAVITY;
          n1.vy += dy * CENTER_GRAVITY;
        });

        // Attraction along edges
        edges.forEach(edge => {
          const source = newNodes.find(n => n.id === edge.source);
          const target = newNodes.find(n => n.id === edge.target);
          if (!source || !target) return;

          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - IDEAL_LENGTH) * SPRING_STRENGTH * Math.abs(edge.strength);
          
          if (!source.pinned) {
            source.vx += force * dx / dist;
            source.vy += force * dy / dist;
          }
          if (!target.pinned) {
            target.vx -= force * dx / dist;
            target.vy -= force * dy / dist;
          }
        });

        // Apply velocities with damping
        newNodes.forEach(n => {
          if (n.pinned) return;
          
          n.x += n.vx;
          n.y += n.vy;
          n.vx *= DAMPING;
          n.vy *= DAMPING;

          // Keep nodes within bounds with padding
          const padding = 50;
          n.x = Math.max(padding, Math.min(width - padding, n.x));
          n.y = Math.max(padding, Math.min(height - padding, n.y));
        });

        return newNodes;
      });

      animationRef.current = requestAnimationFrame(simulate);
    };

    animationRef.current = requestAnimationFrame(simulate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [nodes.length, edges]);

  // Handle node hover
  const handleNodeHover = (node: Node | null) => {
    if (!node) {
      setHighlightedNodes(new Set());
      return;
    }

    const connected = new Set<string>([node.id]);
    edges.forEach(edge => {
      if (edge.source === node.id) connected.add(edge.target);
      if (edge.target === node.id) connected.add(edge.source);
    });
    setHighlightedNodes(connected);
  };

  // Handle node drag
  const handleNodeDragStart = (e: React.MouseEvent, node: Node) => {
    e.stopPropagation();
    setNodes(prev => prev.map(n => 
      n.id === node.id ? { ...n, pinned: true } : n
    ));
  };

  const handleNodeDrag = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - transform.x) / transform.scale;
    const y = (e.clientY - rect.top - transform.y) / transform.scale;
    
    setNodes(prev => prev.map(n => 
      n.id === nodeId ? { ...n, x, y, vx: 0, vy: 0 } : n
    ));
  };

  // Handle canvas pan
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).closest('svg') === svgRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  // Handle zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, transform.scale * delta));
    setTransform(prev => ({ ...prev, scale: newScale }));
  };

  // Reset view
  const resetView = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
    setNodes(prev => prev.map(n => ({ ...n, pinned: false })));
  };

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-[700px] bg-neutral-50 dark:bg-neutral-900/30 rounded-3xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onWheel={handleWheel}
    >
      {/* SVG for edges */}
      <svg 
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        }}
      >
        {/* Render edges */}
        {edges.map((edge, i) => {
          const sourceNode = nodes.find(n => n.id === edge.source);
          const targetNode = nodes.find(n => n.id === edge.target);
          if (!sourceNode || !targetNode) return null;

          const isIntraEvent = edge.relationType === 'intra-event';
          const isHighlighted = highlightedNodes.has(edge.source) && highlightedNodes.has(edge.target);
          
          return (
            <line
              key={`edge-${i}`}
              x1={sourceNode.x}
              y1={sourceNode.y}
              x2={targetNode.x}
              y2={targetNode.y}
              stroke={edge.strength > 0 ? "#10b981" : "#ef4444"}
              strokeWidth={isIntraEvent ? 1 : (isHighlighted ? 2.5 : Math.abs(edge.strength) * 2)}
              strokeOpacity={isHighlighted ? 0.7 : (isIntraEvent ? 0.15 : 0.3)}
              strokeDasharray={isIntraEvent ? "2,2" : "4,4"}
            />
          );
        })}
      </svg>

      {/* Render nodes */}
      <div 
        className="absolute inset-0"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        }}
      >
        {nodes.map((node) => {
          const size = getNodeSize(node);
          const isHighlighted = highlightedNodes.size === 0 || highlightedNodes.has(node.id);
          const isSelected = selectedNode?.id === node.id;
          
          return (
            <div
              key={node.id}
              title={node.market.title}
              onMouseDown={(e) => handleNodeDragStart(e, node)}
              onMouseMove={(e) => {
                if (node.pinned && e.buttons === 1) {
                  handleNodeDrag(e, node.id);
                }
              }}
              onMouseUp={() => {
                setNodes(prev => prev.map(n => 
                  n.id === node.id ? { ...n, pinned: false } : n
                ));
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedNode(node);
              }}
              onMouseEnter={() => handleNodeHover(node)}
              onMouseLeave={() => handleNodeHover(null)}
              style={{ 
                left: node.x, 
                top: node.y,
                width: size * 2,
                height: size * 2,
                opacity: isHighlighted ? 1 : 0.3,
                backgroundColor: getEventColor(node.eventId),
                borderColor: isSelected ? '#ffffff' : getEventColor(node.eventId)
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl flex items-center justify-center cursor-pointer transition-all hover:scale-110 z-10 ${
                isSelected 
                  ? "border-4 border-white dark:border-neutral-800 scale-110 shadow-2xl" 
                  : "border-2 shadow-lg"
              }`}
            >
              {node.market.image ? (
                <img 
                  src={node.market.image} 
                  className="w-full h-full rounded-xl object-cover" 
                  alt="" 
                />
              ) : (
                <span className="text-xs font-black text-white" style={{ fontSize: size / 3 }}>
                  {node.market.probability}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Node details popup */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="absolute top-4 right-4 w-72 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl z-50"
          >
            <div className="flex items-start justify-between mb-3">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: getEventColor(selectedNode.eventId) }}
              />
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNode(null);
                }}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 text-xl leading-none"
              >
                ×
              </button>
            </div>
            
            <h4 className="text-sm font-black mb-3 leading-tight pr-6">{selectedNode.market.title}</h4>
            
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
              <span className="text-3xl font-black text-blue-600">{selectedNode.market.probability}%</span>
              <span className="text-[10px] text-neutral-400 font-bold uppercase">概率</span>
            </div>
            
            {selectedNode.market.eventTitle && (
              <div className="mb-3 p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                <span className="text-[8px] font-black text-neutral-400 uppercase block mb-1">所属事件</span>
                <p className="text-[10px] font-bold leading-tight line-clamp-2">{selectedNode.market.eventTitle}</p>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
              <div>
                <span className="text-neutral-400 uppercase font-bold block mb-1">交易量</span>
                <span className="font-black">{selectedNode.market.volume}</span>
              </div>
              <div>
                <span className="text-neutral-400 uppercase font-bold block mb-1">关联数</span>
                <span className="font-black">{selectedNode.connectionCount}</span>
              </div>
            </div>
            
            <a
              href={`https://polymarket.com/event/${selectedNode.market.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2 bg-blue-500 hover:bg-blue-600 text-white text-center rounded-xl text-xs font-bold transition-colors"
            >
              查看详情 →
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-40">
        <button
          onClick={resetView}
          className="px-3 py-2 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-bold hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shadow-lg"
        >
          重置视图
        </button>
        <div className="px-3 py-2 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-bold shadow-lg">
          缩放: {(transform.scale * 100).toFixed(0)}%
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-lg max-w-md">
        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-green-500"></div>
            <span className="text-[10px] font-bold">正相关</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-red-500"></div>
            <span className="text-[10px] font-bold">负相关</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 border-t border-neutral-400 border-dashed"></div>
            <span className="text-[10px] font-bold">同事件</span>
          </div>
        </div>
        
        {eventIds.length > 1 && eventIds.length <= 8 && (
          <>
            <div className="border-t border-neutral-200 dark:border-neutral-800 my-2"></div>
            <div className="text-[8px] font-black text-neutral-400 uppercase mb-2">事件分组</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-h-32 overflow-y-auto">
              {Array.from(eventGroups.entries()).slice(0, 8).map(([eventId, markets]) => {
                const eventTitle = markets[0]?.eventTitle || eventId;
                return (
                  <div key={eventId} className="flex items-center gap-2">
                    <div 
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getEventColor(eventId) }}
                    />
                    <span className="text-[9px] font-medium truncate" title={eventTitle}>
                      {eventTitle.length > 20 ? eventTitle.substring(0, 20) + '...' : eventTitle}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
