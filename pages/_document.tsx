import { Html, Head, Main, NextScript } from 'next/document';
import { Jost } from 'next/font/google';

const jost = Jost({
    variable: "--font-jost",
    subsets: ["latin"],
    display: "swap",
});
 
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className={jost.variable}>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}