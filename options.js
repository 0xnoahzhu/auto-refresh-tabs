const DEFAULTS = { rules: [] };
const MIN_INTERVAL_SEC = 30;

let state = { ...DEFAULTS };
let saveTimer = null;

const els = {
  rulesList: document.getElementById('rules-list'),
  emptyState: document.getElementById('empty-state'),
  addRule: document.getElementById('add-rule'),
  saveStatus: document.getElementById('save-status'),
  template: document.getElementById('rule-template'),
};

function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitDuration(sec) {
  let s = Math.floor(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return { d, h, m, s };
}

function partsToSec(d, h, m, s) {
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  return toNum(d) * 86400 + toNum(h) * 3600 + toNum(m) * 60 + toNum(s);
}

function validateTotalSec(totalSec) {
  if (!totalSec) return { error: 'Interval required.' };
  if (totalSec < MIN_INTERVAL_SEC) return { error: `Minimum ${MIN_INTERVAL_SEC}s.` };
  return { value: totalSec };
}

function validatePattern(raw) {
  if (!raw) return { error: 'Pattern required.' };
  try {
    new RegExp(raw);
    return { value: raw };
  } catch (e) {
    return { error: `Invalid regex: ${e.message}` };
  }
}

async function loadState() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  state = { rules: Array.isArray(stored.rules) ? stored.rules : [] };
  render();
}

function render() {
  els.rulesList.innerHTML = '';
  for (const rule of state.rules) {
    els.rulesList.appendChild(renderRule(rule));
  }
  els.emptyState.hidden = state.rules.length > 0;
}

function renderRule(rule) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = rule.id;

  const enabled = node.querySelector('.rule-enabled');
  const pattern = node.querySelector('.rule-pattern');
  const dInput = node.querySelector('.rule-d');
  const hInput = node.querySelector('.rule-h');
  const mInput = node.querySelector('.rule-m');
  const sInput = node.querySelector('.rule-s');
  const intervalInputs = [dInput, hInput, mInput, sInput];
  const patternError = node.querySelector('.rule-error-pattern');
  const intervalError = node.querySelector('.rule-error-interval');
  const del = node.querySelector('.rule-delete');

  enabled.checked = !!rule.enabled;
  pattern.value = rule.pattern ?? '';

  const parts = splitDuration(rule.interval);
  dInput.value = parts.d ? parts.d : '';
  hInput.value = parts.h ? parts.h : '';
  mInput.value = parts.m ? parts.m : '';
  sInput.value = parts.s ? parts.s : '';

  enabled.addEventListener('change', () => {
    updateRule(rule.id, { enabled: enabled.checked });
  });

  pattern.addEventListener('input', () => {
    const v = validatePattern(pattern.value);
    if (v.error && pattern.value) {
      setError(patternError, v.error);
      pattern.classList.add('invalid');
    } else {
      clearError(patternError);
      pattern.classList.remove('invalid');
    }
    updateRule(rule.id, { pattern: pattern.value });
  });

  const onIntervalInput = () => {
    const total = partsToSec(dInput.value, hInput.value, mInput.value, sInput.value);
    const v = validateTotalSec(total);
    updateRule(rule.id, { interval: v.value ?? null });
    if (v.error) {
      setError(intervalError, v.error);
      intervalInputs.forEach((i) => i.classList.add('invalid'));
    } else {
      clearError(intervalError);
      intervalInputs.forEach((i) => i.classList.remove('invalid'));
    }
  };

  intervalInputs.forEach((inp) => inp.addEventListener('input', onIntervalInput));

  del.addEventListener('click', () => deleteRule(rule.id));

  return node;
}

function setError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function clearError(el) {
  el.hidden = true;
  el.textContent = '';
}

function updateRule(id, changes) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  Object.assign(rule, changes);
  scheduleSave();
}

function deleteRule(id) {
  state.rules = state.rules.filter((r) => r.id !== id);
  const node = els.rulesList.querySelector(`[data-id="${id}"]`);
  if (node) node.remove();
  els.emptyState.hidden = state.rules.length > 0;
  scheduleSave();
}

function addRule() {
  const rule = {
    id: uid(),
    pattern: '',
    interval: null,
    enabled: true,
  };
  state.rules.push(rule);
  els.rulesList.appendChild(renderRule(rule));
  els.emptyState.hidden = true;
  const last = els.rulesList.lastElementChild;
  if (last) last.querySelector('.rule-pattern').focus();
  scheduleSave();
}

els.addRule.addEventListener('click', addRule);

function scheduleSave() {
  setStatus('saving', 'Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

async function save() {
  const safeRules = state.rules.map((r) => ({
    id: r.id,
    pattern: r.pattern ?? '',
    enabled: !!r.enabled,
    interval:
      r.interval == null
        ? null
        : Math.max(MIN_INTERVAL_SEC, Math.floor(Number(r.interval)) || MIN_INTERVAL_SEC),
  }));

  await chrome.storage.sync.set({ rules: safeRules });
  chrome.storage.sync.remove('defaultInterval').catch(() => {});

  setStatus('saved', 'Saved');
  setTimeout(() => setStatus('', 'Settings save automatically.'), 1200);
  chrome.runtime.sendMessage({ type: 'evaluate-now' }).catch(() => {});
}

function setStatus(cls, text) {
  els.saveStatus.className = `save-status ${cls}`.trim();
  els.saveStatus.textContent = text;
}

loadState();
