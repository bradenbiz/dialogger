export const getGraph = () => {
  const tree = document.getElementById("tree");
  return tree ? tree.firstElementChild?.firstElementChild : null;
};
