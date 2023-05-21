import { kv } from "@vercel/kv";

export default async function ViewCounter() {
  const views = await kv.incr("views");

  return <p className="text-sm fixed top-4 left-4">{views} views</p>;
}
