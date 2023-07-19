import { NodeType } from "./NodeType";

export interface NodeData {
  id: number;
  label: string;
  type: NodeType;
  parent: number | null;
}
