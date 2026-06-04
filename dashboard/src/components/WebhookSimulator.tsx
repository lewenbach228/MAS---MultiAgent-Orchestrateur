import { useEffect, useState } from "react";

interface Cb { receivedAt: string; body: any }

export default function WebhookSimulator() {
  const [logs, setLogs] = useState<Cb[]>([]);
  const [form, setForm] = useState({ brand: "", contact: "", terms: "" });
  const [sending, setSending] = useState(false);

  const fetchLogs = async () => {
    try { const r = await fetch("/api/webhooks/simulate/callbacks"); if (r.ok) setLogs(await r.json()); }
    catch { /* */ }
  };

  useEffect(() => {
    fetchLogs();
    const i = setInterval(fetchLogs, 3000);
    return () => clearInterval(i);
  }, []);

  const trigger = async () => {
    if (!form.brand || !form.contact) return;
    setSending(true);
    await fetch("/api/webhooks/onboard-partner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, callback_url: `${window.location.origin}/api/webhooks/simulate/callback` }),
    });
    setTimeout(() => { setSending(false); fetchLogs(); }, 2000);
  };

  const goal = form.brand
    ? `Onboard ${form.brand}, contact ${form.contact}${form.terms ? `, ${form.terms}` : ""}`
    : "Remplis le formulaire";

  return (
    <div className="anim-fade">
      <h1 className="page-title">Webhook Simulator</h1>
      <p className="page-sub">Simule un webhook Zapier pour tester le pipeline</p>

      <div className="g2">
        <div className="card">
          <div className="card-h">
            <div className="card-t">Simuler</div>
            <span className="card-b">POST /api/webhooks/onboard-partner</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"0.6rem"}}>
            <input className="fi" placeholder="Marque (ex: Nike)" value={form.brand}
              onChange={e => setForm({...form,brand:e.target.value})} />
            <input className="fi" placeholder="Email contact" value={form.contact}
              onChange={e => setForm({...form,contact:e.target.value})} />
            <input className="fi" placeholder="Terms (ex: 3 posts 15k€)" value={form.terms}
              onChange={e => setForm({...form,terms:e.target.value})} />
            <div className="text-xs text-muted" style={{background:"var(--bg-alt)",padding:"0.4rem 0.65rem",borderRadius:"var(--radius-sm)"}}>
              Goal: {goal}
            </div>
            <button onClick={trigger} disabled={!form.brand || !form.contact || sending} className="btn"
              style={{opacity:!form.brand||!form.contact?0.5:1}}>
              {sending ? "Envoi..." : "Envoyer"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-t">Callbacks</div>
            <span className="card-b">{logs.length} reçu{logs.length>1?"s":""}</span>
          </div>
          {!logs.length ? (
            <div className="empty" style={{padding:"1.5rem"}}>
              <div className="empty-i" style={{fontSize:"1.4rem"}}>📡</div>
              <div className="empty-d" style={{fontSize:"0.78rem"}}>Lance un webhook avec callback_url</div>
            </div>
          ) : (
            <div className="wl">
              {[...logs].reverse().map((l,i) => (
                <div key={i} className="wl-e">
                  <div className="wl-h">
                    <span className={`badge badge-${l.body.status||"pending"}`} style={{fontSize:"0.68rem"}}>
                      {l.body.status||"unknown"}
                    </span>
                    <span className="text-xs text-muted">{new Date(l.receivedAt).toLocaleTimeString()}</span>
                  </div>
                  <pre>{JSON.stringify(l.body,null,2)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
