"use client";

import { useState } from "react";
import { DEMO_USERS } from "@kds/contracts";
import { ApiError, api } from "@/lib/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      window.location.href = next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          list="demo-emails"
          required
        />
        <datalist id="demo-emails">
          {DEMO_USERS.map((u) => (
            <option key={u.email} value={u.email} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <div className="form-error">{error}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
