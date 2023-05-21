"use client";

import { useEffect } from "react";
import * as Treeviz from "treeviz";
import "../../app/style.css";
import { ExtendedHierarchyPointNode } from "../../src/libs/treeviz/typings";
import { mockData } from "./mock/data";
import { NodeData, NodeType } from "./types";
import { getColor, getIcon, toProperCase } from "./utils";

export const Tree = () => {
  useEffect(() => {
    // let currTransform: Transform = { z: 1, x: 0, y: 0 };

    let data = mockData;

    // Define and configure a tree object
    let myTree = Treeviz.create({
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
        if ((event.target as Element).classList.contains("add")) {
          data = add(myTree, data, node.data.id);
        }
        if ((event.target as Element).classList.contains("delete")) {
          const toDelete = [node.data.id].concat(
            node.children?.map(
              (i: ExtendedHierarchyPointNode) => (i.data as NodeData).id
            ) || []
          );
          data = data.filter((i) => toDelete.indexOf(i.id) === -1);
          myTree.refresh(data);
        }
        if ((event.target as Element).classList.contains("changeType")) {
          const dataNode = data.find((i) => i.id === node.data.id);
          const type = (event.target as Element).getAttribute("data-type");
          if (!dataNode || !type) {
            return;
          }
          dataNode.type = parseInt(type) as NodeType;
          myTree.refresh(data);
          setTimeout(() => {
            removeInputListeners(data);
            addInputListeners(data);
          }, 500);
        }
      },
      renderNode: (node) => {
        return `
            <div id="${node.data.id}" class="node flex items-center ${getColor(
          node.data.type
        )} border-2 rounded-lg p-2 relative" style="width:  ${
          node.settings.nodeWidth
        }px; height: ${node.settings.nodeHeight}px;">
                <i class="${getIcon(
                  node.data.type
                )} text-3xl mr-2 text-black/40"></i>
                <input data-id="${
                  node.data.id
                }" type="text" placeholder="New ${toProperCase(
          NodeType[node.data.type]
        )}" class="bg-transparent placeholder-black/30" value="${
          node.data.label
        }">
                <i class="add fas fa-plus text-sm hidden cursor-pointer absolute -right-3 -top-3 bg-green-600 w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:bg-green-700"></i>
                <i class="delete fas fa-trash text-xs hidden cursor-pointer absolute -right-3 -bottom-3 bg-red-400 w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:bg-red-500"></i>
                
                <i data-type="${NodeType.question}" class="changeType ${getIcon(
          NodeType.question
        )} ${getColor(
          NodeType.question
        )} text-xs hidden cursor-pointer absolute -left-3 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.idea}" class="changeType ${getIcon(
          NodeType.idea
        )} ${getColor(
          NodeType.idea
        )} text-xs hidden cursor-pointer absolute left-4 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.decision}" class="changeType ${getIcon(
          NodeType.decision
        )} ${getColor(
          NodeType.decision
        )} text-xs hidden cursor-pointer absolute left-12 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.pro}" class="changeType ${getIcon(
          NodeType.pro
        )} ${getColor(
          NodeType.pro
        )} text-xs hidden cursor-pointer absolute left-20 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
                <i data-type="${NodeType.con}" class="changeType ${getIcon(
          NodeType.con
        )} ${getColor(
          NodeType.con
        )} text-xs hidden cursor-pointer absolute left-28 -bottom-3 border w-6 h-6 items-center justify-center rounded-full text-white font-bold"></i>
            </div>
        `;
      },
      relationnalField: "parent",
    });

    // Display the tree based on the data
    myTree.refresh(data);

    addInputListeners(data);

    window.setTimeout(() => {
      centerGraph();
    }, 0);
  }, []);

  return <div id="tree" className="w-screen h-screen"></div>;
};

// #region helper functions
const onBlur = (el: HTMLInputElement, data: NodeData[]) => {
  const id = el.getAttribute("data-id");
  if (!id) {
    return;
  }
  const foundData = data.find((i) => i.id.toString() == id);
  if (!foundData) {
    return;
  }
  foundData.label = el.value;
  console.log("blurring", el, el.value, foundData);
  // console.log(data);
  // myTree.refresh(data);
};

const centerGraph = () => {
  // const g = getGraph();
  // const rect = g?.getBoundingClientRect();
  // if (!rect) { return }
  // // TODO center?
  // // rect.width / 2
  // scrollTo(currTransform, 300, null, 0.8);
};

const addInputListeners = (data: NodeData[]) => {
  Array.from(document.querySelectorAll("input")).forEach((el) => {
    el.addEventListener("blur", () => onBlur(el, data));
  });
};

const removeInputListeners = (data: NodeData[]) => {
  Array.from(document.querySelectorAll("input")).forEach((el) => {
    el.removeEventListener("blur", () => onBlur(el, data));
  });
};

const add = (
  myTree: any,
  data: NodeData[],
  parent: number | null = null
): NodeData[] => {
  const id = new Date().getTime();
  data.push({ id, label: "", type: NodeType.question, parent });
  myTree.refresh(data);
  window.setTimeout(() => {
    const input = document
      .getElementById(id.toString())
      ?.querySelector("input");
    input?.focus();
    removeInputListeners(data);
    addInputListeners(data);
  }, 500);
  return data;
};

// const increment = (
//   axis: Extract<keyof Transform, string>,
//   target: number,
//   amount: number,
//   currTransform: Transform
// ) => {
//   return currTransform[axis] < target
//     ? (currTransform[axis] += amount)
//     : target;
// };

// const decrement = (
//   axis: Extract<keyof Transform, string>,
//   target: number,
//   amount: number,
//   currTransform: Transform
// ) => {
//   return currTransform[axis] > target
//     ? (currTransform[axis] += amount)
//     : target;
// };

// const scrollTo = (
//   currTransform: Transform,
//   x: number | null,
//   y: number | null,
//   z: number | null
// ) => {
//   const g = getGraph();
//   const dirX: "increment" | "decrement" =
//     x && currTransform.x < x ? "increment" : "decrement";
//   const dirY: "increment" | "decrement" =
//     y && currTransform.y < y ? "increment" : "decrement";
//   const dirZ: "increment" | "decrement" =
//     z && currTransform.z < z ? "increment" : "decrement";
//   const inter = setInterval(() => {
//     if (x) {
//       currTransform.x =
//         dirX === "increment"
//           ? increment("x", x, 3, currTransform)
//           : decrement("x", x, -3, currTransform);
//     }
//     if (y) {
//       currTransform.y =
//         dirY === "increment"
//           ? increment("y", y, 3, currTransform)
//           : decrement("y", y, -3, currTransform);
//     }
//     if (z) {
//       currTransform.z =
//         dirZ === "increment"
//           ? increment("z", z, 0.1, currTransform)
//           : decrement("z", z, -0.1, currTransform);
//     }
//     g?.setAttribute(
//       "transform",
//       `translate(${currTransform.x}, ${currTransform.y}) scale(${currTransform.z})`
//     );
//     if (
//       (!x || (x && currTransform.x === x)) &&
//       (!y || (y && currTransform.y === y)) &&
//       (!z || (z && currTransform.z === z))
//     ) {
//       console.log("cleared");
//       clearInterval(inter);
//     }
//   }, 0.01);
// };
// #endregion
