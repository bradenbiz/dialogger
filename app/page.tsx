"use client";

import Image from "next/image";
import Link from "next/link";
import "./style.css";

export default function Home() {
  return (
    <main>
      <div className="font-light w-screen h-screen bg-white flex flex-col justify-center items-center gap-24">
        <div className="flex flex-col justify-center items-center">
          <div className="flex flex-row justify-center items-center">
            <Image
              src="/twig.png"
              alt="Dialogger title"
              className="xl:w-1/2 md:w-2/3 sm:w-9/12 w-10/12"
              width={500}
              height={500}
              priority
            />
            <h1 className="text-9xl">Twiglog</h1>
          </div>
          <p className="text-xl">for clear-cut conversations </p>
        </div>
        <button className="bg-[#F0B357] border-2 border-black px-6 py-4 rounded-lg text-2xl">
          <Link href="/demo">Try the demo</Link>
        </button>
      </div>
    </main>
  );
}
