import "./style.css";

import Graph from "graphology";
import Sigma from "sigma";

const container = document.getElementById("sigma-container") as HTMLElement;

const graph = new Graph();

interface Node {
  text: string;
  children: Node[];
}

interface Question extends Node {
  parent?: Node;
}

interface Idea extends Node {
  parent?: Question;
  decided: boolean;
}

interface Pro extends Node {
  parent?: Idea;
}

interface Con extends Node {
  parent?: Idea;
}

const exampleData: Node[] = [
  // faker
];

const addQuestion = (text: string): void => {};

addQuestion;

graph.addNode("John", { x: 0, y: 10, size: 5, label: "John", color: "blue" });
// graph.addEdge("John", "Mary");s

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const renderer = new Sigma(graph, container);
