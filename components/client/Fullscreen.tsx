"use client";

import { useState } from "react";

export const Fullscreen = () => {
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!fullscreen) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setFullscreen(!fullscreen);
  };

  return (
    <div id="screen" className="fixed bottom-4 right-4">
      {!fullscreen && (
        <button
          onClick={toggleFullscreen}
          id="fullscreen"
          className="hover:opacity-80"
        >
          <i className="fas fa-expand"></i>
        </button>
      )}
      {fullscreen && (
        <button
          onClick={toggleFullscreen}
          id="unfullscreen"
          className="hover:opacity-80"
        >
          <i className="fas fa-compress"></i>
        </button>
      )}
    </div>
  );
};
