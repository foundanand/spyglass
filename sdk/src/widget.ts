import { report } from "./capture.js";
import { flush } from "./queue.js";
import { isInitialized } from "./core.js";

const WIDGET_ID = "__spyglass_widget__";

const STYLES = `
  :host { all: initial; }
  .fab {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #e53e3e;
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 20px;
    line-height: 44px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
    transition: transform .15s, box-shadow .15s;
    padding: 0;
  }
  .fab:hover { transform: scale(1.1); box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.45);
    z-index: 2147483646;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 20px;
  }
  .modal {
    background: #1a1a2e;
    color: #e2e8f0;
    border-radius: 10px;
    padding: 20px;
    width: 320px;
    box-shadow: 0 8px 32px rgba(0,0,0,.6);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
  }
  .modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 600; color: #f7fafc; }
  textarea {
    width: 100%;
    min-height: 90px;
    background: #2d3748;
    color: #e2e8f0;
    border: 1px solid #4a5568;
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    resize: vertical;
    box-sizing: border-box;
    font-family: inherit;
  }
  textarea:focus { outline: none; border-color: #63b3ed; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  select {
    flex: 1;
    background: #2d3748;
    color: #e2e8f0;
    border: 1px solid #4a5568;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
  }
  select:focus { outline: none; border-color: #63b3ed; }
  .btn-cancel {
    background: transparent;
    color: #a0aec0;
    border: 1px solid #4a5568;
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
  }
  .btn-cancel:hover { background: #2d3748; }
  .btn-submit {
    background: #e53e3e;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
  }
  .btn-submit:hover { background: #c53030; }
  .btn-submit:disabled { opacity: .5; cursor: default; }
  .sent { color: #68d391; text-align: center; padding: 10px 0 4px; font-size: 13px; }
`;

export function initWidget(): void {
  if (!isInitialized()) return;
  if (typeof document === "undefined") return;
  if (document.getElementById(WIDGET_ID)) return;

  const host = document.createElement("div");
  host.id = WIDGET_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);

  // Floating action button
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.title = "Report a bug";
  fab.setAttribute("aria-label", "Report a bug");
  fab.textContent = "🐛";
  shadow.appendChild(fab);

  // Modal elements (created lazily on first open)
  let overlay: HTMLElement | null = null;
  let textarea: HTMLTextAreaElement | null = null;
  let severitySelect: HTMLSelectElement | null = null;
  let submitBtn: HTMLButtonElement | null = null;
  let sentMsg: HTMLElement | null = null;

  function buildModal() {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal";

    const h3 = document.createElement("h3");
    h3.textContent = "Report a bug";
    modal.appendChild(h3);

    textarea = document.createElement("textarea");
    textarea.placeholder = "Describe what happened…";
    modal.appendChild(textarea);

    const row = document.createElement("div");
    row.className = "row";

    severitySelect = document.createElement("select");
    const severities = [
      { value: "", label: "Severity (optional)" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
    ];
    for (const s of severities) {
      const opt = document.createElement("option");
      opt.value = s.value;
      opt.textContent = s.label;
      severitySelect.appendChild(opt);
    }
    row.appendChild(severitySelect);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeModal);
    row.appendChild(cancelBtn);

    submitBtn = document.createElement("button");
    submitBtn.className = "btn-submit";
    submitBtn.textContent = "Send";
    submitBtn.addEventListener("click", handleSubmit);
    row.appendChild(submitBtn);

    modal.appendChild(row);

    sentMsg = document.createElement("div");
    sentMsg.className = "sent";
    sentMsg.textContent = "✓ Report sent — thanks!";
    sentMsg.style.display = "none";
    modal.appendChild(sentMsg);

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    return overlay;
  }

  function openModal() {
    if (!overlay) {
      shadow.appendChild(buildModal());
    }
    if (overlay) overlay.style.display = "flex";
    if (textarea) {
      textarea.value = "";
      textarea.focus();
    }
    if (sentMsg) sentMsg.style.display = "none";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send";
    }
    if (severitySelect) severitySelect.value = "";
  }

  function closeModal() {
    if (overlay) overlay.style.display = "none";
  }

  function handleSubmit() {
    const comment = textarea?.value.trim() ?? "";
    if (!comment) {
      textarea?.focus();
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }

    const extra: Record<string, unknown> = {};
    const sev = severitySelect?.value;
    if (sev) extra["severity"] = sev;

    report(comment, extra);
    flush();

    if (sentMsg) sentMsg.style.display = "block";
    if (submitBtn) submitBtn.style.display = "none";
    setTimeout(closeModal, 1500);
  }

  fab.addEventListener("click", openModal);
}
