import { useState } from "react";

export const Contact = () => {
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 3000);
    var dummy = document.createElement("input");
    document.body.appendChild(dummy);
    dummy.setAttribute("value", "nbsp@hey.com");
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
  };

  return (
    <div id="contact" className="text-sm fixed top-4 right-4">
      {!copied ? (
        <div>
          What do you like / dislike? Email me at{" "}
          <span className="underline hover:cursor-pointer" onClick={copyEmail}>
            bispingbraden@gmail.com
          </span>
          !
        </div>
      ) : (
        <div className="italic">email address copied to clipboard</div>
      )}
    </div>
  );
};
