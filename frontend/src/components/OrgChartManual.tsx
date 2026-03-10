import React, { useMemo, useState } from "react";
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
    onDropEmployee?: (draggedId: string, targetId: string) => void;
    showStatusColors?: boolean;
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
    onDimensionsChange,
    onDropEmployee,
    showStatusColors = true
}: OrgChartManualProps) {
    const layoutConfig: LayoutConfig = isCompactLayout ? COMPACT_LAYOUT_CONFIG : COMFORT_LAYOUT_CONFIG;
    const [dragTargetId, setDragTargetId] = useState<string | null>(null);

    // 1. Build and calculate layout based on mode
    const { orphans, nodesArray, minX, minY, maxX, maxY } = useMemo(() => {
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

    const { nodeWidth, nodeHeight } = layoutConfig;

    // Render SVG Edge connecting parent to child using smooth Bezier curves
    const renderEdge = (source: LayoutNode, target: LayoutNode, isSecondary = false) => {
        const startX = source.x + nodeWidth / 2;
        const startY = source.y + nodeHeight;
        const endX = target.x + nodeWidth / 2;
        const endY = target.y;

        const verticalGap = endY - startY;
        const curvature = Math.min(Math.abs(verticalGap) * 0.5, 60);

        const cp1x = startX;
        const cp1y = startY + curvature;
        const cp2x = endX;
        const cp2y = endY - curvature;

        const pathData = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
        const edgeOpacity = Math.max(0.15, Math.min(0.6, 0.2 + (1 - zoomScale) * 0.4));

        return (
            <g key={`${source.id}->${target.id}${isSecondary ? "-sec" : ""}`}>
                {!isSecondary && (
                    <path
                        d={pathData}
                        stroke="var(--color-primary)"
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                        className="org-link-glow"
                        style={{ opacity: edgeOpacity * 0.3, filter: "blur(4px)" }}
                    />
                )}
                <path
                    d={pathData}
                    stroke={isSecondary ? "rgba(101, 219, 255, 0.35)" : "var(--color-primary-medium)"}
                    strokeWidth={isSecondary ? "1.5" : "2"}
                    strokeDasharray={isSecondary ? "6,4" : "none"}
                    fill="none"
                    strokeLinecap="round"
                    className={isSecondary ? "org-link-secondary" : "org-link"}
                    style={{ opacity: isSecondary ? edgeOpacity * 0.8 : edgeOpacity }}
                />
            </g>
        );
    };

    const allEdges = useMemo(() => {
        const idToNode = new Map(nodesArray.map(n => [n.id, n]));
        const lines: React.ReactElement[] = [];

        nodesArray.forEach(node => {
            // Primary edge (rendered by the child looking up to its primary manager)
            if (node.employee.managerId) {
                const parentNode = idToNode.get(node.employee.managerId);
                if (parentNode) {
                    lines.push(renderEdge(parentNode, node));
                }
            }

            // Secondary edges
            if (node.additionalManagerIds && node.additionalManagerIds.length > 0) {
                node.additionalManagerIds.forEach(managerId => {
                    const secondaryParentNode = idToNode.get(managerId);
                    if (secondaryParentNode) {
                        lines.push(renderEdge(secondaryParentNode, node, true));
                    }
                });
            }
        });

        return lines;
    }, [nodesArray, zoomScale]);

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
                    <div
                        className={`node-shell ${dragTargetId === node.id ? "drop-target-active" : ""}`}
                        style={{
                            width: "100%",
                            height: "100%",
                            border: dragTargetId === node.id ? "3px dashed var(--color-primary-medium)" : "none",
                            borderRadius: "16px",
                            boxSizing: "border-box"
                        }}
                        draggable={!exportMode && !isDepartmentLaneView}
                        onDragStart={(e) => {
                            if (exportMode || isDepartmentLaneView) return;
                            e.dataTransfer.setData("application/employee-id", node.id);
                            e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                            if (exportMode || isDepartmentLaneView) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (dragTargetId !== node.id) {
                                setDragTargetId(node.id);
                            }
                        }}
                        onDragLeave={() => {
                            if (dragTargetId === node.id) {
                                setDragTargetId(null);
                            }
                        }}
                        onDrop={(e) => {
                            if (exportMode || isDepartmentLaneView) return;
                            e.preventDefault();
                            setDragTargetId(null);
                            const draggedId = e.dataTransfer.getData("application/employee-id");
                            if (draggedId && draggedId !== node.id && onDropEmployee) {
                                onDropEmployee(draggedId, node.id);
                            }
                        }}
                    >
                        <EmployeeCard
                            employee={node.employee}
                            selected={node.id === selectedEmployeeId || node.id === hoveredEmployeeId}
                            isMatch={matchingIds ? matchingIds.has(node.id) : true}
                            compact={isCompactLayout}
                            zoomScale={zoomScale}
                            showStatusColors={showStatusColors}
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
