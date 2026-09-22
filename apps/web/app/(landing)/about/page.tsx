import type { Metadata } from "next";
import { AboutPageClient } from "@/features/landing/components/about-page-client";

export const metadata: Metadata = {
  title: "About",
  description:
    "Lumen — Latin for light, the SI unit of luminous flux. An open-source project management platform for human + agent teams.",
  openGraph: {
    title: "About Lumen",
    description:
      "The story behind Lumen and why we're building project management for human + agent teams.",
    url: "/about",
  },
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return <AboutPageClient />;
}
