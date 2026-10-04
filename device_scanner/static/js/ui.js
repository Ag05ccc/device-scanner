// Small DOM helpers. Reported names and properties always enter the page as text.
export const $ = (id) => document.getElementById(id);

export function setText(node, text) {
  const value = String(text);
  if (node.textContent !== value) node.textContent = value;
}

export function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name) {
  const node = svgElement("svg", { class: "icon", "aria-hidden": "true" });
  node.append(svgElement("use", { href: `#i-${name}` }));
  return node;
}

export function ageText(timestamp) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return "No report yet";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function valueText(value) {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
