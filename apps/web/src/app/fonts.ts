import {
  Atkinson_Hyperlegible,
  Averia_Libre,
  Dongle,
  Fraunces,
  IBM_Plex_Sans,
  Inter,
  Libre_Baskerville,
  Lora,
  Nunito_Sans,
} from "next/font/google";

const atkinsonHyperlegible = Atkinson_Hyperlegible({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-atkinson",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-ibm-plex-sans",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-fraunces",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-inter",
});

const averiaLibre = Averia_Libre({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-averia-libre",
});

const dongle = Dongle({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-dongle",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-nunito-sans",
});

const lora = Lora({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
  variable: "--font-lora",
});

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-libre-baskerville",
});

export const appFontVariablesClassName = [
  atkinsonHyperlegible.variable,
  ibmPlexSans.variable,
  fraunces.variable,
  inter.variable,
  averiaLibre.variable,
  dongle.variable,
  nunitoSans.variable,
  lora.variable,
  libreBaskerville.variable,
].join(" ");
