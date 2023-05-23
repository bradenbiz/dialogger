import { NodeType } from "./NodeType";

export interface ButtonProps {
    id: string | NodeType, 
    icon: string, 
    color: string, 
    hoverColor: string,
    pos: string
}