import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { WorkflowState, WorkflowEvent } from "../types";
import { useWebSocket } from "../hooks/useWebSocket";
import EventTimeline from "./EventTimeline.tsx";

function statusLabel(s: string): string {
  const labels: Record<string, string> = {
    pending: "en attente",
    planning: "planification",
    executing: "exécution",
    compensating: "compensation",
    completed: "succès",
    failed: "échec",
  };
  return labels[s] || s;
}

function extractBrand(goal: string): string {
  const m = goal.match(
    /Onboard\s+(?:brand\s+partner\s+)?([A-Z][a-zA-Z0-9\s.]+?)(?:\s+as|\s*,|\s+contact|\s+terms|$)/,
  );
  if (m) return m[1].trim();
  const m2 = goal.match(
    /(?:campaign|for|launch)\s+([A-Z][a-zA-Z0-9\s.]+?)(?:\s*,|\s+as|\s+contact|\s+with|$)/,
  );
  if (m2) return m2[1].trim();
  const m3 = goal.match(/([A-Z][a-z]+)/);
  return m3 ? m3[1] : goal.slice(0, 36);
}

function fmtOutput(output: any): string {
  if (!output) return "—";
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(output)) {
    if (typeof v === "string" && v.length > 60) clean[k] = v.slice(0, 60) + "…";
    else clean[k] = v;
  }
  return JSON.stringify(clean);
}

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const [wf, setWf] = useState<WorkflowState | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);

  const fetchData = async () => {
    if (!id) return;
    const [wr, er] = await Promise.all([
      fetch(`/api/workflows/${id}`),
      fetch(`/api/workflows/${id}/events`),
    ]);
    if (wr.ok) setWf(await wr.json());
    if (er.ok) setEvents(await er.json());
  };

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 3000);
    return () => clearInterval(i);
  }, [id]);

  useWebSocket((msg: any) => {
    if (msg.type === "workflow_update" && msg.workflowId === id) fetchData();
  });

  if (!wf) return (
    <div>
      <Link to="/" className="t-link">← Retour</Link>
      <div className="loading" style={{ marginTop: "2rem" }}>
        <div className="skel" style={{ width: 280, height: 22, margin: "0 auto", borderRadius: 6 }} />
        <div className="skel" style={{ width: 180, height: 14, margin: "1rem auto", borderRadius: 6 }} />
      </div>
    </div>
  );

  const execSteps = wf.executionLog;
  const compSteps = wf.compensationLog;

  return (
    <div className="anim-fade">
      <Link to="/" className="t-link">← Retour aux workflows</Link>

      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-2" style={{ flexWrap: "wrap" }}>
        <span className={`badge badge-${wf.status}`} style={{ fontSize: "0.82rem", padding: "0.25rem 1rem" }}>
          {statusLabel(wf.status)}
        </span>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0, fontSize: "1.2rem" }}>
            {extractBrand(wf.goal)}
          </h1>
          <p className="text-sm text-dim mt-1">{wf.goal}</p>
        </div>
      </div>

      {/* Objectif + Callback */}
      <div className="g2">
        <div className="card">
          <div className="card-h">
            <div className="card-t">Création</div>
            <span className="card-b">{new Date(wf.createdAt).toLocaleString()}</span>
          </div>
          {wf.updatedAt !== wf.createdAt && (
            <div className="text-xs text-muted mb-1">
              Mis à jour : {new Date(wf.updatedAt).toLocaleTimeString()}
            </div>
          )}
          <div className="text-xs text-muted mono">ID : {wf.workflowId}</div>
          {wf.callbackUrl && (
            <div className="text-xs mt-1" style={{ color: "var(--teal)" }}>
              Callback : {wf.callbackUrl}
            </div>
          )}
        </div>

        {wf.plan && (
          <div className="card">
            <div className="card-h">
              <div className="card-t">Plan ({wf.plan.steps.length} étapes)</div>
            </div>
            <p className="text-sm text-dim mb-2" style={{ lineHeight: 1.6, fontSize: "0.85rem" }}>
              {wf.plan.analysis}
            </p>
            <div className="sl">
              {wf.plan.steps.map((s, i) => {
                const ex = execSteps.find(e => e.step.tool === s.tool && e.index === i);
                const st = ex ? (ex.success ? "ok" : "ko") : "";
                return (
                  <div key={i} className="si">
                    <div className={`sn ${st}`}>{i + 1}</div>
                    <div className="sc">
                      <div className="sn-m">{s.tool}</div>
                      <div className="sn-d">{s.description}</div>
                    </div>
                    {ex && (
                      <span className={ex.success ? "s-ok" : "s-ko"} style={{ fontSize: "0.75rem" }}>
                        {ex.success ? "✓" : "✗"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Execution steps */}
      <div className="card">
        <div className="card-h">
          <div className="card-t">
            Exécution{" "}
            <span style={{ fontWeight: 400, marginLeft: "0.35rem", color: "var(--text-muted)" }}>
              {execSteps.length} step{execSteps.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        {execSteps.length === 0 ? (
          <p className="text-sm text-muted">En attente d'exécution…</p>
        ) : (
          <div className="t-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 160 }}>Outil</th>
                  <th style={{ width: 72 }}>Résultat</th>
                  <th>Sortie</th>
                </tr>
              </thead>
              <tbody>
                {execSteps.sort((a, b) => a.index - b.index).map((e, i) => (
                  <tr key={i} className="anim-slide">
                    <td className="mono">#{e.index + 1}</td>
                    <td>{e.step.tool}</td>
                    <td>{e.success ? <span className="s-ok">✓</span> : <span className="s-ko">✗</span>}</td>
                    <td className="text-sm">
                      <code className="mono" style={{ fontSize: "0.72rem", color: "var(--text-dim)", wordBreak: "break-all" }}>
                        {e.error ? (
                          <span style={{ color: "var(--error)" }}>{e.error.slice(0, 200)}</span>
                        ) : (
                          fmtOutput(e.output)
                        )}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Compensation steps (le cas échéant) */}
      {compSteps.length > 0 && (
        <div className="card" style={{ borderColor: "rgba(245,158,11,0.25)" }}>
          <div className="card-h">
            <div className="card-t" style={{ color: "#fdba74" }}>
              Compensation ⚠
              <span style={{ fontWeight: 400, marginLeft: "0.35rem", color: "var(--text-muted)" }}>
                {compSteps.length} step{compSteps.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="t-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 160 }}>Outil</th>
                  <th style={{ width: 72 }}>Résultat</th>
                  <th>Sortie</th>
                </tr>
              </thead>
              <tbody>
                {compSteps.sort((a, b) => a.index - b.index).map((e, i) => (
                  <tr key={i} className="anim-slide">
                    <td className="mono" style={{ color: "#f97316" }}>c#{e.index + 1}</td>
                    <td>{e.step.tool}</td>
                    <td>{e.success ? <span className="s-ok">✓</span> : <span className="s-ko">✗</span>}</td>
                    <td className="text-sm">
                      <code className="mono" style={{ fontSize: "0.72rem", color: "var(--text-dim)", wordBreak: "break-all" }}>
                        {e.error ? (
                          <span style={{ color: "var(--error)" }}>{e.error.slice(0, 200)}</span>
                        ) : (
                          fmtOutput(e.output)
                        )}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Event sourcing */}
      <div className="card">
        <div className="card-h">
          <div className="card-t">
            Event Sourcing{" "}
            <span style={{ fontWeight: 400, marginLeft: "0.35rem", color: "var(--text-muted)" }}>
              {events.length} event{events.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <EventTimeline events={events} />
      </div>
    </div>
  );
}
