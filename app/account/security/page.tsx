"use client";

import { Security } from "@/components/user/email-flows";
import { RailShell, useUserGate } from "@/components/user/shell";

export default function Page() {
  const user = useUserGate();
  if (!user) return null;
  return <RailShell title="Password and security" description={user.email}><Security /></RailShell>;
}
