import { NodeType } from "../types";

export const getColor = (type: NodeType) => {
  switch (type) {
    case NodeType.question:
      return "bg-[#DDA6FF] border-[#857CE9]";
    case NodeType.idea:
      return "bg-[#FCFF77] border-[#C8CC00]";
    case NodeType.decision:
      return "bg-[#A7EFFF] border-[#00A7CC]";
    case NodeType.pro:
      return "bg-[#BFFFA8] border-[#35CC00]";
    case NodeType.con:
      return "bg-[#FFA8A8] border-[#CC0000]";
  }
};
