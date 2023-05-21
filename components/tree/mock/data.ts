import { NodeData } from "../types/NodeData";
import { NodeType } from "../types/NodeType";

// Define a dataset
export const mockData: NodeData[] = [
  {
    id: 1,
    label: "Chicken or egg first?",
    type: NodeType.question,
    parent: null,
  },
  { id: 2, label: "Chicken", type: NodeType.idea, parent: 1 },
  { id: 3, label: "Egg", type: NodeType.decision, parent: 1 },
  { id: 4, label: "Taste good", type: NodeType.pro, parent: 3 },
  { id: 5, label: "Impossible", type: NodeType.con, parent: 3 },
  {
    id: 6,
    label: "Best car manufacturer?",
    type: NodeType.question,
    parent: null,
  },
  { id: 7, label: "Toyota", type: NodeType.decision, parent: 6 },
  { id: 8, label: "Ford", type: NodeType.idea, parent: 6 },
  { id: 9, label: "Mini Cooper", type: NodeType.idea, parent: 6 },
  { id: 10, label: "Rare", type: NodeType.con, parent: 9 },
  { id: 11, label: "Reliability", type: NodeType.pro, parent: 7 },
  { id: 12, label: "Import costs", type: NodeType.con, parent: 7 },
];
