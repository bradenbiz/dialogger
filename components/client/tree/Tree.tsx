"use client";

import { useEffect } from "react";
import ReactDOMServer from "react-dom/server";
import * as Treeviz from "treeviz";
import "../../../app/style.css";
import { ExtendedHierarchyPointNode } from "../../../src/libs/treeviz/typings";
import { mockData } from "./mock/data";
import { ButtonProps, NodeData, NodeType } from "./types";
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
        if ((event.target as Element).classList.contains("btn")) {
          const type = (event.target as Element).getAttribute("data-type");
          switch (type) {
            case "add":
              data = add(myTree, data, node.data.id);
              break;
            case "delete":
              const toDelete = [node.data.id].concat(
                node.children?.map(
                  (i: ExtendedHierarchyPointNode) => (i.data as NodeData).id
                ) || []
              );
              data = data.filter((i) => toDelete.indexOf(i.id) === -1);
              myTree.refresh(data);
              break;
            default:
              const dataNode = data.find((i) => i.id === node.data.id);
              if (!dataNode || !type) {
                return;
              }
              dataNode.type = parseInt(type) as NodeType;
              myTree.refresh(data);
              setTimeout(() => {
                removeInputListeners(data);
                addInputListeners(data);
              }, 500);
              break;
          }
        }
      },
      renderNode: (node) => {
        const nodeClasses = `node flex items-center ${getColor(
          node.data.type
        )} border-2 rounded-lg p-2 relative w-[${
          node.settings.nodeWidth
        }px] h-[${node.settings.nodeHeight}px]`;
        return ReactDOMServer.renderToStaticMarkup(
          <div id={node.data.id} className={nodeClasses}>
            <i
              className={`${getIcon(
                node.data.type
              )} text-3xl mr-2 text-black/40`}
            ></i>
            <input
              data-id={node.data.id}
              type="text"
              placeholder={`New ${toProperCase(NodeType[node.data.type])}`}
              className="bg-transparent placeholder-black/30"
              value={node.data.label}
            />
            <Button
              id="add"
              icon="fas fa-plus"
              color="bg-green-600"
              hoverColor="bg-green-700"
              pos="-right-3 -top-3"
            />
            <Button
              id="delete"
              icon="fas fa-trash"
              color="bg-red-400"
              hoverColor="bg-red-500"
              pos="-right-3 -bottom-3"
            />
            <Button
              id={NodeType.question}
              icon={getIcon(NodeType.question)}
              color={getColor(NodeType.question)}
              hoverColor=""
              pos="-left-3 -bottom-3"
            />
            <Button
              id={NodeType.idea}
              icon={getIcon(NodeType.idea)}
              color={getColor(NodeType.idea)}
              hoverColor=""
              pos="left-4 -bottom-3"
            />
            <Button
              id={NodeType.decision}
              icon={getIcon(NodeType.decision)}
              color={getColor(NodeType.decision)}
              hoverColor=""
              pos="left-12 -bottom-3"
            />
            <Button
              id={NodeType.pro}
              icon={getIcon(NodeType.pro)}
              color={getColor(NodeType.pro)}
              hoverColor=""
              pos="left-20 -bottom-3"
            />
            <Button
              id={NodeType.con}
              icon={getIcon(NodeType.con)}
              color={getColor(NodeType.con)}
              hoverColor=""
              pos="left-28 -bottom-3"
            />
          </div>
        );
      },
      relationnalField: "parent",
    });

    // Display the tree based on the data
    myTree.refresh(data);

    addInputListeners(data);
  }, []);

  return <div id="tree" className="w-screen h-screen"></div>;
};

const Button = ({ id, icon, color, hoverColor, pos }: ButtonProps) => (
  <i
    data-type={id}
    className={`${icon} btn text-sm hidden cursor-pointer absolute ${pos} ${color} w-6 h-6 items-center justify-center rounded-full text-white font-bold hover:${hoverColor}`}
  ></i>
);

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
