var d3SaveSvg = require("d3-save-svg");

export const SvgDownload = () => {
  const downloadSVG = () => {
    var config = {
      filename: "dialogger_" + new Date().toLocaleDateString(),
    };
    d3SaveSvg.save(
      document.getElementById("tree")?.querySelector("svg"),
      config
    );
  };

  return (
    <div id="svg-download" className="text-sm fixed top-4 left-4">
      <button
        onClick={downloadSVG}
        id="fullscreen"
        className="hover:opacity-80"
      >
        <i className="fas fa-download"></i>
      </button>
    </div>
  );
};
