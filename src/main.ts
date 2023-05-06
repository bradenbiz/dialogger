import "./style.css";

import { faker } from "@faker-js/faker";
import Graph from "graphology";
import Sigma from "sigma";

const container = document.getElementById("sigma-container") as HTMLElement;

const graph = new Graph();

enum NodeType {
  Question = "Question",
  Idea = "Idea",
  Pro = "Pro",
  Con = "Con",
}

interface Node {
  type: NodeType;
  text: string;
  parentId?: string;
  childrenIds: string[];
  decided?: boolean;
  id: string;
}

// #region Node Generator
let nodeData: Node[] = [];
for (
  let nodeIndex = 0;
  nodeIndex < 10 + Math.floor(Math.random() * 10);
  nodeIndex++
) {
  // type
  const randomNodeType =
    nodeData.length === 0
      ? NodeType.Question
      : faker.helpers.arrayElement(Object.values(NodeType));

  // text
  let randomText = faker.lorem.sentence();
  randomText = randomText.slice(0, randomText.length - 1);

  // decided
  let randomDecided = undefined;

  // parentId
  let randomParentId: string | undefined;

  // childrenIds
  let randomChildrenIds: string[] = [];

  for (
    let childrenIdIndex = 0;
    childrenIdIndex < Math.floor(Math.random() * 4);
    childrenIdIndex++
  ) {}

  switch (randomNodeType) {
    case "Question":
      randomText = randomText + "?";
      if (nodeData.length > 0) {
        randomParentId = faker.helpers.maybe(
          () => nodeData[Math.floor(Math.random() * nodeData.length)].id,
          {
            probability: 0.95,
          }
        );
      }
      break;
    case "Idea":
      randomDecided = faker.helpers.maybe(() => false, {
        probability: 0.9,
      });
      if (randomDecided === undefined) {
        randomDecided = true;
      }

      const questionNodes = nodeData.filter(
        (aPotentialQuestionNode) => aPotentialQuestionNode.type === "Question"
      );

      if (questionNodes.length > 0) {
        randomParentId = faker.helpers.maybe(
          () =>
            questionNodes[Math.floor(Math.random() * questionNodes.length)].id,
          {
            probability: 0.99,
          }
        );
      }
      break;
    case "Pro":
      const ideaNodes = nodeData.filter(
        (aPotentialIdeaNode) => aPotentialIdeaNode.type === "Idea"
      );
      if (ideaNodes.length > 0) {
        randomParentId = faker.helpers.maybe(
          () => ideaNodes[Math.floor(Math.random() * ideaNodes.length)].id,
          {
            probability: 0.99,
          }
        );
      }
      break;
    case "Con":
      if (nodeData.length > 0) {
        randomParentId = faker.helpers.maybe(
          () => nodeData[Math.floor(Math.random() * nodeData.length)].id,
          {
            probability: 0.99,
          }
        );
      }
      break;
  }

  nodeData.push({
    type: randomNodeType,
    text: randomText,
    parentId: randomParentId,
    childrenIds: randomChildrenIds,
    decided: randomDecided,
    id: faker.database.mongodbObjectId(),
  });
}
console.log("nodeData", nodeData);

// #endregion

// #region Node Placer
const addNode = (id: string, text: string, color: string): void => {
  graph.addNode(id, {
    x: Math.floor(Math.random() * 25),
    y: Math.floor(Math.random() * 25),
    size: 10,
    label: text,
    color: color,
  });
};

nodeData.forEach((aNode) => {
  switch (aNode.type) {
    case "Question":
      addNode(aNode.id, aNode.text, "purple");
      break;
    case "Idea":
      if (aNode.decided === false) {
        addNode(aNode.id, aNode.text, "yellow");
      } else {
        addNode(aNode.id, aNode.text, "blue");
      }
      break;
    case "Pro":
      addNode(aNode.id, aNode.text, "green");
      break;
    case "Con":
      addNode(aNode.id, aNode.text, "red");
      break;
  }
});

nodeData.forEach((aNode) => {
  if (aNode.parentId) {
    const parentNode = nodeData.find(
      (aPotentialParentNode) => aNode.parentId === aPotentialParentNode.id
    );

    if (parentNode) {
      graph.addEdge(aNode.id, parentNode.id, { type: "arrow", size: 4 });
    } else {
      console.error("Could not find parentNode with id: ", aNode.parentId);
    }
  }
});

// #endregion

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const renderer = new Sigma(graph, container);
