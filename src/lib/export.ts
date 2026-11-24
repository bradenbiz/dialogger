import { type DialogueSession, type IBISNode } from "@shared/schemas/models";
import { IBIS_NODE_META } from "@shared/ibis";
import { computeDialogueMapLayout } from "./layout";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxChars = 34): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "dialogue-map"
  );
}

export function exportMapAsSvg(session: DialogueSession): void {
  const layout = computeDialogueMapLayout(
    session.nodes,
    session.crossLinks,
    new Set()
  );
  const speakerMap = new Map(session.speakers.map((s) => [s.id, s]));

  const edgesSvg = layout.edges
    .map((e) => {
      const meta = IBIS_NODE_META[e.targetType];
      return `
      <path d="${e.path}" fill="none" stroke="${meta.border}" stroke-width="2.2" />
      ${
        e.label
          ? `<text x="${e.labelX}" y="${e.labelY}" text-anchor="middle" font-size="10" font-family="system-ui, sans-serif" fill="#78716C">${escapeXml(e.label)}</text>`
          : ""
      }`;
    })
    .join("\n");

  const crossSvg = layout.crossLinks
    .map(
      (c) => `
      <path d="${c.path}" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="5 4" />
      <text x="${c.labelX}" y="${c.labelY}" text-anchor="middle" font-size="10" font-family="system-ui, sans-serif" fill="#64748B">${escapeXml(c.link.label || c.link.kind)}</text>`
    )
    .join("\n");

  const nodesSvg = layout.nodes
    .map((p) => {
      const meta = IBIS_NODE_META[p.node.type];
      const lines = wrapText(p.node.label, 33);
      const speakers = p.node.speakerIds
        .map((id) => speakerMap.get(id)?.name || id)
        .join(", ");
      const textLines = lines
        .map(
          (l, idx) =>
            `<tspan x="${p.x + 48}" dy="${idx === 0 ? 0 : 16}">${escapeXml(l)}</tspan>`
        )
        .join("");

      return `
      <g>
        <rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="12" fill="${meta.bg}" stroke="${meta.border}" stroke-width="1.75" />
        <rect x="${p.x + 12}" y="${p.y + 14}" width="26" height="26" rx="8" fill="${meta.badgeBg}" />
        <text x="${p.x + 25}" y="${p.y + 32}" text-anchor="middle" font-size="14" font-weight="700" font-family="system-ui, sans-serif" fill="${meta.badgeText}">${escapeXml(meta.symbol)}</text>
        <text x="${p.x + 48}" y="${p.y + 27}" font-size="12.5" font-weight="600" font-family="system-ui, sans-serif" fill="#1C1917">${textLines}</text>
        ${
          speakers
            ? `<text x="${p.x + 48}" y="${p.y + p.height - 10}" font-size="10" font-family="system-ui, sans-serif" fill="#78716C">${escapeXml(speakers)}</text>`
            : ""
        }
      </g>`;
    })
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(layout.bounds.width)}" height="${Math.ceil(layout.bounds.height)}" viewBox="0 0 ${Math.ceil(layout.bounds.width)} ${Math.ceil(layout.bounds.height)}">
  <rect width="100%" height="100%" fill="#FAF9F6" />
  <text x="28" y="34" font-size="18" font-weight="600" font-family="Georgia, serif" fill="#1C1917">${escapeXml(session.title)}</text>
  ${edgesSvg}
  ${crossSvg}
  ${nodesSvg}
</svg>`;

  downloadBlob(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    `${slug(session.title)}.svg`
  );
}

export function exportMapAsMarkdown(session: DialogueSession): void {
  const speakerMap = new Map(session.speakers.map((s) => [s.id, s]));
  const childrenMap = new Map<string, IBISNode[]>();
  const nodeById = new Map(session.nodes.map((n) => [n.id, n]));
  const roots: IBISNode[] = [];

  for (const n of session.nodes) {
    if (n.parentId && nodeById.has(n.parentId)) {
      const arr = childrenMap.get(n.parentId) || [];
      arr.push(n);
      childrenMap.set(n.parentId, arr);
    } else {
      roots.push(n);
    }
  }

  const lines: string[] = [
    `# ${session.title}`,
    "",
    `_Mapped with Dialogger using Jeffrey Conklin's IBIS Dialogue Mapping grammar._`,
    "",
  ];

  if (session.hostContext && session.hostContext.length > 0) {
    lines.push("## Session Context (Host / Framing)", "");
    for (const hc of session.hostContext) {
      lines.push(`- **${hc.category.replace(/_/g, " ")}**: ${hc.summary}`);
    }
    lines.push("");
  }

  lines.push("## Dialogue Map", "");

  const renderNode = (node: IBISNode, depth: number) => {
    const meta = IBIS_NODE_META[node.type];
    const indent = "  ".repeat(depth);
    const speakers = node.speakerIds
      .map((id) => speakerMap.get(id)?.name || id)
      .join(", ");
    const spkSuffix = speakers ? ` _(${speakers})_` : "";
    lines.push(`${indent}- **[${meta.symbol} ${meta.shortName}]** ${node.label}${spkSuffix}`);
    if (node.detail) {
      lines.push(`${indent}  > ${node.detail}`);
    }
    for (const child of childrenMap.get(node.id) || []) {
      renderNode(child, depth + 1);
    }
  };

  for (const r of roots) renderNode(r, 0);

  if (session.turns.length > 0) {
    lines.push("", "## Diarized Transcript", "");
    for (const t of session.turns) {
      const spk = speakerMap.get(t.speakerId)?.name || t.speakerId;
      const overlap = t.overlap ? " _(overlap)_" : "";
      lines.push(`- **${spk}** [${formatTime(t.startSec)}–${formatTime(t.endSec)}]${overlap}: ${t.text}`);
    }
  }

  downloadBlob(
    new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
    `${slug(session.title)}.md`
  );
}

export function exportSessionAsJson(session: DialogueSession): void {
  downloadBlob(
    new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }),
    `${slug(session.title)}.json`
  );
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}
