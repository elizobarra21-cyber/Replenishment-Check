"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { storePendingInvite } from "@/lib/client-storage";

// Invite link: remember the code and go through the regular sign-in. The main
// screen joins the store as soon as the user is signed in.
export default function JoinStorePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    storePendingInvite(code);
    router.replace("/");
  }, [code, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-black/50">
      Joining store...
    </div>
  );
}
