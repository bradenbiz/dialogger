import './style.css';
import * as Treeviz from 'treeviz';
import { ExtendedHierarchyPointNode } from './libs/treeviz/typings';

const toProperCase = function (str: string) {
    return str.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
};

interface Transform {
    x: number,
    y: number,
    z: number
}

let currTransform: Transform = {z: 1, x: 0, y: 0}

enum NodeType {
    'question',
    'idea',
    'decision',
    'pro',
    'con'
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
            return 'bg-[#DDA6FF] border-[#857CE9]';
        case NodeType.idea:
            return 'bg-[#FCFF77] border-[#C8CC00]';
        case NodeType.decision:
            return 'bg-[#A7EFFF] border-[#00A7CC]';
        case NodeType.pro:
            return 'bg-[#BFFFA8] border-[#35CC00]';
        case NodeType.con:
            return 'bg-[#FFA8A8] border-[#CC0000]';
    }
}

const getIcon = (type: NodeType) => {
    switch(type) {
        case NodeType.question:
            return 'fas fa-comment-dots';
        case NodeType.idea:
            return 'fas fa-lightbulb';
        case NodeType.decision:
            return 'fas fa-circle-check';
        case NodeType.pro:
            return 'fas fa-circle-plus';
        case NodeType.con:
            return 'fas fa-circle-minus';
    }
}

// Define a dataset
let data: NodeData[] = [
    { id: 1, label: "Chicken or egg first?", type: NodeType.question, parent: null },
    { id: 2, label: "Chicken", type: NodeType.idea, parent: 1 },
    { id: 3, label: "Egg", type: NodeType.decision, parent: 1 },
    { id: 4, label: "Taste good", type: NodeType.pro, parent: 3 },
    { id: 5, label: "Impossible", type: NodeType.con, parent: 3 },
    { id: 6, label: "Best car manufacturer?", type: NodeType.question, parent: null },
    { id: 7, label: "Toyota", type: NodeType.decision, parent: 6 },
    { id: 8, label: "Ford", type: NodeType.idea, parent: 6 },
    { id: 9, label: "Mini Cooper", type: NodeType.idea, parent: 6 },
    { id: 10, label: "Rare", type: NodeType.con, parent: 9 },
    { id: 10, label: "Reliability", type: NodeType.pro, parent: 7 },
    { id: 11, label: "Import costs", type: NodeType.con, parent: 7 },
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
    hasPan: true,
    hasZoom: true,
    linkWidth: () => 3,
    linkShape: "quadraticBeziers",
    linkColor: () => "#B0BEC5",
    onNodeClick: (event: PointerEvent, node: any) => {
        if ((event.target as Element).classList.contains('add')) {
            add(node.data.id);
        }
        if ((event.target as Element).classList.contains('delete')) {
            const toDelete = [node.data.id].concat(node.children?.map((i: ExtendedHierarchyPointNode) => (i.data as NodeData).id) || []);
            data = data.filter(i => toDelete.indexOf(i.id) === -1);
            myTree.refresh(data);
        }
        if ((event.target as Element).classList.contains('changeType')) {
            const dataNode = data.find(i => i.id === node.data.id);
            const type = (event.target as Element).getAttribute("data-type");
            if (!dataNode || !type) { return }
            dataNode.type = parseInt(type) as NodeType;
            myTree.refresh(data);
            setTimeout(() => {
                removeInputListeners();
                addInputListeners();
            }, 500)
        }        
    },
    renderNode: (node) => {
        return `
            <div id="${node.data.id}" class="node flex items-center ${getColor(node.data.type)} border-2 rounded-lg p-2 relative" style="width:  ${node.settings.nodeWidth}px; height: ${node.settings.nodeHeight}px;">
                <i class="${getIcon(node.data.type)} text-3xl mr-2 text-black/40"></i>
                <input data-id="${node.data.id}" type="text" placeholder="New ${toProperCase(NodeType[node.data.type])}" class="bg-transparent placeholder-black/30" value="${node.data.label}">
                <i class="add fas fa-plus text-sm hidden cursor-pointer absolute -right-3 -top-3 bg-green-600 w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:bg-green-700"></i>
                <i class="delete fas fa-trash text-xs hidden cursor-pointer absolute -right-3 -bottom-3 bg-red-400 w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:bg-red-500"></i>
                
                <i data-type="${NodeType.question}" class="changeType ${getIcon(NodeType.question)} ${getColor(NodeType.question)} text-xs hidden cursor-pointer absolute -left-3 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.idea}" class="changeType ${getIcon(NodeType.idea)} ${getColor(NodeType.idea)} text-xs hidden cursor-pointer absolute left-4 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.decision}" class="changeType ${getIcon(NodeType.decision)} ${getColor(NodeType.decision)} text-xs hidden cursor-pointer absolute left-12 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.pro}" class="changeType ${getIcon(NodeType.pro)} ${getColor(NodeType.pro)} text-xs hidden cursor-pointer absolute left-20 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.con}" class="changeType ${getIcon(NodeType.con)} ${getColor(NodeType.con)} text-xs hidden cursor-pointer absolute left-28 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
            </div>
        `;
    },
    relationnalField: "parent",
});

// Display the tree based on the data
myTree.refresh(data);

const onBlur = (el: HTMLInputElement) => {
    const id = el.getAttribute("data-id");
    if (!id) { return }
    const foundData = data.find(i => i.id.toString() == id);
    if (!foundData) { return }
    foundData.label = el.value;
    console.log('blurring', el, el.value, foundData)
    // console.log(data);
    // myTree.refresh(data);
}

const getGraph = () => {
    const tree = document.getElementById('tree');
    return tree ? tree.firstElementChild?.firstElementChild : null;
}

const centerGraph = () => {
    // const g = getGraph();
    // const rect = g?.getBoundingClientRect();
    // if (!rect) { return }
    // // TODO center?
    // // rect.width / 2
    // scrollTo(300, null, 0.8);
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

const addInputListeners = () => {
    Array.from(document.querySelectorAll('input')).forEach((el) => {
        el.addEventListener("blur", () => onBlur(el) );
    });
} 

const removeInputListeners = () => {
    Array.from(document.querySelectorAll('input')).forEach((el) => {
        el.removeEventListener("blur", () => onBlur(el) );
    });
} 

addInputListeners();

const add = (parent: number | null = null) => {
    const id = new Date().getTime();
    data.push({ id, label: "", type: NodeType.question, parent });
    myTree.refresh(data);   
    window.setTimeout(() => {
        const input = document.getElementById(id.toString())?.querySelector('input');
        input?.focus();
        removeInputListeners();
        addInputListeners();
    }, 500)
   
}

document.getElementById('add')?.addEventListener('click', () => add());

document.getElementById('zoomIn')?.addEventListener('click', () => scrollTo(null, null, currTransform.z += 0.1));
document.getElementById('zoomOut')?.addEventListener('click', () => scrollTo(null, null, currTransform.z += -0.1));
document.getElementById('fullscreen')?.addEventListener('click', () => {
    document.getElementById('fullscreen')?.classList.add('hidden');
    document.getElementById('unfullscreen')?.classList.remove('hidden');
    // @ts-ignore
    if (document.documentElement.requestFullscreen) {
    // @ts-ignore
        document.documentElement.requestFullscreen();
    // @ts-ignore
    } else if (document.documentElement.webkitRequestFullscreen) { /* Safari */
    // @ts-ignore
        document.documentElement.webkitRequestFullscreen();
    // @ts-ignore
    } else if (document.documentElement.msRequestFullscreen) { /* IE11 */
    // @ts-ignore
        document.documentElement.msRequestFullscreen();
    }
});
document.getElementById('unfullscreen')?.addEventListener('click', () => {
    document.getElementById('fullscreen')?.classList.remove('hidden');
    document.getElementById('unfullscreen')?.classList.add('hidden');
    // @ts-ignore
    if (document.exitFullscreen) {
    // @ts-ignore
        document.exitFullscreen();
    // @ts-ignore
    } else if (document.webkitExitFullscreen) { /* Safari */
    // @ts-ignore
        document.webkitExitFullscreen();
    // @ts-ignore
    } else if (document.msExitFullscreen) { /* IE11 */
    // @ts-ignore
        document.msExitFullscreen();
    }
});

window.setTimeout(() => {
    centerGraph();
}, 0)



