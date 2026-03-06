import React, { useMemo } from "react";
import type { Employee } from "../utils/org";
import { EmployeeCard } from "./EmployeeCard";
import {
    buildHierarchicalTree,
    COMFORT_LAYOUT_CONFIG,
    COMPACT_LAYOUT_CONFIG,
    calculateDepartmentLaneLayout,
    calculateTreeLayout,
    type LayoutConfig,
    type LayoutNode
} from "../utils/layout";

interface OrgChartManualProps {
    employees: Employee[];
    isDepartmentLaneView: boolean;
    exportMode?: boolean;
    isCompactLayout?: boolean;
    showDepartmentHeatmap?: boolean;
    selectedEmployeeId: string | null;
    hoveredEmployeeId: string | null;
    onSelect: (id: string) => void;
    onHover: (id: string | null) => void;
    onHoverMove?: (pos: { x: number; y: number } | null) => void;
    zoomScale: number;
    matchingIds?: Set<string>;
    onDimensionsChange?: (dims: { width: number; height: number }) => void;
}

const departmentHue = (department: string) => {
    let hash = 0;
    for (let i = 0; i < department.length; i += 1) {
        hash = (hash * 31 + department.charCodeAt(i)) % 360;
    }
    return hash;
};

export function OrgChartManual({
    employees,
    isDepartmentLaneView,
    exportMode = false,
    isCompactLayout = true,
    showDepartmentHeatmap = false,
    selectedEmployeeId,
    hoveredEmployeeId,
    onSelect,
    onHover,
    onHoverMove,
    zoomScale,
    matchingIds,
    onDimensionsChange
}: OrgChartManualProps) {
    const layoutConfig: LayoutConfig = isCompactLayout ? COMPACT_LAYOUT_CONFIG : COMFORT_LAYOUT_CONFIG;

    // 1. Build and calculate layout based on mode
    const { root, orphans, nodesArray, minX, minY, maxX, maxY } = useMemo(() => {
        const { root, orphans } = buildHierarchicalTree(employees);
        if (!root) {
            return { root: null, orphans: [], nodesArray: [], minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let nodesArray: LayoutNode[] = [];
        if (isDepartmentLaneView) {
            calculateDepartmentLaneLayout(root, layoutConfig, exportMode ? 6 : undefined);
            // Flatten tree for lane view
            const flatten = (n: LayoutNode) => {
                nodesArray.push(n);
                n.children.forEach(flatten);
            };
            flatten(root);
        } else {
            // Hierarchical Tree Layout
            calculateTreeLayout(root, layoutConfig);
            const flatten = (n: LayoutNode) => {
                nodesArray.push(n);
                n.children.forEach(flatten);
            };
            flatten(root);
        }

        // Find diagram dimensions
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        nodesArray.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + layoutConfig.nodeWidth);
            maxY = Math.max(maxY, n.y + layoutConfig.nodeHeight);
        });

        if (!Number.isFinite(minX)) minX = 0;
        if (!Number.isFinite(minY)) minY = 0;
        if (!Number.isFinite(maxX)) maxX = layoutConfig.nodeWidth;
        if (!Number.isFinite(maxY)) maxY = layoutConfig.nodeHeight;

        return { root, orphans, nodesArray, minX, minY, maxX, maxY };
    }, [employees, isDepartmentLaneView, layoutConfig]);

    if (nodesArray.length === 0) {
        return <p className="empty-state">No employees matching the current filters.</p>;
    }

    const { nodeWidth, nodeHeight, levelGap } = layoutConfig;

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

    const departmentHeatLanes = useMemo(() => {
        if (!showDepartmentHeatmap || nodesArray.length === 0) {
            return [];
        }

        const regions = new Map<string, { left: number; top: number; right: number; bottom: number; count: number }>();
        nodesArray.forEach((node) => {
            const department = node.employee.department || "Unassigned";
            const current = regions.get(department) ?? {
                left: Infinity,
                top: Infinity,
                right: -Infinity,
                bottom: -Infinity,
                count: 0
            };
            current.left = Math.min(current.left, node.x);
            current.top = Math.min(current.top, node.y);
            current.right = Math.max(current.right, node.x + nodeWidth);
            current.bottom = Math.max(current.bottom, node.y + nodeHeight);
            current.count += 1;
            regions.set(department, current);
        });

        const padding = 20;
        return Array.from(regions.entries())
            .map(([department, region]) => {
                const hue = departmentHue(department);
                return {
                    key: `heat-${department}`,
                    department,
                    count: region.count,
                    left: Math.max(0, region.left - padding),
                    top: Math.max(0, region.top - padding),
                    width: region.right - region.left + padding * 2,
                    height: region.bottom - region.top + padding * 2,
                    background: `hsla(${hue}, 75%, 55%, 0.12)`,
                    border: `hsla(${hue}, 75%, 68%, 0.5)`
                };
            })
            .sort((left, right) => left.top - right.top);
    }, [nodeHeight, nodeWidth, nodesArray, showDepartmentHeatmap]);

    const canvasPadding = exportMode ? 36 : 120;
    const contentWidth = Math.max(nodeWidth, maxX - minX);
    const contentHeight = Math.max(nodeHeight, maxY - minY);
    const offsetX = canvasPadding - minX;
    const offsetY = canvasPadding - minY;
    const canvasWidth = contentWidth + canvasPadding * 2;
    const canvasHeight = contentHeight + canvasPadding * 2;

    React.useEffect(() => {
        onDimensionsChange?.({ width: canvasWidth, height: canvasHeight });
    }, [canvasWidth, canvasHeight, onDimensionsChange]);

    return (
        <div
            className={`org-export-root ${exportMode ? "export-mode" : ""}`}
            style={{
                position: "relative",
                width: `${canvasWidth}px`,
                height: `${canvasHeight}px`,
                transformOrigin: "0 0",
                transition: "width 0.3s ease, height 0.3s ease"
            }}
        >
            {departmentHeatLanes.map((lane) => (
                <div
                    key={lane.key}
                    className="dept-heat-lane"
                    style={{
                        left: lane.left + offsetX,
                        top: lane.top + offsetY,
                        width: lane.width,
                        height: lane.height,
                        background: lane.background,
                        borderColor: lane.border
                    }}
                />
            ))}

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
                <g transform={`translate(${offsetX}, ${offsetY})`}>
                    {allEdges}
                </g>
            </svg>

            {/* 2. HTML layer for actual DOM nodes */}
            {nodesArray.map(node => (
                <div
                    key={node.id}
                    style={{
                        position: "absolute",
                        top: node.y + offsetY,
                        left: node.x + offsetX,
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
                            compact={isCompactLayout}
                            zoomScale={zoomScale}
                            onClick={(id) => onSelect(id)}
                            onHover={onHover}
                            onHoverMove={onHoverMove}
                        />
                    </div>
                </div>
            ))}

            {departmentHeatLanes.map((lane) => (
                <span
                    key={`${lane.key}-label`}
                    className="dept-heat-label"
                    style={{
                        left: lane.left + 10 + offsetX,
                        top: lane.top + 8 + offsetY,
                        borderColor: lane.border
                    }}
                >
                    {`${lane.department} (${lane.count})`}
                </span>
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
