import { useEffect, useState } from "react";
import { api } from "./api.js";

// A decision receipt: allowed or denied, the rule that decided it, and why.
export function Receipt({ result }) {
  if (!result) return null;
  const data = result.data ?? {};
  const allowed = result.ok;
  const text = data.receipt ?? data.error ?? "Something went wrong.";
  return (
    <div className={`receipt ${allowed ? "allowed" : "denied"}`} role="status">
      <span className="receipt-tag">{allowed ? "ALLOWED" : "DENIED"}</span>
      {data.rule && <span className="rule" title={data.ruleTitle}>{data.rule}</span>}
      <span>{text}</span>
    </div>
  );
}

export function Chips({ items, empty = "none" }) {
  if (!items?.length) return <span className="muted">{empty}</span>;
  return items.map((item) => (
    <span key={item} className="chip">
      {item}
    </span>
  ));
}

export function Status({ value }) {
  return <span className={`status s-${value}`}>{value.replace("_", " ")}</span>;
}

// Advisory confidence score, always shown with its reasons.
export function ScoreCard({ sub, compact = false }) {
  const [score, setScore] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/api/score/${encodeURIComponent(sub)}`).then((res) => live && res.ok && setScore(res.data));
    return () => {
      live = false;
    };
  }, [sub]);
  if (!score) return null;
  return (
    <div className={`score ${compact ? "compact" : ""}`}>
      <div className="score-head">
        <span className="score-num">{score.score}</span>
        <span>
          <strong>Confidence score</strong> {score.label && <em>· {score.label}</em>}
          <br />
          <small className="muted">{score.advisory}</small>
        </span>
      </div>
      {score.factors.length > 0 && (
        <ul className="factors">
          {score.factors.map((f, i) => (
            <li key={i}>
              <span className={f.delta > 0 ? "plus" : "minus"}>{f.delta > 0 ? `+${f.delta}` : f.delta}</span> {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
