import { ROLE_LEVELS_ORDER, type Employee, type RoleLevel, getRoleLevel } from "./org";

export interface LayoutConfig {
    levelGap: number;
    siblingGap: number;
    nodeWidth: number;
    nodeHeight: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    levelGap: 120,
    siblingGap: 60,
    nodeWidth: 210,
    nodeHeight: 116
};

export const COMPACT_LAYOUT_CONFIG: LayoutConfig = {
    levelGap: 104,
    siblingGap: 52,
    nodeWidth: 210,
    nodeHeight: 122
};

export const COMFORT_LAYOUT_CONFIG: LayoutConfig = {
    levelGap: 150,
    siblingGap: 80,
    nodeWidth: 236,
    nodeHeight: 140
};

export interface LayoutNode {
    id: string;
    employee: Employee;
    children: LayoutNode[];
    x: number;
    y: number;
    subtreeWidth: number;
}

export interface BuildTreeResult {
    root: LayoutNode | null;
    orphans: Employee[];
}

/**
 * 1. Tree Building & Orphan Detection
 * Converts flat employee array into strict hierarchical tree.
 * Detects disconnected nodes (orphans) and enforces exact single-parent rule.
 */
export function buildHierarchicalTree(employees: Employee[]): BuildTreeResult {
    if (!employees || employees.length === 0) {
        return { root: null, orphans: [] };
    }

    const map = new Map<string, LayoutNode>();

    // Initialize nodes
    employees.forEach(emp => {
        map.set(emp.id, {
            id: emp.id,
            employee: emp,
            children: [],
            x: 0,
            y: 0,
            subtreeWidth: 0
        });
    });

    let root: LayoutNode | null = null;
    const rootCandidates: LayoutNode[] = [];
    const orphans = new Set<Employee>();

    // Assign children to parents
    employees.forEach(emp => {
        const node = map.get(emp.id)!;

        // Root candidates are employees with no manager in the current filtered set.
        if (!emp.managerId || !map.has(emp.managerId)) {
            if (!rootCandidates.find(candidate => candidate.id === node.id)) {
                rootCandidates.push(node);
            }
        } else {
            const parent = map.get(emp.managerId);
            if (parent) {
                if (!parent.children.find(c => c.id === node.id)) {
                    parent.children.push(node);
                }
            } else {
                orphans.add(emp);
            }
        }
    });

    if (rootCandidates.length > 0) {
        root =
            rootCandidates.find(candidate => getRoleLevel(candidate.employee.title) === "CEO")
            ?? rootCandidates[0];

        // Keep additional root-level managers visible instead of treating them as orphans.
        rootCandidates.forEach(candidate => {
            if (!root || candidate.id === root.id) {
                return;
            }
            if (!root.children.find(child => child.id === candidate.id)) {
                root.children.push(candidate);
            }
        });
    }

    // Cycle detection / unreachable nodes identification
    const visited = new Set<string>();
    const traverse = (n: LayoutNode) => {
        if (visited.has(n.id)) return;
        visited.add(n.id);
        n.children.forEach(traverse);
    };

    if (root) {
        traverse(root);
    }

    // Capture everything else as orphans
    employees.forEach(emp => {
        if (!visited.has(emp.id)) {
            orphans.add(emp);
        }
    });

    // If still no root but we have employees, pick the first one as a fallback root.
    if (!root && employees.length > 0) {
        root = map.get(employees[0].id) || null;
    }

    return { root, orphans: Array.from(orphans) };
}

/**
 * 2. Layout Calculation (Strict Bounding Box Tree)
 * Uses a post-order traversal to calculate dimensions,
 * then a pre-order traversal to position exactly.
 */
export function calculateTreeLayout(root: LayoutNode, config: LayoutConfig): void {
    // Step A: Calculate subtree widths from bottom up
    calculateSubtreeWidths(root, config);

    // Step B: Set positions top down, starting with root at x=0
    setPosition(root, config, 0, 0);

    // Step C: Normalize X coordinates so leftmost node sits at x = config.nodeWidth / 2
    // or x = 0 to avoid clipping on left screen edge. Let's make leftmost X = 0.
    let minX = Infinity;
    const findMin = (n: LayoutNode) => {
        if (n.x < minX) minX = n.x;
        n.children.forEach(findMin);
    };
    findMin(root);

    const shiftToPositive = (n: LayoutNode) => {
        // Add (nodeWidth/2) buffer so the left half of the leftmost node isn't clipped
        n.x = n.x - minX + (config.nodeWidth / 2);
        n.children.forEach(shiftToPositive);
    };
    shiftToPositive(root);
}

function calculateSubtreeWidths(node: LayoutNode, config: LayoutConfig): void {
    if (node.children.length === 0) {
        node.subtreeWidth = config.nodeWidth;
        return;
    }

    let totalChildrenWidth = 0;
    for (const child of node.children) {
        calculateSubtreeWidths(child, config);
        totalChildrenWidth += child.subtreeWidth;
    }

    // Add gaps between siblings
    totalChildrenWidth += (node.children.length - 1) * config.siblingGap;

    // A parent's subtree can never be narrower than itself
    node.subtreeWidth = Math.max(config.nodeWidth, totalChildrenWidth);
}

function setPosition(node: LayoutNode, config: LayoutConfig, centerX: number, topY: number): void {
    node.x = centerX;
    node.y = topY;

    if (node.children.length === 0) {
        return;
    }

    // Compute the total span width of the children to find starting X
    let totalChildrenWidth = 0;
    for (const child of node.children) {
        totalChildrenWidth += child.subtreeWidth;
    }
    totalChildrenWidth += (node.children.length - 1) * config.siblingGap;

    // Next layout coordinate: start from the leftmost edge of this node's children block
    let currentX = centerX - (totalChildrenWidth / 2);

    for (const child of node.children) {
        // The center of this child's subtree is at half its subtreeWidth relative to currentX
        const childCenterX = currentX + (child.subtreeWidth / 2);

        setPosition(child, config, childCenterX, topY + config.nodeHeight + config.levelGap);

        // Advance currentX to the start of the next sibling's subtree, plus the gap
        currentX += child.subtreeWidth + config.siblingGap;
    }
}

/**
 * BONUS: Department Lane Layout
 * Roots are placed normally at depth 0 and 1.
 * Level 3+ employees are stacked vertically under their department head.
 */
export function calculateDepartmentLaneLayout(
    root: LayoutNode,
    config: LayoutConfig,
    rootColumnLimit?: number,
    stackStartDepth = 1
): void {
    // Pre-process: we treat all depth=1 nodes as roots of vertical lanes.
    // Their children will just flow straight down under them.

    const modifiedConfig = { ...config, levelGap: config.levelGap * 0.75 };

    // Step A: Calculate simplified subtree widths.
    // A vertical lane takes exactly max(nodeWidth, children_lane_width).
    const calculateLaneWidths = (node: LayoutNode, depth: number) => {
        if (depth >= 2 || node.children.length === 0) {
            // In lane mode, children elements don't spread horizontally, they stack.
            node.subtreeWidth = modifiedConfig.nodeWidth;
            node.children.forEach(child => calculateLaneWidths(child, depth + 1));
            return;
        }

        // Depth < 2 (CEO or Dept Head): spreads horizontally normally
        let totalChildrenWidth = 0;
        for (const child of node.children) {
            calculateLaneWidths(child, depth + 1);
            totalChildrenWidth += child.subtreeWidth;
        }
        totalChildrenWidth += (node.children.length - 1) * modifiedConfig.siblingGap;
        node.subtreeWidth = Math.max(modifiedConfig.nodeWidth, totalChildrenWidth);
    };

    calculateLaneWidths(root, 0);

    // Step B: Set positions
    const setLanePosition = (node: LayoutNode, centerX: number, topY: number, depth: number) => {
        node.x = centerX;
        node.y = topY;

        if (node.children.length === 0) return;

        if (depth >= stackStartDepth) {
            // Stack vertically right below
            let currentY = topY + modifiedConfig.nodeHeight + modifiedConfig.levelGap;
            for (const child of node.children) {
                setLanePosition(child, centerX, currentY, depth + 1);
                // Children of stacked nodes also stack further down (simulated recursively)
                // To find how far down the tree went, we can track max Y or just assume flat list if org chart is depth 3.
                // Assuming typical depth 3 (CEO -> Head -> Employees).
                currentY += calculateVerticalSpan(child, modifiedConfig) + modifiedConfig.levelGap;
            }
        } else {
            // Root-level children can be wrapped into rows for export readability.
            const maxColumns = Math.max(1, Math.min(rootColumnLimit ?? node.children.length, node.children.length));
            const children = node.children;
            const rows: LayoutNode[][] = [];
            for (let i = 0; i < children.length; i += maxColumns) {
                rows.push(children.slice(i, i + maxColumns));
            }

            const horizontalGap = modifiedConfig.siblingGap;
            const rowGap = Math.round(modifiedConfig.levelGap * 0.9);
            let currentRowTop = topY + modifiedConfig.nodeHeight + modifiedConfig.levelGap;

            for (const row of rows) {
                const rowWidth =
                    row.length * modifiedConfig.nodeWidth +
                    Math.max(0, row.length - 1) * horizontalGap;
                const rowStartX = centerX - rowWidth / 2 + modifiedConfig.nodeWidth / 2;
                let rowMaxSpan = modifiedConfig.nodeHeight;

                row.forEach((child, index) => {
                    const childCenterX = rowStartX + index * (modifiedConfig.nodeWidth + horizontalGap);
                    setLanePosition(child, childCenterX, currentRowTop, depth + 1);
                    rowMaxSpan = Math.max(rowMaxSpan, calculateVerticalSpan(child, modifiedConfig));
                });

                currentRowTop += rowMaxSpan + rowGap;
            }
        }
    };

    setLanePosition(root, 0, 0, 0);

    // Normalize X same as before
    let minX = Infinity;
    const findMin = (n: LayoutNode) => {
        if (n.x < minX) minX = n.x;
        n.children.forEach(findMin);
    };
    findMin(root);

    const shiftToPositive = (n: LayoutNode) => {
        n.x = n.x - minX + (modifiedConfig.nodeWidth / 2);
        n.children.forEach(shiftToPositive);
    };
    shiftToPositive(root);
}

function calculateVerticalSpan(node: LayoutNode, config: LayoutConfig): number {
    if (node.children.length === 0) return config.nodeHeight;
    let span = config.nodeHeight + config.levelGap;
    for (const child of node.children) {
        span += calculateVerticalSpan(child, config) + config.levelGap;
    }
    return span - config.levelGap;
}

/**
 * 4. Layered Layout (Hero Dashboard Style)
 * Positions all nodes in horizontal bands based on their RoleLevel.
 * Within each band, nodes are centered horizontally.
 */
export function calculateLayeredLayout(employees: Employee[], config: LayoutConfig): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    const idToNode = new Map<string, LayoutNode>();
    const levelMap = new Map<RoleLevel, LayoutNode[]>();

    // Basic initialization of ordered levels
    ROLE_LEVELS_ORDER.forEach(level => levelMap.set(level, []));

    // Group employees by level and create nodes
    employees.forEach(emp => {
        const level = getRoleLevel(emp.title);
        const node: LayoutNode = {
            id: emp.id,
            employee: emp,
            children: [],
            x: 0,
            y: 0,
            subtreeWidth: config.nodeWidth
        };
        idToNode.set(emp.id, node);
        const levelGroup = levelMap.get(level) || [];
        levelGroup.push(node);
        nodes.push(node);
    });

    // Populate children for edge rendering
    employees.forEach(emp => {
        if (emp.managerId) {
            const parent = idToNode.get(emp.managerId);
            const child = idToNode.get(emp.id);
            if (parent && child) {
                parent.children.push(child);
            }
        }
    });

    // Strategy: Each level is a horizontal band. 
    let currentY = 0;

    ROLE_LEVELS_ORDER.forEach((level) => {
        const levelGroup = levelMap.get(level);
        if (!levelGroup || levelGroup.length === 0) return;

        const totalWidth = levelGroup.length * config.nodeWidth + (levelGroup.length - 1) * config.siblingGap;
        let currentX = -(totalWidth / 2);

        levelGroup.forEach(node => {
            node.x = currentX + (config.nodeWidth / 2);
            node.y = currentY;
            currentX += config.nodeWidth + config.siblingGap;
        });

        currentY += config.nodeHeight + config.levelGap;
    });

    // Find minX to normalize to positive space
    let minX = Infinity;
    nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
    });

    nodes.forEach(n => {
        n.x = n.x - minX + (config.nodeWidth / 2);
    });

    return nodes;
}
