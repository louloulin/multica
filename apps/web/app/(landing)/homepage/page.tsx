import type { Metadata } from "next";
import { LumenLanding } from "@/features/landing/components/lumen-landing";

export const metadata: Metadata = {
  title: "Homepage",
  description:
    "Lumen — open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills.",
  openGraph: {
    title: "Lumen — Project Management for Human + Agent Teams",
    description:
      "Manage your human + agent workforce in one place.",
    url: "/homepage",
  },
  alternates: {
    canonical: "/homepage",
  },
};

export default function HomepagePage() {
  return <LumenLanding />;
}
