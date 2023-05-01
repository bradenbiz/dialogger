import './style.css';
import * as Treeviz from 'treeviz';

interface NodeData {
    id: number,
    text_1: string,
    father: number | null
}

// Define a dataset
var data: NodeData[] = [
    { id: 1, text_1: "Father", father: null },
    { id: 2, text_1: "Child A", father: 1 },
    { id: 3, text_1: "Child B", father: 1 },
    { id: 4, text_1: "Subchild C", father: 2 }
  ];
  
  // Define and configure a tree object
  var myTree = Treeviz.create({
    htmlId: "tree",
    idKey: "id",
    hasFlatData: true,
    isHorizontal:true,
    nodeWidth: 120,
    nodeHeight: 50,
    mainAxisNodeSpacing: 3,
    secondaryAxisNodeSpacing: 3,
    hasPan: true,
    hasZoom: true,
    linkWidth : (nodeData: NodeData) => 5,
    linkShape: "quadraticBeziers",
    linkColor : (nodeData: NodeData) => "#B0BEC5" ,
    onNodeClick : (nodeData: NodeData) => console.log(nodeData),
    // nodeColor: (nodeData) => "grey",
    renderNode: (node) => {
        console.log(node);
        return `
            <div class="node" style="width:  ${node.settings.nodeWidth}px; height: ${node.settings.nodeHeight}px;">
                <img width="10" src="https://th.bing.com/th/id/R.a3f9fb567ec1ebd7544e4b207d103e74?rik=%2fwwrpk%2bS%2f%2bLp8Q&riu=http%3a%2f%2fwww.bplampsupply.com%2fimages%2fproducts%2flg%2f47261_alt_0.jpg&ehk=dHva4pcJB3%2f6PpX56oouwOrDRpY8vJ9GfYfXTHdN5%2fQ%3d&risl=&pid=ImgRaw&r=0">
                ${node.data.text_1}
            </div>
            
        `;
    },
    relationnalField: "father",
  });
  
  // Display the tree based on the data
  myTree.refresh(data);