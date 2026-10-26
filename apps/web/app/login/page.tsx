import { DEMO_PASSWORD, DEMO_USERS } from "@kds/contracts";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site paths, to avoid an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">🍓</span> Edible KDS
        </div>
        <p className="muted">Production kitchen display. Sign in to your station.</p>
        <LoginForm next={safeNext} />
        <details className="demo-accounts">
          <summary>Demo accounts</summary>
          <p className="muted small">
            All use the password <code>{DEMO_PASSWORD}</code>
          </p>
          <ul>
            {DEMO_USERS.map((u) => (
              <li key={u.email}>
                <code>{u.email}</code> <span className="muted">— {u.role}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </main>
  );
}
