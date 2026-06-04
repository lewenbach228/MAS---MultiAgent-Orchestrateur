import type { WorkflowEvent } from "../types";

function eventDesc(ev: WorkflowEvent): string {
  const d = ev.data;
  switch (ev.type) {
    case "WorkflowCreated": return d.goal;
    case "WorkflowPlanned": return `${d.steps} étapes planifiées`;
    case "StepCompleted": return `${d.step.tool} → ${JSON.stringify(d.output || d.step.args)}`;
    case "StepFailed": return `${d.step.tool} → ${d.error || "échec"}`;
    case "StepCompensated": return `${d.step.tool} → compensé`;
    case "WorkflowCompleted": return "Workflow terminé avec succès";
    case "WorkflowFailed": return "Workflow terminé avec échec";
    case "WorkflowCompensating": return "Compensation en cours…";
    case "WorkflowPlanning": return "Planification…";
    case "WorkflowExecuting": return "Exécution…";
    default: return ev.type;
  }
}

export default function EventTimeline({ events }: { events: WorkflowEvent[] }) {
  if (!events.length) {
    return <p className="text-sm text-muted" style={{ padding: "0.75rem 0" }}>Aucun événement</p>;
  }

  return (
    <div className="tl">
      {events.map((ev, i) => (
        <div key={i} className="ev">
          <div className="ev-h">
            <span className="ev-t">{ev.type.replace("Workflow", "")}</span>
            <span className="ev-ts">
              +{((new Date(ev.timestamp).getTime() - new Date(events[0].timestamp).getTime()) / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="ev-d">{eventDesc(ev)}</div>
        </div>
      ))}
    </div>
  );
}
