"use client";

import { useMemo, useState } from "react";
import {
  ALLERGENS,
  STATION_KINDS,
  criticalPathSec,
  validateDag,
  type Allergen,
  type Recipe,
  type RecipeStep,
} from "@kds/contracts";
import type { listProducts } from "@kds/domain";
import { useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";
import { fmtDuration, label } from "@/lib/format";
import type { Jsonify } from "@/lib/types";

type Product = Jsonify<Awaited<ReturnType<typeof listProducts>>[number]>;

const blankStep = (n: number): RecipeStep => ({
  key: `step-${n}`,
  name: "",
  stationKind: "FRUIT",
  durationSec: 120,
  dependsOn: [],
  instructions: "",
});

export function RecipeAdmin({ initial }: { initial: Product[] }) {
  const [products, setProducts] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const toast = useToast();
  const selected = products.find((p) => p.id === selectedId) ?? null;

  async function refresh(keep?: string) {
    const r = await api<{ products: Product[] }>("/api/admin/products");
    setProducts(r.products);
    if (keep) setSelectedId(keep);
  }

  return (
    <main className="page admin">
      <aside className="admin-list">
        <h2>Products</h2>
        <ul>
          {products.map((p) => (
            <li key={p.id}>
              <button className={`list-btn ${p.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(p.id)}>
                <b>{p.name}</b>
                <span className="muted small">
                  {p.sku} · {p.published ? `v${p.published.version} live` : "not published"}
                  {p.draft ? " · draft" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <NewProduct
          onCreated={async (id) => {
            await refresh(id);
            toast.ok("Product created. Add its recipe steps.");
          }}
          onError={toast.error}
        />
      </aside>
      <section className="admin-main">
        {selected ? (
          <Editor key={`${selected.id}-${selected.draft?.id ?? selected.published?.id ?? "new"}`} product={selected} onSaved={() => refresh(selected.id)} toast={toast} />
        ) : (
          <p className="muted">Select or create a product.</p>
        )}
      </section>
      {toast.node}
    </main>
  );
}

function NewProduct({ onCreated, onError }: { onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const { product } = await api<{ product: { id: string } }>("/api/admin/products", { body: { sku, name } });
          setSku("");
          setName("");
          onCreated(product.id);
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Couldn't create product");
        }
      }}
    >
      <h3>New product</h3>
      <label className="field">
        <span>SKU</span>
        <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="e.g. PB-06" required />
      </label>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pineapple Bloom (6)" required />
      </label>
      <button className="btn btn-primary">Create</button>
    </form>
  );
}

function Editor({ product, onSaved, toast }: { product: Product; onSaved: () => Promise<void>; toast: ReturnType<typeof useToast> }) {
  const source = (product.draft ?? product.published)?.body as Recipe | undefined;
  const [steps, setSteps] = useState<RecipeStep[]>(source?.steps ?? [blankStep(1)]);
  const [components, setComponents] = useState((source?.components ?? []).join(", "));
  const [allergens, setAllergens] = useState<Allergen[]>(source?.allergens ?? []);
  const [busy, setBusy] = useState(false);

  const dag = useMemo(() => validateDag(steps), [steps]);
  const missingNames = steps.some((s) => !s.name.trim());
  const critical = dag.ok ? criticalPathSec(steps) : null;

  const update = (i: number, patch: Partial<RecipeStep>) =>
    setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i: number) =>
    setSteps((ss) => {
      const key = ss[i]!.key;
      return ss.filter((_, j) => j !== i).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== key) }));
    });
  const rename = (i: number, key: string) =>
    setSteps((ss) => {
      const old = ss[i]!.key;
      return ss.map((s, j) => ({ ...(j === i ? { ...s, key } : s), dependsOn: s.dependsOn.map((d) => (d === old ? key : d)) }));
    });

  async function save() {
    setBusy(true);
    try {
      await api(`/api/admin/products/${product.id}/draft`, {
        method: "PUT",
        body: {
          steps,
          components: components.split(",").map((c) => c.trim()).filter(Boolean),
          allergens,
        },
      });
      toast.ok("Draft saved");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      await api(`/api/admin/products/${product.id}/publish`, { body: {} });
      toast.ok("Published. New orders use this version.");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1>
          {product.name} <span className="muted small">{product.sku}</span>
        </h1>
        <div className="head-stats">
          {product.published && <span className="chip chip-done">v{product.published.version} live</span>}
          {product.draft && <span className="chip chip-on_hold">Draft v{product.draft.version}</span>}
        </div>
      </div>
      <p className="muted small">
        Editing saves a draft. Publishing makes it the version new orders use; orders already in progress keep the recipe they started with.
      </p>

      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className="step card">
            <div className="step-grid">
              <label className="field">
                <span>Key</span>
                <input value={s.key} onChange={(e) => rename(i, e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} />
              </label>
              <label className="field grow">
                <span>Step name</span>
                <input value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Dip strawberries" />
              </label>
              <label className="field">
                <span>Station</span>
                <select value={s.stationKind} onChange={(e) => update(i, { stationKind: e.target.value as RecipeStep["stationKind"] })}>
                  {STATION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Target (sec)</span>
                <input type="number" min={10} max={3600} value={s.durationSec} onChange={(e) => update(i, { durationSec: Number(e.target.value) })} />
              </label>
              <button className="btn btn-ghost" onClick={() => remove(i)} disabled={steps.length === 1} title="Remove step">
                🗑
              </button>
            </div>
            <div className="deps">
              <span className="muted small">After:</span>
              {steps
                .filter((o) => o.key !== s.key)
                .map((o) => (
                  <label key={o.key} className="dep">
                    <input
                      type="checkbox"
                      checked={s.dependsOn.includes(o.key)}
                      onChange={(e) =>
                        update(i, { dependsOn: e.target.checked ? [...s.dependsOn, o.key] : s.dependsOn.filter((d) => d !== o.key) })
                      }
                    />
                    {o.name || o.key}
                  </label>
                ))}
              {steps.length === 1 && <span className="muted small">(first step)</span>}
            </div>
            <label className="field">
              <span>Instructions</span>
              <input value={s.instructions} onChange={(e) => update(i, { instructions: e.target.value })} maxLength={500} />
            </label>
          </div>
        ))}
        <button className="btn" onClick={() => setSteps((ss) => [...ss, blankStep(ss.length + 1)])}>
          + Add step
        </button>
      </div>

      <label className="field">
        <span>Components (comma separated, shown to QC)</span>
        <input value={components} onChange={(e) => setComponents(e.target.value)} />
      </label>
      <div>
        <span className="field-label">Allergens</span>
        <div className="deps">
          {ALLERGENS.map((a) => (
            <label key={a} className="dep">
              <input
                type="checkbox"
                checked={allergens.includes(a)}
                onChange={(e) => setAllergens(e.target.checked ? [...allergens, a] : allergens.filter((x) => x !== a))}
              />
              {label(a)}
            </label>
          ))}
        </div>
      </div>

      {!dag.ok && <div className="banner banner-error">{dag.errors.join(" · ")}</div>}
      {dag.ok && <div className="muted small">Step order: {dag.order.join(" → ")} · Minimum production time {fmtDuration(critical)}</div>}
      <div className="row-actions start">
        <button className="btn btn-primary btn-lg" disabled={busy || !dag.ok || missingNames} onClick={save}>
          Save draft
        </button>
        <button className="btn btn-complete btn-lg" disabled={busy || !product.draft} onClick={publish} title={product.draft ? "" : "Save a draft first"}>
          Publish draft
        </button>
      </div>
    </div>
  );
}
