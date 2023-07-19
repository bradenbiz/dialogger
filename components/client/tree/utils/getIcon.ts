import { NodeType } from "../types";

export const getIcon = (type: NodeType) => {
  switch (type) {
    case NodeType.question:
      return "fas fa-comment-dots";
    case NodeType.idea:
      return "fas fa-lightbulb";
    case NodeType.decision:
      return "fas fa-circle-check";
    case NodeType.pro:
      return "fas fa-circle-plus";
    case NodeType.con:
      return "fas fa-circle-minus";
  }
};
