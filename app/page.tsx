import ViewCounter from "@/components/ViewCounter";
import { Suspense } from "react";
import { Fullscreen, Tree } from "../components";

export default function Home() {
  return (
    <main>
      <Tree></Tree>

      <Suspense>
        {/* @ts-expect-error Async Server Component */}
        <ViewCounter />
      </Suspense>

      <Fullscreen></Fullscreen>
      {/* <AddNewIssue></AddNewIssue> */}
    </main>
  );
}
