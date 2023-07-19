"use client";

import { Suspense } from "react";
import { AddNewIssue, Fullscreen } from "../../components";
import { Tree } from "../../components/client/tree/Tree";
import "../style.css";

export default function Page() {
  return (
    <main className="w-screen h-screen">
      <Tree />
      <Suspense>{/* <ViewCounter /> */}</Suspense>
      <Fullscreen />
      <AddNewIssue />
    </main>
  );
}
