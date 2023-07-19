"use client";

import { Suspense } from "react";
import { Contact, Fullscreen, SvgDownload } from "../../components";
import { Tree } from "../../components/client/tree/Tree";
import "../style.css";

export default function Page() {
  return (
    <main className="w-screen h-screen">
      <Tree />
      <Suspense>{/* <ViewCounter /> */}</Suspense>
      <SvgDownload />
      <Contact />
      <Fullscreen />
      {/* <AddNewIssue /> */}
    </main>
  );
}
