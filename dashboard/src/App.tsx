import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import WorkflowList from "./components/WorkflowList.tsx";
import WorkflowDetail from "./components/WorkflowDetail.tsx";
import WebhookSimulator from "./components/WebhookSimulator.tsx";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <Link to="/" className="nav-title">P2 — Process Orchestrator</Link>
        <div className="nav-links">
          <Link to="/">Workflows</Link>
          <Link to="/webhooks">Webhooks</Link>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<WorkflowList />} />
          <Route path="/workflow/:id" element={<WorkflowDetail />} />
          <Route path="/webhooks" element={<WebhookSimulator />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
