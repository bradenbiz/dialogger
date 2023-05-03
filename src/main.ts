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
  nodeIndex < 25 + Math.floor(Math.random() * 25);
  nodeIndex++
) {
  // type
  const randomNodeType = faker.helpers.arrayElement(Object.values(NodeType));

  // text
  let randomText = faker.lorem.sentence();
  randomText = randomText.slice(0, randomText.length - 1);

  // decided
  let randomDecided = undefined;

  // parentId
  const randomParentId = faker.helpers.maybe(
    () => faker.database.mongodbObjectId(),
    {
      probability: 0.95,
    }
  );

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
      break;
    case "Idea":
      randomDecided = faker.helpers.maybe(() => false, {
        probability: 0.95,
      });
      if (randomDecided === undefined) {
        randomDecided = true;
      }
      break;
    case "Pro":
      break;
    case "Con":
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

const addQuestion = (text: string): void => { console.log(text) };
// const addIdea = (text: string): void => {};
// const addPro = (text: string): void => {};
// const addCon = (text: string): void => {};
// const addDecision = (text: string): void => {};

addQuestion("blah");

graph.addNode("John", { x: 0, y: 10, size: 5, label: "John", color: "blue" });
// graph.addEdge("John", "Mary");s

const renderer = new Sigma(graph, container);
console.log(renderer);