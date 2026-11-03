// 계산 규칙(logic.js) 점검
// 실행: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

test('날짜 계산: 달·해 넘김과 없는 날짜', () => {
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(L.addMonths('2026-01', -1), '2025-12');
  assert.equal(L.addMonths('2026-12', 1), '2027-01');
  assert.ok(L.isValidDate('2026-11-03'));
  assert.ok(!L.isValidDate('2026-02-30'));
  assert.ok(!L.isValidDate('2026-1-3'));
  assert.equal(L.dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

const A = { id: 'a', target: 1 };
const WATER = { id: 'w', target: 3, unit: '잔' };

test('하루 1번짜리 습관: 누르면 켜고 끄고, 원본은 바꾸지 않고, 빈 날짜는 지운다', () => {
  const before = {};
  const on = L.tapHabit(before, '2026-11-03', A);
  assert.deepEqual(before, {});
  assert.deepEqual(on, { '2026-11-03': { a: 1 } });
  assert.ok(L.isDone(on, '2026-11-03', A));
  assert.deepEqual(L.tapHabit(on, '2026-11-03', A), {});
});

test('여러 번짜리 습관: 목표까지 1씩 오르고, 취소는 1씩 내린다', () => {
  let c = {};
  c = L.tapHabit(c, '2026-11-03', WATER);
  c = L.tapHabit(c, '2026-11-03', WATER);
  assert.equal(L.checkCount(c, '2026-11-03', 'w'), 2);
  assert.ok(!L.isDone(c, '2026-11-03', WATER));
  c = L.tapHabit(c, '2026-11-03', WATER);
  assert.ok(L.isDone(c, '2026-11-03', WATER));
  c = L.tapHabit(c, '2026-11-03', WATER); // 목표를 넘지 않음
  assert.equal(L.checkCount(c, '2026-11-03', 'w'), 3);
  c = L.undoTap(c, '2026-11-03', WATER);
  assert.equal(L.checkCount(c, '2026-11-03', 'w'), 2);
  c = L.undoTap(L.undoTap(c, '2026-11-03', WATER), '2026-11-03', WATER);
  assert.deepEqual(c, {});
});

test('연속 기록: 오늘 안 했으면 어제까지 세고, 목표를 다 채운 날만 센다', () => {
  const checks = { '2026-11-01': { a: 1 }, '2026-11-02': { a: 1 }, '2026-10-30': { a: 1 } };
  assert.equal(L.streak(checks, A, '2026-11-03'), 2);
  assert.equal(L.streak({ ...checks, '2026-11-03': { a: 1 } }, A, '2026-11-03'), 3);
  assert.equal(L.streak(checks, A, '2026-11-05'), 0);
  assert.equal(L.streak(checks, { id: 'b' }, '2026-11-03'), 0);
  const water = { '2026-11-01': { w: 3 }, '2026-11-02': { w: 3 }, '2026-11-03': { w: 2 } };
  assert.equal(L.streak(water, WATER, '2026-11-03'), 2); // 오늘은 2/3 이라 아직 안 셈
  assert.equal(L.streak({ ...water, '2026-11-02': { w: 1 } }, WATER, '2026-11-03'), 0);
});

test('최근 7일은 오래된 날부터 오늘까지, 한 횟수도 함께', () => {
  const days = L.recentDays({ '2026-11-03': { w: 3 }, '2026-10-28': { w: 1 } }, WATER, '2026-11-03');
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { date: '2026-10-28', count: 1, done: false });
  assert.deepEqual(days[6], { date: '2026-11-03', count: 3, done: true });
});

test('예전 체크 기록([id, ...])은 1번 한 것으로 바뀐다', () => {
  const data = L.normalizeData({
    version: 1,
    habits: [{ id: 'a', name: '운동' }, { id: 'w', name: '물', target: 3, unit: '잔' }, { id: 'x', name: '이상한 횟수', target: 999 }],
    checks: { '2026-11-02': ['a'], '2026-11-03': { a: 1, w: 2, ghost: 1, x: -1 } },
  });
  assert.deepEqual(data.habits.map(h => [h.target, h.unit]), [[1, ''], [3, '잔'], [1, '']]);
  assert.deepEqual(data.checks, { '2026-11-02': { a: 1 }, '2026-11-03': { a: 1, w: 2 } });
});

test('금액 읽기', () => {
  assert.equal(L.parseAmount('12,000'), 12000);
  assert.equal(L.parseAmount(' 3500원 '), 3500);
  for (const bad of ['', '0', '-500', '12.5', 'abc', '1e5', '9999999999999']) {
    assert.equal(L.parseAmount(bad), null, bad);
  }
  assert.equal(L.formatWon(1234567), '1,234,567원');
});

test('월 합계와 분류별 지출', () => {
  const entries = [
    { date: '2026-11-01', type: 'income', amount: 300000, category: '용돈' },
    { date: '2026-11-01', type: 'expense', amount: 8000, category: '식비' },
    { date: '2026-11-02', type: 'expense', amount: 4500, category: '카페·간식' },
    { date: '2026-11-03', type: 'expense', amount: 12000, category: '식비' },
    { date: '2026-10-31', type: 'expense', amount: 99999, category: '쇼핑' },
  ];
  const s = L.summarizeMonth(entries, '2026-11');
  assert.equal(s.income, 300000);
  assert.equal(s.expense, 24500);
  assert.equal(s.balance, 275500);
  assert.deepEqual(s.categories, [{ category: '식비', amount: 20000 }, { category: '카페·간식', amount: 4500 }]);
  assert.deepEqual(L.entriesOfMonth(entries, '2026-11').map(e => e.date), ['2026-11-03', '2026-11-02', '2026-11-01', '2026-11-01']);
  assert.equal(L.entriesOfMonth(entries, '2026-11')[2].type, 'income'); // 같은 날은 입력 순서
});

test('백업 가져오기: 다른 파일은 거부하고 잘못된 항목은 버린다', () => {
  assert.throws(() => L.normalizeData(null));
  assert.throws(() => L.normalizeData([]));
  assert.throws(() => L.normalizeData({ version: 99 }));

  const data = L.normalizeData({
    version: 1,
    habits: [{ id: 'a', name: ' 물 마시기 ', emoji: '💧' }, { id: 'a', name: '중복' }, { id: 'b', name: '' }, 'x'],
    checks: { '2026-11-03': ['a', 'a', 'ghost'], '2026-02-30': ['a'], '2026-11-02': ['ghost'] },
    entries: [
      { id: 'e1', date: '2026-11-03', type: 'expense', amount: 5000, category: '없는분류', memo: '김밥' },
      { id: 'e2', date: '2026-11-03', type: 'expense', amount: -1, category: '식비' },
      { id: 'e3', date: '2026-11-03', type: 'gift', amount: 10, category: '식비' },
    ],
    diary: { '2026-11-03': { mood: '🙂', text: '좋은 하루' }, '2026-11-02': { mood: 'x', text: '  ' } },
  });
  assert.deepEqual(data.habits, [{ id: 'a', name: '물 마시기', emoji: '💧', target: 1, unit: '' }]);
  assert.deepEqual(data.checks, { '2026-11-03': { a: 1 } });
  assert.deepEqual(data.entries, [{ id: 'e1', date: '2026-11-03', type: 'expense', amount: 5000, category: '기타', memo: '김밥' }]);
  assert.deepEqual(data.diary, { '2026-11-03': { mood: '🙂', text: '좋은 하루' } });
});

test('저장한 데이터는 그대로 다시 읽힌다', () => {
  const data = L.emptyData();
  data.habits.push({ id: 'h1', name: '운동', emoji: '🏃', target: 1, unit: '' }, { id: 'h2', name: '물', emoji: '💧', target: 3, unit: '잔' });
  data.checks['2026-11-03'] = { h1: 1, h2: 2 };
  data.entries.push({ id: 'e1', date: '2026-11-03', type: 'income', amount: 1000, category: '용돈', memo: '' });
  data.diary['2026-11-03'] = { mood: '', text: '<script>alert(1)</script>' };
  assert.deepEqual(L.normalizeData(JSON.parse(JSON.stringify(data))), data);
});

// ── 공부 목표 ──────────────────────────────────────────

const TODAY = '2026-11-03';
function cardGoal(n, extra = {}) {
  const cards = Array.from({ length: n }, (_, i) => ({ front: `w${i}`, back: `뜻${i}` }));
  return { ...L.createGoal({ name: '단어', kind: 'cards', cards, deadline: L.addDays(TODAY, 9), level: 'beginner' }, TODAY), ...extra };
}

test('하루 분량: 남은 양 ÷ 남은 날 × 수준 배율 (올림)', () => {
  const g = cardGoal(100); // 오늘 포함 10일
  assert.equal(L.dailyPlan(g, TODAY).quota, 10);
  assert.equal(L.dailyPlan({ ...g, factor: 1.2 }, TODAY).quota, 12);
  assert.equal(L.dailyPlan(cardGoal(95), TODAY).quota, 10);
  assert.ok(!L.dailyPlan(g, TODAY).late);
});

test('오늘 외운 만큼 남은 분량이 줄고, 오늘 분량 자체는 하루 동안 그대로다', () => {
  let g = cardGoal(100);
  for (const it of g.items.slice(0, 4)) g = L.learnCard(g, it.id, TODAY);
  g = L.learnCard(g, g.items[4].id, TODAY, true); // 이미 아는 단어는 오늘 분량에 넣지 않음
  const p = L.dailyPlan(g, TODAY);
  assert.equal(p.quota, 10);
  assert.equal(p.doneToday, 4);
  assert.equal(p.newLeft, 6);
  assert.equal(p.learnedAll, 5);
  assert.equal(p.mastered, 1);
  // 다음 날에는 남은 95개를 남은 9일로 다시 나눔
  assert.equal(L.dailyPlan(g, L.addDays(TODAY, 1)).quota, 11);
});

test('못 하고 지나가면 남은 날에 나눠 분량이 늘고, 목표일이 지나면 경고', () => {
  const g = cardGoal(100);
  assert.equal(L.dailyPlan(g, L.addDays(TODAY, 5)).quota, 20);
  const late = L.dailyPlan(g, L.addDays(TODAY, 12));
  assert.ok(late.overdue);
  assert.equal(late.quota, 100);
});

test('배율이 1보다 작으면 목표일보다 늦게 끝난다고 알려 준다', () => {
  const p = L.dailyPlan(cardGoal(100, { factor: 0.6 }), TODAY);
  assert.equal(p.quota, 6);
  assert.ok(p.late);
  assert.equal(p.finishDate, L.addDays(TODAY, 16));
});

test('복습 간격: 기억남은 늘고, 헷갈림은 절반, 까먹음은 처음부터', () => {
  let it = { id: 'a', step: 0, due: '2026-11-04', learnedOn: TODAY };
  const steps = [];
  for (let i = 0; i < L.REVIEW_INTERVALS.length; i++) { it = L.reviewItem(it, 'good', TODAY); steps.push(it.due); }
  assert.deepEqual(steps.slice(0, -1), ['2026-11-05', '2026-11-07', '2026-11-10', '2026-11-18', '2026-12-03']);
  assert.equal(it.due, null); // 완전히 외움
  assert.equal(it.step, L.MASTERED);
  assert.deepEqual(L.reviewItem({ step: 3, due: TODAY }, 'hard', TODAY), { step: 3, due: L.addDays(TODAY, 4) });
  assert.deepEqual(L.reviewItem({ step: 4, due: TODAY }, 'again', TODAY), { step: 0, due: L.addDays(TODAY, 1) });
});

test('복습할 단어 수와 복습 기록', () => {
  let g = cardGoal(10);
  for (const it of g.items.slice(0, 3)) g = L.learnCard(g, it.id, TODAY);
  const tomorrow = L.addDays(TODAY, 1);
  assert.equal(L.dailyPlan(g, TODAY).reviewsDue, 0);
  assert.equal(L.dailyPlan(g, tomorrow).reviewsDue, 3);
  g = L.applyReview(g, g.items[0].id, 'good', tomorrow);
  g = L.applyReview(g, g.items[1].id, 'again', tomorrow);
  assert.equal(L.dailyPlan(g, tomorrow).reviewsDue, 1);
  assert.deepEqual(g.reviewLog[tomorrow], { good: 1, hard: 0, again: 1 });
});

test('자동 조절: 전날 정답률로 하루 한 번만 바뀐다', () => {
  const y = L.addDays(TODAY, -1);
  const base = cardGoal(10, { factor: 1, factorDate: y });
  const up = L.adjustFactor({ ...base, reviewLog: { [y]: { good: 9, hard: 1, again: 0 } } }, TODAY);
  assert.equal(up.factor, 1.05);
  assert.equal(L.adjustFactor(up, TODAY), up); // 같은 날 두 번 조절하지 않음
  assert.equal(L.adjustFactor({ ...base, reviewLog: { [y]: { good: 3, hard: 0, again: 3 } } }, TODAY).factor, 0.95);
  assert.equal(L.adjustFactor({ ...base, reviewLog: { [y]: { good: 1, hard: 0, again: 3 } } }, TODAY).factor, 1); // 복습이 너무 적으면 그대로
  assert.equal(L.adjustFactor({ ...base, factor: 0.6, reviewLog: { [y]: { good: 0, hard: 0, again: 9 } } }, TODAY).factor, 0.6);
});

test('책·강의 분량: 이어서 범위를 기록하고 전체를 넘지 않는다', () => {
  let g = L.createGoal({ name: '수학책', kind: 'amount', unit: '페이지', total: 50, deadline: L.addDays(TODAY, 4), level: 'beginner' }, TODAY);
  assert.equal(L.dailyPlan(g, TODAY).quota, 10);
  g = L.addAmount(g, 10, TODAY);
  g = L.addAmount(g, 45, TODAY);
  assert.deepEqual(g.items.map(it => [it.from, it.to]), [[1, 10], [11, 50]]);
  assert.equal(L.addAmount(g, 5, TODAY), g);
  assert.ok(L.dailyPlan(g, TODAY).complete);
});

test('단어 붙여 넣기: 여러 구분 기호를 읽고, 못 읽은 줄은 센다', () => {
  const { cards, skipped } = L.parseCards('apple - 사과\nbanana\t바나나\n\nwell-known : 잘 알려진\ncat, 고양이, 명사\n그냥 문장\n- 뜻만');
  assert.deepEqual(cards, [
    { front: 'apple', back: '사과' }, { front: 'banana', back: '바나나' },
    { front: 'well-known', back: '잘 알려진' }, { front: 'cat', back: '고양이, 명사' },
  ]);
  assert.equal(skipped, 2);
});

test('공부 목표 백업: 예전 백업도 읽히고, 저장한 목표는 그대로 다시 읽힌다', () => {
  assert.deepEqual(L.normalizeData({ version: 1 }).goals, []);
  const data = L.emptyData();
  let g = cardGoal(5);
  g = L.learnCard(g, g.items[0].id, TODAY);
  g = L.applyReview(g, g.items[0].id, 'good', L.addDays(TODAY, 1));
  let book = L.createGoal({ name: '책', kind: 'amount', unit: '페이지', total: 30, deadline: L.addDays(TODAY, 2), level: 'middle' }, TODAY);
  book = L.addAmount(book, 12, TODAY);
  data.goals.push(g, book);
  assert.deepEqual(L.normalizeData(JSON.parse(JSON.stringify(data))), data);
});

test('공부 목표 백업: 잘못된 목표와 항목은 버린다', () => {
  const data = L.normalizeData({
    version: 1,
    goals: [
      { id: 'x', kind: 'video', name: '?', startDate: TODAY, deadline: TODAY },
      { id: 'b', kind: 'amount', name: '책', unit: '', total: 20, startDate: TODAY, deadline: TODAY, factor: 99,
        items: [{ id: 'c1', from: 1, to: 5, learnedOn: TODAY, step: 1, due: TODAY }, { id: 'c2', from: 9, to: 12, learnedOn: TODAY }, { id: 'c3', from: 6, to: 99, learnedOn: TODAY }] },
    ],
  });
  assert.equal(data.goals.length, 1);
  assert.equal(data.goals[0].factor, 2);
  assert.equal(data.goals[0].unit, '개');
  assert.deepEqual(data.goals[0].items.map(it => it.id), ['c1']);
});

test('직접 쳐서 맞히기 채점', () => {
  assert.equal(L.gradeTyped('apple', 'apple'), 'good');
  assert.equal(L.gradeTyped('  Apple ', 'apple'), 'good');
  assert.equal(L.gradeTyped('get  rid of', 'get rid of'), 'good');
  assert.equal(L.gradeTyped('colour', 'color/colour'), 'good');
  assert.equal(L.gradeTyped('run', 'run (ran, run)'), 'good');
  assert.equal(L.gradeTyped('aple', 'apple'), 'hard');          // 한 글자 빠짐
  assert.equal(L.gradeTyped('enviroment', 'environment'), 'hard');
  assert.equal(L.gradeTyped('enviromant', 'environment'), 'hard'); // 긴 단어는 두 글자까지
  assert.equal(L.gradeTyped('banana', 'apple'), 'again');
  assert.equal(L.gradeTyped('cut', 'cat'), 'again');             // 짧은 단어는 오타도 틀림
  assert.equal(L.gradeTyped('', 'apple'), 'again');
});

test('쳐서 맞히기 설정: 새 단어 목표는 켜져 있고 백업에도 남는다', () => {
  const g = cardGoal(3);
  assert.equal(g.typing, true);
  const book = L.createGoal({ name: '책', kind: 'amount', unit: '페이지', total: 10, deadline: TODAY, level: 'beginner' }, TODAY);
  assert.equal(book.typing, false);
  const off = L.normalizeData({ version: 1, goals: [{ ...g, typing: false }] }).goals[0];
  assert.equal(off.typing, false);
  assert.equal(L.normalizeData({ version: 1, goals: [g] }).goals[0].typing, true);
});

test('하루 횟수를 바꿔도 지난날 완료는 남고, 오늘은 새 목표로 센다', () => {
  const checks = { '2026-11-01': { a: 1 }, '2026-11-02': { a: 1 }, '2026-11-03': { a: 1 } };
  const next = L.retarget(checks, A, 3, '2026-11-03');
  assert.deepEqual(next, { '2026-11-01': { a: 3 }, '2026-11-02': { a: 3 }, '2026-11-03': { a: 1 } });
  const habit = { id: 'a', target: 3 };
  assert.equal(L.streak(next, habit, '2026-11-03'), 2);
  // 지난날 덜 채운 날은 그대로 (완료로 바꾸지 않음)
  assert.deepEqual(L.retarget({ '2026-11-01': { w: 2 } }, WATER, 5, '2026-11-03'), { '2026-11-01': { w: 2 } });
  assert.deepEqual(checks['2026-11-01'], { a: 1 }); // 원본은 그대로
});
