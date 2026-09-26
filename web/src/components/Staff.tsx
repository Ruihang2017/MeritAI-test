import type { Api } from "../api";

// M2 builds this page; M1 keeps the nav working.
export function StaffPage(_: { api: Api; onAsk: (text: string) => void; onChanged: () => void }) {
  return (
    <main className="main">
      <div className="page-h">
        <h1 className="h1" style={{ fontSize: 20 }}>Staff</h1>
      </div>
      <div className="center dots">
        <div className="card empty-card">
          <b>Coming in the next milestone</b>
        </div>
      </div>
    </main>
  );
}
