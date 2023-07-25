"use client";

import { Suspense, useEffect, useState } from "react";
import { Contact, Fullscreen, SvgDownload, Voice } from "../components";
import { Tree } from "../components/client/tree/Tree";
import "../app/style.css";
import Head from "next/head";
import { NodeData, NodeType } from "@/components/client/tree/types";

export default function Page() {
    const [nodes, setNodes] = useState<NodeData[]>([
        { id: 1, label: "Chicken or egg first?", type: NodeType.question, parent: null },
        // { id: 2, label: "Chicken", type: NodeType.idea, parent: 1 },
        // { id: 3, label: "Egg", type: NodeType.decision, parent: 1 },
        // { id: 4, label: "Taste good", type: NodeType.pro, parent: 3 },
        // { id: 5, label: "Impossible", type: NodeType.con, parent: 3 },
    ]);

    useEffect(() => {
        console.log('GLOBAL NODES', nodes);
    }, [nodes])
    return (
        <>
            <Head>
                <title>Twiglog</title>
                <meta name="description" content="Clear-cut conversations" />
                <meta charSet="UTF-8" />
                <link rel="icon" type="image/png" href="favicon.png" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <link
                    rel="stylesheet"
                    href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
                />
            </Head>
            <main className="w-screen h-screen">
                <Tree nodes={nodes} setNodes={setNodes} />
                <Suspense>{/* <ViewCounter /> */}</Suspense>
                <SvgDownload />
                <Contact />
                <Fullscreen />
                <Voice nodes={nodes} setNodes={setNodes} />
                {/* <AddNewIssue /> */}
            </main>
        </>
    );
}