'use strict';
// Daily Log 계산 규칙 (화면과 무관한 순수 로직)
// 브라우저에서는 window.DailyLogLogic 으로, Node.js 테스트에서는 require('./logic.js') 로 사용합니다.
//
// 저장 데이터 모양:
//   habits:  [{ id, name, emoji, target: 하루 목표 횟수, unit: 단위(예: '잔'), days: 하는 요일 [0=일 … 6=토] }]
//   checks:  { 'YYYY-MM-DD': { 습관 id: 그날 한 횟수 } }
//   entries: [{ id, date, type: 'expense' | 'income', amount, category, memo }]
//   diary:   { 'YYYY-MM-DD': { mood, text } }
//   focus:   { 'YYYY-MM-DD': 그날 끝까지 마친 집중 타이머 시간(분) }
//   shopping: [{ id, store: 마트, name: 품목, category: 지출 분류, qty: 수량, price: 1개 가격(모르면 0),
//                bought, boughtOn: 산 날짜, entryId: 가계부에 적은 기록 id }]
//   goals:   [{ id, name, emoji, kind: 'cards' | 'amount', unit, total, startDate, deadline,
//              factor, factorDate, items: [...], reviewLog: { 'YYYY-MM-DD': { good, hard, again } } }]
//            items — 단어 카드: { id, front, back, learnedOn, step, due, known }
//                    분량(책·강의): 그날 공부한 범위 { id, from, to, learnedOn, step, due }
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
  const MAX_TARGET = 20; // 습관 하루 최대 횟수

  // 공부 목표
  // 복습 간격(일): 배운 다음 날, 그다음 2일 뒤, 4일, 7일, 15일, 30일 뒤. 마지막 복습까지 기억나면 '완전히 외움'.
  const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];
  const MASTERED = REVIEW_INTERVALS.length;
  // 내 수준: 기본 분량(남은 양 ÷ 남은 날)보다 얼마나 더 해서 일찍 끝낼지
  const LEVELS = {
    beginner: { name: '처음 공부해요', factor: 1 },
    middle: { name: '조금 알아요', factor: 1.2 },
    advanced: { name: '잘 알아요', factor: 1.4 },
  };
  // 자동 조절: 전날 복습 정답률이 90% 이상이면 +5%, 70% 미만이면 −5% (최소 60% ~ 최대 200%)
  const FACTOR_STEP = 0.05;
  const FACTOR_MIN = 0.6;
  const FACTOR_MAX = 2;
  const MIN_REVIEWS_TO_ADJUST = 5;
  const UNITS = ['페이지', '강', '문제', '단원', '개'];
  const MAX_GOAL_TOTAL = 100000;
  const RATINGS = ['good', 'hard', 'again'];

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

  // 습관마다 하루 목표 횟수(target)가 있습니다. 예) 물 하루 3잔 → 3번 눌러야 완료
  const targetOf = habit => habit.target || 1;

  function checkCount(checks, date, habitId) {
    const day = checks[date];
    return day && Number.isInteger(day[habitId]) ? day[habitId] : 0;
  }

  const isDone = (checks, date, habit) => checkCount(checks, date, habit.id) >= targetOf(habit);

  // 요일 지정: days 에 그날 요일이 있으면 '하는 날', 없으면 '쉬는 날' (days 가 없으면 매일)
  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 화면에는 월요일부터

  function weekday(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  const isScheduled = (habit, date) => !Array.isArray(habit.days) || habit.days.includes(weekday(date));

  // "월수금" "평일" "주말" "매일" "월, 목" 같은 입력을 요일 목록으로. 못 읽으면 null.
  function parseDays(input) {
    const text = String(input).replace(/[\s,·.\/]/g, '').replace(/요일/g, '');
    if (!text) return null;
    if (text === '매일') return [...EVERY_DAY];
    if (text === '평일') return [1, 2, 3, 4, 5];
    if (text === '주말') return [0, 6];
    const days = new Set();
    for (const ch of text) {
      const i = DAY_NAMES.indexOf(ch);
      if (i < 0) return null;
      days.add(i);
    }
    return [...days].sort((a, b) => a - b);
  }

  // [1,3,5] → "월·수·금", 매일·평일·주말은 이름으로
  function daysLabel(days) {
    const key = (Array.isArray(days) ? days : EVERY_DAY).join();
    if (key === EVERY_DAY.join()) return '매일';
    if (key === '1,2,3,4,5') return '평일';
    if (key === '0,6') return '주말';
    return DAY_ORDER.filter(d => days.includes(d)).map(d => DAY_NAMES[d]).join('·');
  }

  // 횟수를 바꾼 새 checks 를 돌려줍니다. (원본은 바꾸지 않음, 0이 되면 지움)
  function setCount(checks, date, habitId, n) {
    const day = { ...checks[date] };
    if (n > 0) day[habitId] = n;
    else delete day[habitId];
    const next = { ...checks };
    if (Object.keys(day).length) next[date] = day;
    else delete next[date];
    return next;
  }

  // 한 번 누르기: 하루 1번짜리는 켜고 끄기, 여러 번짜리는 목표까지 1씩 올리기
  function tapHabit(checks, date, habit) {
    const count = checkCount(checks, date, habit.id);
    const target = targetOf(habit);
    if (target === 1) return setCount(checks, date, habit.id, count ? 0 : 1);
    return setCount(checks, date, habit.id, Math.min(target, count + 1));
  }

  // 하루 횟수를 바꿀 때: 오늘 전에 이미 다 채운 날은 계속 완료로 남겨 연속 기록이 끊기지 않게 합니다.
  // 오늘은 실제로 한 횟수 그대로 두고 새 목표로 다시 셉니다.
  function retarget(checks, habit, newTarget, today) {
    const oldTarget = targetOf(habit);
    let next = checks;
    for (const date of Object.keys(checks)) {
      const count = checkCount(checks, date, habit.id);
      if (date < today && count >= oldTarget && count < newTarget) next = setCount(next, date, habit.id, newTarget);
    }
    return next;
  }

  const undoTap = (checks, date, habit) => setCount(checks, date, habit.id, checkCount(checks, date, habit.id) - 1);

  // 연속 기록: date 부터 하루씩 거슬러 올라가며 목표를 다 채운 날을 셉니다.
  // 오늘 아직 안 했으면 어제까지의 연속 기록을 보여 줘서 아침에 0으로 보이지 않게 합니다.
  // 쉬는 요일은 건너뛰어 끊기지 않고, 쉬는 날에 했으면 그날도 셉니다.
  function streak(checks, habit, date) {
    let day = isDone(checks, date, habit) ? date : addDays(date, -1);
    let count = 0;
    for (let i = 0; i < 3700; i++, day = addDays(day, -1)) {
      if (isDone(checks, day, habit)) count++;
      else if (isScheduled(habit, day)) break;
    }
    return count;
  }

  // date 로 끝나는 최근 n일의 기록 (오래된 날부터)
  function recentDays(checks, habit, date, n = 7) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(date, -i);
      const count = checkCount(checks, d, habit.id);
      days.push({ date: d, count, done: count >= targetOf(habit), off: !isScheduled(habit, d) });
    }
    return days;
  }

  // 그날 하는 습관을 몇 개 다 채웠는지 (쉬는 요일인 습관은 빼고 셉니다)
  function habitRate(habits, checks, date) {
    const due = habits.filter(h => isScheduled(h, date));
    const done = due.filter(h => isDone(checks, date, h)).length;
    return { done, total: due.length, pct: due.length ? Math.round((done / due.length) * 100) : 0 };
  }

  // date 가 들어 있는 주의 월요일~일요일
  function weekOf(date) {
    const [y, m, d] = date.split('-').map(Number);
    const monday = addDays(date, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }

  // ── 기록한 날 ──────────────────────────────────────────
  // 습관 체크·가계부·일기·공부 중 하나라도 남긴 날

  function activeDates(data) {
    const dates = new Set([...Object.keys(data.checks), ...Object.keys(data.diary), ...data.entries.map(e => e.date),
      ...Object.keys(data.focus || {})]);
    for (const g of data.goals || []) {
      for (const it of g.items) if (it.learnedOn) dates.add(it.learnedOn);
      for (const d of Object.keys(g.reviewLog)) dates.add(d);
    }
    return dates;
  }

  // 연속으로 기록한 날 수 (오늘 아직 안 했으면 어제까지)
  function recordStreak(data, today) {
    const dates = activeDates(data);
    let day = dates.has(today) ? today : addDays(today, -1);
    let count = 0;
    while (dates.has(day)) { count++; day = addDays(day, -1); }
    return count;
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

  // ── 공부 목표 ──────────────────────────────────────────

  // b 가 a 보다 며칠 뒤인지
  function daysBetween(a, b) {
    const utc = d => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
    return Math.round((utc(b) - utc(a)) / 86400000);
  }

  const itemSize = it => (it.from !== undefined ? it.to - it.from + 1 : 1);
  const goalTotal = goal => (goal.kind === 'cards' ? goal.items.length : goal.total);
  const sumSize = items => items.reduce((n, it) => n + itemSize(it), 0);
  const learnedItems = goal => goal.items.filter(it => it.learnedOn);

  // 오늘의 계획. 하루 동안 분량이 바뀌지 않도록 "어제까지 한 양"을 기준으로 계산합니다.
  function dailyPlan(goal, today) {
    const total = goalTotal(goal);
    const learned = learnedItems(goal);
    const remaining = total - sumSize(learned.filter(it => it.learnedOn < today));
    const daysLeft = Math.max(1, daysBetween(today, goal.deadline) + 1);
    const required = remaining / daysLeft; // 목표일에 딱 맞추려면 하루에 해야 할 양
    const quota = remaining <= 0 ? 0 : Math.min(remaining, Math.ceil(required * goal.factor));
    // 오늘 새로 한 양 ('이미 알아요'로 넘긴 단어는 오늘 분량에 넣지 않음)
    const doneToday = sumSize(learned.filter(it => it.learnedOn === today && !it.known));
    const learnedAll = sumSize(learned);
    const left = total - learnedAll; // 지금 남은 양
    const reviewsDue = learned.filter(it => it.due && it.due <= today).length;
    const mastered = learned.filter(it => it.step >= MASTERED).length;
    const newLeft = Math.min(left, Math.max(0, quota - doneToday));
    // 오늘부터 매일 quota 만큼 하면 끝나는 날
    const finishDate = quota > 0 ? addDays(today, Math.ceil(remaining / quota) - 1) : today;
    return {
      total, learnedAll, left, remaining, daysLeft, required, quota, doneToday, newLeft, reviewsDue, mastered,
      finishDate, late: left > 0 && finishDate > goal.deadline, overdue: left > 0 && today > goal.deadline,
      complete: total > 0 && left === 0,
      todayDone: newLeft === 0 && reviewsDue === 0,
    };
  }

  // 복습 결과에 따라 다음 복습 날짜를 정합니다.
  //   기억남: 다음 간격으로 · 헷갈림: 같은 간격의 절반 뒤에 다시 · 까먹음: 처음(내일)부터 다시
  function reviewItem(item, rating, today) {
    let step = item.step;
    if (rating === 'good') step++;
    else if (rating === 'again') step = 0;
    if (step >= MASTERED) return { ...item, step: MASTERED, due: null };
    const days = rating === 'hard' ? Math.max(1, Math.ceil(REVIEW_INTERVALS[step] / 2)) : REVIEW_INTERVALS[step];
    return { ...item, step, due: addDays(today, days) };
  }

  function applyReview(goal, itemId, rating, today) {
    const log = { good: 0, hard: 0, again: 0, ...goal.reviewLog[today] };
    log[rating]++;
    return {
      ...goal,
      items: goal.items.map(it => (it.id === itemId ? reviewItem(it, rating, today) : it)),
      reviewLog: { ...goal.reviewLog, [today]: log },
    };
  }

  // 새 단어를 외웠을 때 (known: 이미 아는 단어 → 복습 없이 바로 '완전히 외움')
  function learnCard(goal, itemId, today, known = false) {
    const learned = known
      ? { learnedOn: today, step: MASTERED, due: null, known: true }
      : { learnedOn: today, step: 0, due: addDays(today, REVIEW_INTERVALS[0]), known: false };
    return { ...goal, items: goal.items.map(it => (it.id === itemId ? { ...it, ...learned } : it)) };
  }

  // 책·강의: 오늘 n 만큼 공부한 범위를 기록합니다.
  function addAmount(goal, n, today) {
    const done = sumSize(goal.items);
    const to = Math.min(goal.total, done + n);
    if (!Number.isInteger(n) || n <= 0 || to <= done) return goal;
    const chunk = { id: newId(), from: done + 1, to, learnedOn: today, step: 0, due: addDays(today, REVIEW_INTERVALS[0]) };
    return { ...goal, items: [...goal.items, chunk] };
  }

  // 하루에 한 번, 전날 복습 정답률로 분량 배율을 조절합니다.
  function adjustFactor(goal, today) {
    if (goal.factorDate >= today) return goal;
    let factor = goal.factor;
    const y = goal.reviewLog[addDays(today, -1)];
    const n = y ? y.good + y.hard + y.again : 0;
    if (n >= MIN_REVIEWS_TO_ADJUST) {
      const accuracy = (y.good + y.hard / 2) / n;
      if (accuracy >= 0.9) factor += FACTOR_STEP;
      else if (accuracy < 0.7) factor -= FACTOR_STEP;
    }
    factor = Math.round(Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, factor)) * 100) / 100;
    return { ...goal, factor, factorDate: today };
  }

  // "apple - 사과" 같은 줄들을 카드로. 엑셀에서 복사한 탭 구분도 됩니다.
  const CARD_SEPARATORS = ['\t', ' - ', ' – ', ' — ', ' : ', ' = ', ',', ':', '='];
  function parseCards(text) {
    const cards = [];
    let skipped = 0;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const sep = CARD_SEPARATORS.find(s => line.includes(s));
      const at = sep ? line.indexOf(sep) : -1;
      const front = at > 0 ? line.slice(0, at).trim().slice(0, 100) : '';
      const back = at > 0 ? line.slice(at + sep.length).trim().slice(0, 200) : '';
      if (front && back) cards.push({ front, back });
      else skipped++;
    }
    return { cards, skipped };
  }

  // ── 직접 쳐서 맞히기 ──────────────────────────────────
  // 뜻을 보고 단어를 칩니다. 대소문자·띄어쓰기는 무시하고, "color/colour" 처럼 / 로 적은 건 어느 쪽이든 정답.
  // 괄호 안 설명은 빼고 비교합니다. 예) "run (ran, run)" → "run"
  const normalizeAnswer = s => String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.!?。]+$/, '').replace(/\s+/g, ' ').trim();

  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 'good' 정답 · 'hard' 한두 글자 오타 · 'again' 틀림
  function gradeTyped(typed, correct) {
    const answer = normalizeAnswer(typed);
    if (!answer) return 'again';
    const options = String(correct).split('/').map(normalizeAnswer).filter(Boolean);
    if (options.includes(answer)) return 'good';
    const close = options.some(o => {
      const allowed = o.length >= 8 ? 2 : o.length >= 4 ? 1 : 0; // 짧은 단어는 오타를 봐주지 않음
      return editDistance(answer, o) <= allowed;
    });
    return close ? 'hard' : 'again';
  }

  const newCard = ({ front, back }) => ({ id: newId(), front, back, learnedOn: null, step: 0, due: null, known: false });

  function createGoal({ name, emoji, kind, unit, total, cards, deadline, level }, today) {
    return {
      id: newId(), name: name.trim().slice(0, 40), emoji: emoji || '📚', kind,
      unit: kind === 'cards' ? '단어' : unit, total: kind === 'cards' ? 0 : total,
      startDate: today, deadline, factor: LEVELS[level].factor, factorDate: today, typing: kind === 'cards',
      items: kind === 'cards' ? cards.map(newCard) : [], reviewLog: {},
    };
  }

  // ── 집중 타이머 ────────────────────────────────────────
  const FOCUS_PRESETS = [
    { id: 'focus25', kind: 'focus', minutes: 25, name: '집중 25분' },
    { id: 'focus50', kind: 'focus', minutes: 50, name: '집중 50분' },
    { id: 'break5', kind: 'break', minutes: 5, name: '휴식 5분' },
  ];
  const MAX_FOCUS_DAY = 24 * 60;
  const MAX_CUSTOM_MINUTES = 180; // 직접 정하는 집중 시간은 3시간까지

  // "40" "40분" " 90 " → 분(정수). 1~180 이 아니면 null.
  function parseMinutes(input) {
    const cleaned = String(input).replace(/[\s분]/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return n >= 1 && n <= MAX_CUSTOM_MINUTES ? n : null;
  }

  // 남은 시간(초): 도는 중이면 끝나는 시각으로 계산해, 새로 고침·화면 꺼짐에도 맞습니다.
  const timerLeft = (timer, now) => (timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : timer.left);

  // 끝까지 마친 집중 시간을 그날에 더합니다.
  function addFocus(focus, date, minutes) {
    return { ...focus, [date]: Math.min(MAX_FOCUS_DAY, (focus[date] || 0) + minutes) };
  }

  // 12 → "12분", 85 → "1시간 25분"
  function formatMinutes(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
  }

  // ── 쇼핑 리스트 ────────────────────────────────────────
  const SHOP_CATEGORY = '쇼핑'; // 분류를 안 고른(예전) 품목은 이 분류의 지출로 적힙니다
  const NO_STORE = '어디서든';

  const shopCategory = c => (CATEGORIES.expense.includes(c) ? c : SHOP_CATEGORY);
  const MAX_QTY = 99;
  const qtyOf = it => it.qty || 1;
  const shopTotal = it => it.price * qtyOf(it); // price 는 1개 가격, 가계부에는 × 수량
  const shopMemo = it => `${it.store === NO_STORE ? '' : `${it.store} `}${it.name}${qtyOf(it) > 1 ? ` ×${qtyOf(it)}` : ''}`.slice(0, 100);
  const shopEntry = (it, id, date) => ({ id, date, type: 'expense', amount: shopTotal(it), category: shopCategory(it.category), memo: shopMemo(it) });

  // "3" "3개" → 수량(정수). 1~99 가 아니면 null.
  function parseQty(input) {
    const cleaned = String(input).replace(/[\s개]/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return n >= 1 && n <= MAX_QTY ? n : null;
  }

  function addShopItem(list, { store, name, category, price, qty }, id) {
    const item = {
      id, store: String(store || '').trim().slice(0, 20) || NO_STORE,
      name: String(name || '').trim().slice(0, 40), category: shopCategory(category),
      qty: parseQty(qty === undefined ? 1 : qty) || 1, price: parseAmount(price) || 0, bought: false, entryId: '', boughtOn: null,
    };
    return item.name ? [...list, item] : list;
  }

  // 마트별로 묶기 (처음 적은 마트부터). total: 아직 안 산 것의 예상 금액, spent: 산 것의 금액 (1개 가격 × 수량)
  function shopGroups(list) {
    const groups = new Map();
    for (const it of list) {
      if (!groups.has(it.store)) groups.set(it.store, { store: it.store, items: [], left: 0, total: 0, spent: 0 });
      const g = groups.get(it.store);
      g.items.push(it);
      if (it.bought) g.spent += shopTotal(it);
      else { g.left++; g.total += shopTotal(it); }
    }
    return [...groups.values()];
  }

  // 샀어요: 산 날짜를 기억하고, 가격이 있으면 그 날짜 가계부에 지출을 적습니다.
  // 가격을 몰라도 체크할 수 있고, 가격은 나중에 editShopItem 으로 넣으면 산 날짜로 적혀요.
  function buyShopItem(data, itemId, date, entryId) {
    const it = data.shopping.find(x => x.id === itemId);
    if (!it || it.bought) return data;
    const entry = shopTotal(it) > 0 ? shopEntry(it, entryId, date) : null;
    return {
      ...data,
      shopping: data.shopping.map(x => (x.id === itemId ? { ...x, bought: true, boughtOn: date, entryId: entry ? entryId : '' } : x)),
      entries: entry ? [...data.entries, entry] : data.entries,
    };
  }

  // 체크 취소: 그때 적은 가계부 기록도 지웁니다.
  function unbuyShopItem(data, itemId) {
    const it = data.shopping.find(x => x.id === itemId);
    if (!it || !it.bought) return data;
    return {
      ...data,
      shopping: data.shopping.map(x => (x.id === itemId ? { ...x, bought: false, boughtOn: null, entryId: '' } : x)),
      entries: it.entryId ? data.entries.filter(e => e.id !== it.entryId) : data.entries,
    };
  }

  // 가격·수량 고치기 (changes: { price } 또는 { qty }). 이미 산 품목이면 가계부 기록도 함께 맞춥니다.
  // 기록이 있으면 금액을 바꾸고(합계가 0이 되면 지움), 없던 기록은 산 날짜(boughtOn, 없으면 date)에 새로 적습니다.
  function editShopItem(data, itemId, changes, date, entryId) {
    const it = data.shopping.find(x => x.id === itemId);
    if (!it) return data;
    const next = {
      ...it,
      price: 'price' in changes ? parseAmount(changes.price) || 0 : it.price,
      qty: 'qty' in changes ? parseQty(changes.qty) || qtyOf(it) : qtyOf(it),
    };
    let entries = data.entries;
    if (it.bought) {
      const old = it.entryId ? entries.find(e => e.id === it.entryId) : null;
      if (old && shopTotal(next)) {
        // 원래 기록은 그 날짜·순서 그대로 두고 금액과 메모만 바꿉니다.
        entries = entries.map(e => (e.id === old.id ? { ...e, amount: shopTotal(next), memo: shopMemo(next) } : e));
      } else if (old) {
        entries = entries.filter(e => e.id !== old.id);
        next.entryId = '';
      } else if (shopTotal(next)) {
        entries = [...entries, shopEntry(next, entryId, it.boughtOn || date)];
        next.entryId = entryId;
      } else next.entryId = '';
    }
    return { ...data, shopping: data.shopping.map(x => (x.id === itemId ? next : x)), entries };
  }

  // ── 데이터 전체 (저장·백업 가져오기) ───────────────────

  function emptyData() {
    return { version: DATA_VERSION, habits: [], checks: {}, entries: [], diary: {}, goals: [], shopping: [], focus: {} };
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
      data.habits.push({
        id: h.id, name, emoji: cleanText(h.emoji, 8) || '✅',
        target: isCount(h.target, MAX_TARGET) && h.target >= 1 ? h.target : 1,
        unit: cleanText(h.unit, 6).trim(),
        days: normalizeDays(h.days),
      });
    }

    // 예전 기록은 [습관 id, ...] 모양이라 각각 1번 한 것으로 바꿉니다.
    if (isPlainObject(raw.checks)) {
      for (const [date, value] of Object.entries(raw.checks)) {
        if (!isValidDate(date)) continue;
        const pairs = Array.isArray(value) ? value.map(id => [id, 1]) : isPlainObject(value) ? Object.entries(value) : [];
        const day = {};
        for (const [id, n] of pairs) {
          if (habitIds.has(id) && isCount(n, MAX_TARGET) && n > 0) day[id] = n;
        }
        if (Object.keys(day).length) data.checks[date] = day;
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

    // goals 가 없는 예전 백업도 그대로 읽힙니다.
    const goalIds = new Set();
    for (const g of Array.isArray(raw.goals) ? raw.goals : []) {
      const goal = normalizeGoal(g);
      if (goal && !goalIds.has(goal.id)) { goalIds.add(goal.id); data.goals.push(goal); }
    }

    if (isPlainObject(raw.focus)) {
      for (const [date, min] of Object.entries(raw.focus)) {
        if (isValidDate(date) && isCount(min, MAX_FOCUS_DAY) && min > 0) data.focus[date] = min;
      }
    }

    // shopping 이 없는 예전 백업도 그대로 읽힙니다. 지워진 가계부 기록을 가리키는 entryId 는 비웁니다.
    const entryIds = new Set(data.entries.map(e => e.id));
    const shopIds = new Set();
    for (const it of Array.isArray(raw.shopping) ? raw.shopping : []) {
      if (!isPlainObject(it) || typeof it.id !== 'string' || shopIds.has(it.id)) continue;
      const name = cleanText(it.name, 40).trim();
      if (!name) continue;
      shopIds.add(it.id);
      const bought = it.bought === true;
      data.shopping.push({
        id: it.id, store: cleanText(it.store, 20).trim() || NO_STORE, name, category: shopCategory(it.category),
        qty: isCount(it.qty, MAX_QTY) && it.qty >= 1 ? it.qty : 1,
        price: Number.isInteger(it.price) && it.price > 0 && it.price <= MAX_AMOUNT ? it.price : 0,
        bought, entryId: bought && entryIds.has(it.entryId) ? it.entryId : '',
        boughtOn: bought && isValidDate(it.boughtOn) ? it.boughtOn : null,
      });
    }
    return data;
  }

  const isCount = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

  // 요일 목록 검사: 없거나 잘못됐거나 비어 있으면 매일
  function normalizeDays(days) {
    const valid = Array.isArray(days) ? [...new Set(days.filter(d => isCount(d, 6)))].sort((a, b) => a - b) : [];
    return valid.length ? valid : [...EVERY_DAY];
  }
  const optionalDate = v => (isValidDate(v) ? v : null);

  function normalizeGoal(g) {
    if (!isPlainObject(g) || typeof g.id !== 'string') return null;
    if (g.kind !== 'cards' && g.kind !== 'amount') return null;
    const name = cleanText(g.name, 40).trim();
    if (!name || !isValidDate(g.startDate) || !isValidDate(g.deadline)) return null;
    const cards = g.kind === 'cards';
    const total = cards ? 0 : g.total;
    if (!cards && !(isCount(total, MAX_GOAL_TOTAL) && total > 0)) return null;
    const factor = typeof g.factor === 'number' && Number.isFinite(g.factor)
      ? Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, g.factor)) : 1;

    const items = [];
    const itemIds = new Set();
    let covered = 0; // 분량형: 앞에서부터 빈틈없이 이어진 범위만 받습니다
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!isPlainObject(it) || typeof it.id !== 'string' || itemIds.has(it.id)) continue;
      const step = isCount(it.step, MASTERED) ? it.step : 0;
      const learnedOn = optionalDate(it.learnedOn);
      let item;
      if (cards) {
        const front = cleanText(it.front, 100).trim();
        const back = cleanText(it.back, 200).trim();
        if (!front || !back) continue;
        item = learnedOn
          ? { id: it.id, front, back, learnedOn, step, due: step >= MASTERED ? null : optionalDate(it.due) || learnedOn, known: it.known === true }
          : { id: it.id, front, back, learnedOn: null, step: 0, due: null, known: false };
      } else {
        if (!learnedOn || it.from !== covered + 1 || !isCount(it.to, total) || it.to < it.from) continue;
        covered = it.to;
        item = { id: it.id, from: it.from, to: it.to, learnedOn, step, due: step >= MASTERED ? null : optionalDate(it.due) || learnedOn };
      }
      itemIds.add(it.id);
      items.push(item);
    }

    const reviewLog = {};
    if (isPlainObject(g.reviewLog)) {
      for (const [date, log] of Object.entries(g.reviewLog)) {
        if (!isValidDate(date) || !isPlainObject(log)) continue;
        const counts = {};
        for (const r of RATINGS) counts[r] = isCount(log[r], 1e6) ? log[r] : 0;
        reviewLog[date] = counts;
      }
    }

    return {
      id: g.id, name, emoji: cleanText(g.emoji, 8) || '📚', kind: g.kind,
      unit: cards ? '단어' : cleanText(g.unit, 10).trim() || '개', total,
      startDate: g.startDate, deadline: g.deadline, factor,
      factorDate: isValidDate(g.factorDate) ? g.factorDate : g.startDate,
      typing: cards && g.typing === true, items, reviewLog,
    };
  }

  return {
    DATA_VERSION, MAX_TEXT, CATEGORIES, MOODS,
    dateKey, addDays, isValidDate, monthOf, addMonths,
    MAX_TARGET, checkCount, isDone, tapHabit, undoTap, retarget, streak, recentDays, habitRate, weekOf,
    EVERY_DAY, DAY_NAMES, DAY_ORDER, weekday, isScheduled, parseDays, daysLabel,
    FOCUS_PRESETS, MAX_CUSTOM_MINUTES, parseMinutes, timerLeft, addFocus, formatMinutes,
    activeDates, recordStreak,
    parseAmount, formatWon, summarizeMonth, entriesOfMonth,
    SHOP_CATEGORY, NO_STORE, MAX_QTY, parseQty, shopTotal, addShopItem, shopGroups, buyShopItem, unbuyShopItem, editShopItem,
    REVIEW_INTERVALS, MASTERED, LEVELS, UNITS,
    daysBetween, dailyPlan, reviewItem, applyReview, learnCard, addAmount, adjustFactor, parseCards, gradeTyped, newCard, createGoal,
    emptyData, newId, normalizeData,
  };
});
