import './style.css';
import * as Treeviz from 'treeviz';

interface Transform {
    x: number,
    y: number,
    z: number
}

let currTransform: Transform = {z: 1, x: 0, y: 0}

enum NodeType {
    'question',
    'idea',
    'positive',
    'negative'
} 


interface NodeData {
    id: number,
    label: string,
    type: NodeType,
    parent: number | null
}

const getColor = (type: NodeType) => {
    switch(type) {
        case NodeType.question:
            return 'bg-gray-200';
        case NodeType.idea:
            return 'bg-yellow-200';
        case NodeType.positive:
            return 'bg-green-300';
        case NodeType.negative:
            return 'bg-red-300';
    }
}

// Define a dataset
var data: NodeData[] = [
    { id: 1, label: "Chicken or egg first?", type: NodeType.question, parent: null },
    { id: 2, label: "Chicken", type: NodeType.idea, parent: 1 },
    { id: 3, label: "Egg", type: NodeType.idea, parent: 1 },
    { id: 4, label: "Chickens hatch from them", type: NodeType.positive, parent: 3 },
    { id: 5, label: "Impossible", type: NodeType.negative, parent: 3 }
];

// Define and configure a tree object
var myTree = Treeviz.create({
    htmlId: "tree",
    idKey: "id",
    hasFlatData: true,
    isHorizontal: true,
    nodeWidth: 250,
    nodeHeight: 50,
    mainAxisNodeSpacing: 2,
    secondaryAxisNodeSpacing: 3,
    hasPan: false,
    hasZoom: false,
    linkWidth: (nodeData: NodeData) => 5,
    linkShape: "quadraticBeziers",
    linkColor: (nodeData: NodeData) => "#B0BEC5",
    onNodeClick: (nodeData: NodeData) => console.log(nodeData),
    // nodeColor: (nodeData) => "grey",
    onNodeMouseEnter: (nodeData: NodeData) => { },
    onNodeMouseLeave: (node: NodeData) => { },
    renderNode: (node) => {
        console.log(node);
        return `
            <div class="node flex items-center ${getColor(node.data.type)} border-white border-4 rounded-lg p-2 relative" style="width:  ${node.settings.nodeWidth}px; height: ${node.settings.nodeHeight}px;">
                <i class="fas fa-lightbulb mr-2 text-black/40"></i>
                ${node.data.label}
                <button class="add hidden absolute -right-3 bg-green-600 w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:bg-green-700">+</button>
            </div>
        `;
    },
    relationnalField: "parent",
});

// Display the tree based on the data
myTree.refresh(data);

const getGraph = () => {
    const tree = document.getElementById('tree');
    return tree ? tree.firstElementChild?.firstElementChild : null;
}

const centerGraph = () => {
    const g = getGraph();
    const rect = g?.getBoundingClientRect();
    if (!rect) { return }
    // TODO center?
    // rect.width / 2
    scrollTo(300, null, 0.8);
}

const scrollTo = (x: number | null, y: number | null, z: number | null) => {
    const g = getGraph();
    const dirX: 'increment' | 'decrement' = x && currTransform.x < x ? 'increment' : 'decrement';
    const dirY: 'increment' | 'decrement' = y && currTransform.y < y ? 'increment' : 'decrement';
    const dirZ: 'increment' | 'decrement' = z && currTransform.z < z ? 'increment' : 'decrement';
    const inter = setInterval(() => {
        if (x) { currTransform.x = dirX === 'increment' ? increment('x', x, 3) : decrement('x', x, -3); }
        if (y) { currTransform.y = dirY === 'increment' ? increment('y', y, 3) : decrement('y', y, -3); }
        if (z) { currTransform.z = dirZ === 'increment' ? increment('z', z, 0.1) : decrement('z', z, -0.1); }
        g?.setAttribute("transform", `translate(${currTransform.x}, ${currTransform.y}) scale(${currTransform.z})`);
        if (
            (!x || x && currTransform.x === x) &&
            (!y || y && currTransform.y === y) &&
            (!z || z && currTransform.z === z)
        ) {
            console.log('cleared');
            clearInterval(inter);
        }
    }, 0.01);
}

const increment = (axis: Extract<keyof Transform, string>, target: number, amount: number) => {
    return currTransform[axis] < target ? currTransform[axis] += amount : target;
}

const decrement = (axis: Extract<keyof Transform, string>, target: number, amount: number) => {
    return currTransform[axis] > target ? currTransform[axis] += amount : target;
}

document.getElementById('zoomIn')?.addEventListener('click', () => scrollTo(null, null, currTransform.z += 0.1));
document.getElementById('zoomOut')?.addEventListener('click', () => scrollTo(null, null, currTransform.z += -0.1))

window.setTimeout(() => {
    centerGraph();
}, 0)



