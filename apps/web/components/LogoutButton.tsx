"use client";

import { api } from "@/lib/client";

export function LogoutButton() {
  return (
    <button
      className="btn btn-ghost"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
