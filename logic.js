'use strict';
// Daily Log 계산 규칙 (화면과 무관한 순수 로직)
// 브라우저에서는 window.DailyLogLogic 으로, Node.js 테스트에서는 require('./logic.js') 로 사용합니다.
//
// 저장 데이터 모양:
//   habits:  [{ id, name, emoji }]
//   checks:  { 'YYYY-MM-DD': [습관 id, ...] }
//   entries: [{ id, date, type: 'expense' | 'income', amount, category, memo }]
//   diary:   { 'YYYY-MM-DD': { mood, text } }
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailyLogLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DATA_VERSION = 1;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_AMOUNT = 1e12; // 1조 원 넘는 금액은 오타로 봅니다
  const MAX_TEXT = 20000;  // 일기 한 편 최대 글자 수

  const CATEGORIES = {
    expense: ['식비', '카페·간식', '교통', '쇼핑', '생활', '문화·여가', '의료', '교육', '기타'],
    income: ['월급', '용돈', '부수입', '기타'],
  };
  const MOODS = ['😄', '🙂', '😐', '😔', '😢'];

  // ── 날짜 ───────────────────────────────────────────────
  // 생활 기록이라 기기의 현재 시간대 기준 "오늘"을 씁니다.

  function dateKey(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 'YYYY-MM-DD' 문자열에 n일을 더합니다. (시간대 영향이 없도록 UTC 로만 계산)
  function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  // 형식뿐 아니라 실제로 있는 날짜인지 확인 ('2026-02-30' 같은 값 거부)
  function isValidDate(date) {
    return typeof date === 'string' && DATE_PATTERN.test(date) && addDays(date, 0) === date;
  }

  const monthOf = date => date.slice(0, 7);

  // 'YYYY-MM' 에 n달을 더합니다.
  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  }

  // ── 습관 ───────────────────────────────────────────────

  function isChecked(checks, date, habitId) {
    return Array.isArray(checks[date]) && checks[date].includes(habitId);
  }

  // 체크를 켜고 끈 새 checks 를 돌려줍니다. (원본은 바꾸지 않음)
  function toggleCheck(checks, date, habitId) {
    const list = Array.isArray(checks[date]) ? checks[date] : [];
    const nextList = list.includes(habitId) ? list.filter(id => id !== habitId) : [...list, habitId];
    const next = { ...checks };
    if (nextList.length) next[date] = nextList;
    else delete next[date];
    return next;
  }

  // 연속 기록: date 부터 하루씩 거슬러 올라가며 체크된 날을 셉니다.
  // 오늘 아직 안 했으면 어제까지의 연속 기록을 보여 줘서 아침에 0으로 보이지 않게 합니다.
  function streak(checks, habitId, date) {
    let day = isChecked(checks, date, habitId) ? date : addDays(date, -1);
    let count = 0;
    while (isChecked(checks, day, habitId)) { count++; day = addDays(day, -1); }
    return count;
  }

  // date 로 끝나는 최근 n일의 체크 여부 (오래된 날부터)
  function recentDays(checks, habitId, date, n = 7) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(date, -i);
      days.push({ date: d, done: isChecked(checks, d, habitId) });
    }
    return days;
  }

  // ── 가계부 ─────────────────────────────────────────────

  // "12,000" "12000원" 같은 입력을 정수 금액으로. 잘못된 값이면 null.
  function parseAmount(input) {
    const cleaned = String(input).replace(/[,\s원]/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return n > 0 && n <= MAX_AMOUNT ? n : null;
  }

  const formatWon = n => `${Math.round(n).toLocaleString('ko-KR')}원`;

  // 한 달 치 합계와 지출 분류별 합계(큰 순서)
  function summarizeMonth(entries, month) {
    let income = 0;
    let expense = 0;
    const byCategory = {};
    for (const e of entries) {
      if (monthOf(e.date) !== month) continue;
      if (e.type === 'income') income += e.amount;
      else {
        expense += e.amount;
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      }
    }
    const categories = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    return { income, expense, balance: income - expense, categories };
  }

  // 한 달 치 내역을 최근 날짜부터, 같은 날은 입력한 순서대로
  function entriesOfMonth(entries, month) {
    return entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => monthOf(e.date) === month)
      .sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? 1 : -1))
      .map(({ e }) => e);
  }

  // ── 데이터 전체 (저장·백업 가져오기) ───────────────────

  function emptyData() {
    return { version: DATA_VERSION, habits: [], checks: {}, entries: [], diary: {} };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const cleanText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  // 저장소나 백업 파일에서 읽은 값을 검사해 안전한 데이터로 만듭니다.
  // 모양이 아예 다르면 오류를 던지고, 일부 잘못된 항목은 조용히 버립니다.
  function normalizeData(raw) {
    if (!isPlainObject(raw) || raw.version !== DATA_VERSION) {
      throw new Error('Daily Log 백업 파일이 아니에요.');
    }
    const data = emptyData();
    const habitIds = new Set();

    for (const h of Array.isArray(raw.habits) ? raw.habits : []) {
      if (!isPlainObject(h) || typeof h.id !== 'string' || habitIds.has(h.id)) continue;
      const name = cleanText(h.name, 40).trim();
      if (!name) continue;
      habitIds.add(h.id);
      data.habits.push({ id: h.id, name, emoji: cleanText(h.emoji, 8) || '✅' });
    }

    if (isPlainObject(raw.checks)) {
      for (const [date, ids] of Object.entries(raw.checks)) {
        if (!isValidDate(date) || !Array.isArray(ids)) continue;
        const valid = [...new Set(ids.filter(id => habitIds.has(id)))];
        if (valid.length) data.checks[date] = valid;
      }
    }

    for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
      if (!isPlainObject(e) || typeof e.id !== 'string' || !isValidDate(e.date)) continue;
      if (e.type !== 'expense' && e.type !== 'income') continue;
      if (!Number.isInteger(e.amount) || e.amount <= 0 || e.amount > MAX_AMOUNT) continue;
      const category = CATEGORIES[e.type].includes(e.category) ? e.category : '기타';
      data.entries.push({ id: e.id, date: e.date, type: e.type, amount: e.amount, category, memo: cleanText(e.memo, 100) });
    }

    if (isPlainObject(raw.diary)) {
      for (const [date, d] of Object.entries(raw.diary)) {
        if (!isValidDate(date) || !isPlainObject(d)) continue;
        const text = cleanText(d.text, MAX_TEXT);
        const mood = MOODS.includes(d.mood) ? d.mood : '';
        if (text.trim() || mood) data.diary[date] = { mood, text };
      }
    }
    return data;
  }

  return {
    DATA_VERSION, MAX_TEXT, CATEGORIES, MOODS,
    dateKey, addDays, isValidDate, monthOf, addMonths,
    isChecked, toggleCheck, streak, recentDays,
    parseAmount, formatWon, summarizeMonth, entriesOfMonth,
    emptyData, newId, normalizeData,
  };
});
