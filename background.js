const CHECK_ALARM = 'auto-refresh-check';
const DEFAULTS = { rules: [] };
const MIN_INTERVAL_SEC = 30;

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { rules: Array.isArray(stored.rules) ? stored.rules : [] };
}

async function getRefreshState() {
  const { refreshState = {} } = await chrome.storage.local.get('refreshState');
  return refreshState;
}

async function setRefreshState(state) {
  await chrome.storage.local.set({ refreshState: state });
}

function ruleIntervalSec(rule) {
  const n = Number(rule.interval);
  if (!Number.isFinite(n) || n < MIN_INTERVAL_SEC) return null;
  return Math.floor(n);
}

function matchRule(url, rules) {
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    if (ruleIntervalSec(rule) == null) continue;
    try {
      if (new RegExp(rule.pattern).test(url)) return rule;
    } catch {
      // invalid regex — skip
    }
  }
  return null;
}

async function ensureCheckAlarm() {
  const existing = await chrome.alarms.get(CHECK_ALARM);
  if (!existing) {
    await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 });
  }
}

chrome.runtime.onInstalled.addListener(ensureCheckAlarm);
chrome.runtime.onStartup.addListener(ensureCheckAlarm);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) evaluateTabs();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'evaluate-now') {
    evaluateTabs().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getRefreshState();
  if (state[tabId]) {
    delete state[tabId];
    await setRefreshState(state);
  }
});

async function evaluateTabs() {
  const settings = await getSettings();
  const [tabs, state] = await Promise.all([
    chrome.tabs.query({}),
    getRefreshState(),
  ]);
  const now = Date.now();
  let mutated = false;

  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    const rule = matchRule(tab.url, settings.rules);

    if (!rule) {
      if (state[tab.id]) {
        delete state[tab.id];
        mutated = true;
      }
      continue;
    }

    const prev = state[tab.id];
    // First match (or rule changed for this tab) — start the timer without refreshing.
    if (!prev || prev.ruleId !== rule.id) {
      state[tab.id] = { lastRefreshAt: now, ruleId: rule.id };
      mutated = true;
      continue;
    }

    const intervalMs = ruleIntervalSec(rule) * 1000;
    if (now - prev.lastRefreshAt >= intervalMs) {
      try {
        await chrome.tabs.reload(tab.id);
        state[tab.id] = { lastRefreshAt: now, ruleId: rule.id };
        mutated = true;
      } catch {
        // tab gone or not reloadable (e.g. chrome://)
      }
    }
  }

  const openIds = new Set(tabs.map((t) => t.id));
  for (const tabId of Object.keys(state)) {
    if (!openIds.has(Number(tabId))) {
      delete state[tabId];
      mutated = true;
    }
  }

  if (mutated) await setRefreshState(state);
}
