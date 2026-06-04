import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowState } from "../types";
import { useWebSocket } from "../hooks/useWebSocket";

interface Toast { id: number; workflowId: string; status: string }

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
  // "Onboard Nike as brand partner..." → "Nike"
  // "Onboard brand partner Red Bull..." → "Red Bull"
  // "Create campaign for Nike..." → "Nike"
  // Fallback: first capitalized word after known prefixes
  const m = goal.match(
    /Onboard\s+(?:brand\s+partner\s+)?([A-Z][a-zA-Z0-9\s.]+?)(?:\s+as|\s*,|\s+contact|\s+terms|$)/,
  );
  if (m) return m[1].trim();
  const m2 = goal.match(
    /(?:campaign|for|launch)\s+([A-Z][a-zA-Z0-9\s.]+?)(?:\s*,|\s+as|\s+contact|\s+with|$)/,
  );
  if (m2) return m2[1].trim();
  // Last resort: first capitalized word
  const m3 = goal.match(/([A-Z][a-z]+)/);
  return m3 ? m3[1] : goal.slice(0, 36);
}

export default function WorkflowList() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((workflowId: string, status: string) => {
    const id = Date.now();
    setToasts(p => [...p.slice(-4), { id, workflowId, status }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  const fetchWf = async () => {
    try {
      const res = await fetch("/api/workflows");
      setWorkflows(await res.json());
      setLoading(false);
    } catch { /* retry */ }
  };

  useEffect(() => {
    fetchWf();
    const i = setInterval(fetchWf, 5000);
    return () => clearInterval(i);
  }, []);

  useWebSocket((msg: any) => {
    if (["WorkflowCompleted", "WorkflowFailed", "WorkflowExecuting"].includes(msg.type)) {
      addToast(msg.workflowId, msg.data?.status || msg.type.replace("Workflow", "").toLowerCase());
    }
    fetchWf();
  });

  const total = workflows.length;
  const completed = workflows.filter(w => w.status === "completed").length;
  const failed = workflows.filter(w => w.status === "failed").length;
  const active = total - completed - failed;

  if (loading) return (
    <div>
      <h1 className="page-title">Workflows</h1>
      <p className="page-sub">Surveillance en temps réel des processus</p>
      <div className="stats">{Array.from({length:4}, (_,i) => <div key={i} className="stat skel" style={{height:72}} />)}</div>
      {Array.from({length:3}, (_,i) => <div key={i} className="card skel" style={{height:52,marginBottom:6}} />)}
    </div>
  );

  return (
    <div>
      <h1 className="page-title">Workflows</h1>
      <p className="page-sub">Surveillance en temps réel des processus</p>

      <div className="stats">
        <div className="stat total">
          <div className="stat-l">Total</div>
          <div className="stat-v">{total}</div>
        </div>
        <div className="stat active">
          <div className="stat-l">En cours</div>
          <div className="stat-v">{active}</div>
        </div>
        <div className="stat ok">
          <div className="stat-l">Réussis</div>
          <div className="stat-v">{completed}</div>
        </div>
        <div className="stat ko">
          <div className="stat-l">Échecs</div>
          <div className="stat-v">{failed}</div>
        </div>
      </div>

      <div className="card card-flush">
        {workflows.length === 0 ? (
          <div className="empty">
            <div className="empty-i">⚡</div>
            <div className="empty-t">Aucun workflow</div>
            <div className="empty-d">
              Lance un workflow via <code>POST /api/workflows</code> ou{" "}
              <code>POST /api/webhooks/onboard-partner</code>
            </div>
          </div>
        ) : (
          <div className="t-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width:80}}>Statut</th>
                  <th>Marque / Objectif</th>
                  <th style={{width:60}}>Steps</th>
                  <th style={{width:70}}>Créé</th>
                  <th style={{width:30}} />
                </tr>
              </thead>
              <tbody>
                {workflows.map(wf => (
                  <tr
                    key={wf.workflowId}
                    onClick={() => navigate(`/workflow/${wf.workflowId}`)}
                    style={{cursor:"pointer"}}
                    title="Voir les détails"
                  >
                    <td><span className={`badge badge-${wf.status}`}>{statusLabel(wf.status)}</span></td>
                    <td>
                      <div style={{display:"flex",flexDirection:"column",gap:1}}>
                        <span style={{fontWeight:600,fontSize:"0.9rem",color:"var(--text)"}}>
                          {extractBrand(wf.goal)}
                        </span>
                        <span className="text-xs text-dim" style={{fontSize:"0.75rem"}}>
                          {wf.goal.length > 70 ? wf.goal.slice(0, 70) + "…" : wf.goal}
                        </span>
                      </div>
                    </td>
                    <td><span className="text-sm text-dim">{wf.executionLog.length}</span></td>
                    <td><span className="text-xs text-muted" style={{whiteSpace:"nowrap"}}>
                      {new Date(wf.createdAt).toLocaleString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                    </span></td>
                    <td style={{textAlign:"right"}}>
                      <span className="chevron">→</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="tc">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.status}`} onClick={() => navigate(`/workflow/${t.workflowId}`)} style={{cursor:"pointer"}}>
              <span>{t.status === "completed" ? "✓" : t.status === "failed" ? "✗" : "⚙"}</span>
              <span style={{fontWeight:600,marginLeft:"0.25rem"}}>{t.workflowId.slice(0, 12)}</span>
              <span style={{marginLeft:"auto",color:"var(--text-muted)",fontSize:"0.78rem"}}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
