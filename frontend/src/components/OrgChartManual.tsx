import React, { useMemo } from "react";
import type { Employee } from "../utils/org";
import { EmployeeCard } from "./EmployeeCard";
import {
    buildHierarchicalTree,
    calculateDepartmentLaneLayout,
    calculateTreeLayout,
    DEFAULT_LAYOUT_CONFIG,
    type LayoutNode
} from "../utils/layout";

interface OrgChartManualProps {
    employees: Employee[];
    isDepartmentLaneView: boolean;
    selectedEmployeeId: string | null;
    hoveredEmployeeId: string | null;
    onSelect: (id: string) => void;
    onHover: (id: string | null) => void;
    onHoverMove?: (pos: { x: number; y: number } | null) => void;
    zoomScale: number;
    matchingIds?: Set<string>;
    onDimensionsChange?: (dims: { width: number; height: number }) => void;
}

export function OrgChartManual({
    employees,
    isDepartmentLaneView,
    selectedEmployeeId,
    hoveredEmployeeId,
    onSelect,
    onHover,
    onHoverMove,
    zoomScale,
    matchingIds,
    onDimensionsChange
}: OrgChartManualProps) {
    // 1. Build and calculate layout based on mode
    const { root, orphans, nodesArray, maxX, maxY } = useMemo(() => {
        const { root, orphans } = buildHierarchicalTree(employees);
        if (!root) {
            return { root: null, orphans: [], nodesArray: [], maxX: 0, maxY: 0 };
        }

        let nodesArray: LayoutNode[] = [];
        if (isDepartmentLaneView) {
            calculateDepartmentLaneLayout(root, DEFAULT_LAYOUT_CONFIG);
            // Flatten tree for lane view
            const flatten = (n: LayoutNode) => {
                nodesArray.push(n);
                n.children.forEach(flatten);
            };
            flatten(root);
        } else {
            // Hierarchical Tree Layout
            calculateTreeLayout(root, DEFAULT_LAYOUT_CONFIG);
            const flatten = (n: LayoutNode) => {
                nodesArray.push(n);
                n.children.forEach(flatten);
            };
            flatten(root);
        }

        // Find diagram dimensions
        let maxX = 0;
        let maxY = 0;
        nodesArray.forEach(n => {
            if (n.x > maxX) maxX = n.x;
            if (n.y > maxY) maxY = n.y;
        });

        return { root, orphans, nodesArray, maxX, maxY };
    }, [employees, isDepartmentLaneView]);

    if (nodesArray.length === 0) {
        return <p className="empty-state">No employees matching the current filters.</p>;
    }

    const { nodeWidth, nodeHeight, levelGap } = DEFAULT_LAYOUT_CONFIG;

    // Render SVG Edge connecting parent to child using orthogonal routing
    const renderEdge = (source: LayoutNode, target: LayoutNode) => {
        // Connect bottoms of parents to tops of children
        const startX = source.x + nodeWidth / 2;
        const startY = source.y + nodeHeight;
        const endX = target.x + nodeWidth / 2;
        const endY = target.y;

        // Midpoint for the horizontal bend
        const midY = startY + levelGap / 2;

        const pathData = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;

        return (
            <path
                key={`${source.id}->${target.id}`}
                d={pathData}
                stroke="var(--color-primary-strong)"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="org-link"
                style={{ opacity: 0.6 }}
            />
        );
    };

    const renderEdges = (node: LayoutNode): React.ReactElement[] => {
        const lines: React.ReactElement[] = node.children.map(child => renderEdge(node, child));
        node.children.forEach(child => {
            lines.push(...renderEdges(child));
        });
        return lines;
    };

    const allEdges = useMemo(() => {
        if (isDepartmentLaneView) {
            return root ? renderEdges(root) : [];
        } else {
            // In layered/hero mode, we need to gather edges from all nodes 
            // since there isn't necessarily a single traversal root.
            const lines: React.ReactElement[] = [];
            nodesArray.forEach(node => {
                node.children.forEach(child => {
                    lines.push(renderEdge(node, child));
                });
            });
            return lines;
        }
    }, [isDepartmentLaneView, root, nodesArray]);

    const canvasWidth = maxX + nodeWidth + 200;
    const canvasHeight = maxY + nodeHeight + 200;

    React.useEffect(() => {
        onDimensionsChange?.({ width: canvasWidth, height: canvasHeight });
    }, [canvasWidth, canvasHeight, onDimensionsChange]);

    return (
        <div
            style={{
                position: "relative",
                width: `${canvasWidth}px`,
                height: `${canvasHeight}px`,
                transformOrigin: "0 0",
                transition: "width 0.3s ease, height 0.3s ease"
            }}
        >

            <svg
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    zIndex: 1
                }}
            >
                {allEdges}
            </svg>

            {/* 2. HTML layer for actual DOM nodes */}
            {nodesArray.map(node => (
                <div
                    key={node.id}
                    style={{
                        position: "absolute",
                        top: node.y,
                        left: node.x,
                        width: nodeWidth,
                        height: nodeHeight,
                        transition: "all 0.3s ease",
                        zIndex: 2
                    }}
                >
                    <div className="node-shell" style={{ width: "100%", height: "100%" }}>
                        <EmployeeCard
                            employee={node.employee}
                            selected={node.id === selectedEmployeeId || node.id === hoveredEmployeeId}
                            isMatch={matchingIds ? matchingIds.has(node.id) : true}
                            compact={false}
                            zoomScale={zoomScale}
                            onClick={(id) => onSelect(id)}
                            onHover={onHover}
                            onHoverMove={onHoverMove}
                        />
                    </div>
                </div>
            ))}

            {/* 3. Optional: display orphans warning if any detected */}
            {orphans.length > 0 && (
                <div style={{ position: "absolute", top: 20, right: 20, background: "#fee2e2", padding: "10px", borderRadius: "8px", border: "1px solid #ef4444" }}>
                    <strong>Warning:</strong> {orphans.length} orphan nodes detected (disconnected hierarchy).
                </div>
            )}
        </div>
    );
}
