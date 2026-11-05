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
  assert.deepEqual(days[0], { date: '2026-10-28', count: 1, done: false, off: false });
  assert.deepEqual(days[6], { date: '2026-11-03', count: 3, done: true, off: false });
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
  assert.deepEqual(data.habits, [{ id: 'a', name: '물 마시기', emoji: '💧', target: 1, unit: '', days: L.EVERY_DAY }]);
  assert.deepEqual(data.checks, { '2026-11-03': { a: 1 } });
  assert.deepEqual(data.entries, [{ id: 'e1', date: '2026-11-03', type: 'expense', amount: 5000, category: '기타', memo: '김밥' }]);
  assert.deepEqual(data.diary, { '2026-11-03': { mood: '🙂', text: '좋은 하루' } });
});

test('저장한 데이터는 그대로 다시 읽힌다', () => {
  const data = L.emptyData();
  data.habits.push({ id: 'h1', name: '운동', emoji: '🏃', target: 1, unit: '', days: [1, 3, 5] }, { id: 'h2', name: '물', emoji: '💧', target: 3, unit: '잔', days: L.EVERY_DAY });
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

test('이번 주는 월요일부터 일요일까지', () => {
  assert.deepEqual(L.weekOf('2026-11-03'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(L.weekOf('2026-11-08')[0], '2026-11-02'); // 일요일
  assert.equal(L.weekOf('2026-11-09')[0], '2026-11-09'); // 월요일
});

test('그날 습관 달성률', () => {
  const habits = [A, WATER];
  assert.deepEqual(L.habitRate(habits, { '2026-11-03': { a: 1, w: 2 } }, '2026-11-03'), { done: 1, total: 2, pct: 50 });
  assert.deepEqual(L.habitRate([], {}, '2026-11-03'), { done: 0, total: 0, pct: 0 });
});

test('기록 연속 일수: 습관·가계부·일기·공부 중 하나라도 기록한 날', () => {
  const data = L.emptyData();
  data.checks['2026-11-01'] = { a: 1 };
  data.entries.push({ id: 'e', date: '2026-11-02', type: 'expense', amount: 1, category: '기타', memo: '' });
  let g = cardGoal(2);
  g = L.learnCard(g, g.items[0].id, '2026-10-31');
  data.goals.push(g);
  assert.equal(L.recordStreak(data, '2026-11-03'), 3); // 오늘은 아직 → 어제까지 10/31~11/02
  data.diary['2026-11-03'] = { mood: '🙂', text: '' };
  assert.equal(L.recordStreak(data, '2026-11-03'), 4);
  assert.equal(L.recordStreak(data, '2026-11-06'), 0);
});





// 2026-11-02 은 월요일
const MWF = { id: 'm', target: 1, days: [1, 3, 5] };

test('습관 요일: 요일 읽기와 이름', () => {
  assert.equal(L.weekday('2026-11-02'), 1);
  assert.deepEqual(L.parseDays('월수금'), [1, 3, 5]);
  assert.deepEqual(L.parseDays('월, 목요일'), [1, 4]);
  assert.deepEqual(L.parseDays('평일'), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.parseDays('주말'), [0, 6]);
  assert.deepEqual(L.parseDays('매일'), L.EVERY_DAY);
  assert.equal(L.parseDays('월요일 저녁'), null);
  assert.equal(L.parseDays('  '), null);
  assert.equal(L.daysLabel([1, 3, 5]), '월·수·금');
  assert.equal(L.daysLabel([0, 1]), '월·일'); // 월요일부터
  assert.equal(L.daysLabel([1, 2, 3, 4, 5]), '평일');
  assert.equal(L.daysLabel(undefined), '매일');
  assert.equal(L.isScheduled(MWF, '2026-11-03'), false); // 화
  assert.equal(L.isScheduled(MWF, '2026-11-04'), true);  // 수
  assert.equal(L.isScheduled(A, '2026-11-03'), true);    // 요일이 없으면 매일
});

test('습관 요일: 쉬는 날은 연속 기록이 끊기지 않고, 달성률에서 빠진다', () => {
  // 10/26(월) 10/28(수) 10/30(금) 11/02(월) 했음, 11/04(수) 아직
  const checks = {};
  for (const d of ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02']) checks[d] = { m: 1 };
  assert.equal(L.streak(checks, MWF, '2026-11-03'), 4); // 화: 쉬는 날
  assert.equal(L.streak(checks, MWF, '2026-11-04'), 4); // 수: 아직 안 함 → 어제까지
  assert.equal(L.streak(checks, MWF, '2026-11-07'), 0); // 11/06(금)을 빠뜨림
  checks['2026-11-03'] = { m: 1 }; // 쉬는 날에 했으면 그날도 센다
  assert.equal(L.streak(checks, MWF, '2026-11-03'), 5);
  assert.deepEqual(L.recentDays({}, MWF, '2026-11-04', 3).map(d => d.off), [false, true, false]);

  assert.deepEqual(L.habitRate([A, MWF], { '2026-11-03': { a: 1, m: 1 } }, '2026-11-03'), { done: 1, total: 1, pct: 100 });
  assert.deepEqual(L.habitRate([MWF], {}, '2026-11-03'), { done: 0, total: 0, pct: 0 });
});

test('습관 요일 백업: 없거나 잘못된 요일은 매일로', () => {
  const back = L.normalizeData({ version: 1, habits: [
    { id: 'a', name: '물' }, { id: 'b', name: '운동', days: [5, 1, 3, 3] }, { id: 'c', name: '책', days: [9, 'x'] }, { id: 'd', name: '청소', days: [] },
  ] });
  assert.deepEqual(back.habits.map(h => h.days), [L.EVERY_DAY, [1, 3, 5], L.EVERY_DAY, L.EVERY_DAY]);
});

test('집중 타이머: 남은 시간, 집중 시간 쌓기, 백업', () => {
  const now = 1_000_000;
  assert.equal(L.timerLeft({ endsAt: now + 90_500, left: 0 }, now), 91);
  assert.equal(L.timerLeft({ endsAt: now - 5000, left: 0 }, now), 0);
  assert.equal(L.timerLeft({ endsAt: null, left: 300 }, now), 300);
  let focus = L.addFocus({}, TODAY, 25);
  focus = L.addFocus(focus, TODAY, 50);
  assert.deepEqual(focus, { [TODAY]: 75 });
  assert.equal(L.formatMinutes(75), '1시간 15분');
  assert.equal(L.formatMinutes(60), '1시간');
  assert.equal(L.formatMinutes(25), '25분');
  assert.deepEqual(L.normalizeData({ version: 1 }).focus, {});
  assert.deepEqual(L.normalizeData({ version: 1, focus: { [TODAY]: 75, bad: 3, '2026-11-01': -1, '2026-11-02': 2.5 } }).focus, { [TODAY]: 75 });
  const data = L.emptyData();
  data.focus = focus;
  assert.ok(L.activeDates(data).has(TODAY)); // 집중한 날도 기록한 날
});

test('집중 타이머 직접 설정: 1~180분만 받는다', () => {
  assert.equal(L.parseMinutes('40'), 40);
  assert.equal(L.parseMinutes(' 90분 '), 90);
  assert.equal(L.parseMinutes('180'), 180);
  assert.equal(L.parseMinutes('0'), null);
  assert.equal(L.parseMinutes('181'), null);
  assert.equal(L.parseMinutes('1.5'), null);
  assert.equal(L.parseMinutes('사십'), null);
  assert.equal(L.parseMinutes(''), null);
});

test('쇼핑 리스트: 마트별로 묶고, 안 산 것의 예상 금액(1개 가격 × 수량)을 더한다', () => {
  let list = [];
  list = L.addShopItem(list, { store: '이마트', name: '토마토', category: '식비', price: '2,000', qty: '3' }, 's1');
  list = L.addShopItem(list, { store: '코스트코', name: '과일', price: '' }, 's2');
  list = L.addShopItem(list, { store: ' 이마트 ', name: '쌀', price: '32000원' }, 's3');
  list = L.addShopItem(list, { store: '', name: '휴지', qty: '0' }, 's4');
  assert.equal(L.addShopItem(list, { store: '이마트', name: '  ' }, 's5'), list); // 품목이 없으면 그대로
  assert.deepEqual(list.map(i => [i.category, i.qty]), [['식비', 3], ['쇼핑', 1], ['쇼핑', 1], ['쇼핑', 1]]); // 잘못된 수량은 1
  assert.equal(L.addShopItem([], { name: '월급?', category: '월급' }, 'x')[0].category, '쇼핑'); // 수입 분류는 안 됨
  const groups = L.shopGroups(list);
  assert.deepEqual(groups.map(g => [g.store, g.items.map(i => i.name), g.left, g.total]),
    [['이마트', ['토마토', '쌀'], 2, 38000], ['코스트코', ['과일'], 1, 0], [L.NO_STORE, ['휴지'], 1, 0]]);
  assert.equal(L.parseQty('12개'), 12);
  assert.equal(L.parseQty('100'), null);
  assert.equal(L.parseQty('1.5'), null);
});

test('쇼핑 체크: 가격이 있으면 가계부에 적고, 없어도 체크만 되며, 취소하면 기록을 지운다', () => {
  let data = L.emptyData();
  data.shopping = L.addShopItem([], { store: '이마트', name: '토마토', category: '식비', price: '2000', qty: 3 }, 's1');
  data.shopping = L.addShopItem(data.shopping, { store: '코스트코', name: '과일' }, 's2');
  data.entries.push({ id: 'old', date: TODAY, type: 'expense', amount: 3000, category: '식비', memo: '' });

  data = L.buyShopItem(data, 's1', TODAY, 'e1');
  assert.deepEqual(data.entries[1], { id: 'e1', date: TODAY, type: 'expense', amount: 6000, category: '식비', memo: '이마트 토마토 ×3' });
  assert.deepEqual([data.shopping[0].bought, data.shopping[0].boughtOn, data.shopping[0].entryId], [true, TODAY, 'e1']);
  assert.equal(L.buyShopItem(data, 's1', TODAY, 'e9'), data); // 이미 산 것은 두 번 적지 않는다
  assert.deepEqual(L.shopGroups(data.shopping)[0], { store: '이마트', items: [data.shopping[0]], left: 0, total: 0, spent: 6000 });

  // 가격을 모르면 체크만 (가계부는 그대로), 산 날짜는 기억
  data = L.buyShopItem(data, 's2', '2026-11-02', 'e2');
  assert.equal(data.entries.length, 2);
  assert.deepEqual([data.shopping[1].bought, data.shopping[1].boughtOn, data.shopping[1].entryId], [true, '2026-11-02', '']);

  data = L.unbuyShopItem(data, 's1');
  assert.deepEqual(data.entries.map(e => e.id), ['old']);
  assert.deepEqual([data.shopping[0].bought, data.shopping[0].boughtOn], [false, null]);
  assert.equal(L.unbuyShopItem(data, 's2').entries.length, 1); // 적은 기록이 없으면 가계부는 그대로
});

test('쇼핑 가격·수량 고치기: 산 품목이면 가계부도 맞추고, 나중에 넣은 가격은 산 날짜로 적는다', () => {
  let data = L.emptyData();
  data.shopping = L.addShopItem([], { store: '이마트', name: '토마토', category: '식비', price: '2000' }, 's1');
  data.shopping = L.addShopItem(data.shopping, { store: '이마트', name: '쌀' }, 's2');
  data.entries.push({ id: 'other', date: '2026-11-01', type: 'expense', amount: 1000, category: '교통', memo: '' });

  // 아직 안 산 것: 가격·수량만 바뀐다
  let next = L.editShopItem(data, 's2', { price: '32,000' }, TODAY, 'x');
  next = L.editShopItem(next, 's2', { qty: '2' }, TODAY, 'x');
  assert.deepEqual([next.shopping[1].price, next.shopping[1].qty], [32000, 2]);
  assert.equal(next.entries, data.entries);
  assert.equal(L.editShopItem(next, 's2', { qty: '0' }, TODAY, 'x').shopping[1].qty, 2); // 잘못된 수량은 그대로

  // 산 것: 원래 기록(날짜·자리)은 그대로, 금액·메모만
  data = L.buyShopItem(data, 's1', '2026-11-02', 'e1');
  next = L.editShopItem(data, 's1', { qty: 3 }, TODAY, 'e9');
  assert.deepEqual(next.entries.map(e => [e.id, e.date, e.amount, e.memo]),
    [['other', '2026-11-01', 1000, ''], ['e1', '2026-11-02', 6000, '이마트 토마토 ×3']]);
  next = L.editShopItem(next, 's1', { price: '1,500' }, TODAY, 'e9');
  assert.equal(next.entries[1].amount, 4500);
  assert.equal(next.shopping[0].entryId, 'e1');

  // 가격을 지우면 기록도 지우고, 체크는 남는다
  const cleared = L.editShopItem(next, 's1', { price: '' }, TODAY, 'e9');
  assert.deepEqual(cleared.entries.map(e => e.id), ['other']);
  assert.deepEqual([cleared.shopping[0].bought, cleared.shopping[0].price, cleared.shopping[0].entryId], [true, 0, '']);

  // 가격 없이 산 것에 나중에 가격을 넣으면, 가격을 넣은 날이 아니라 산 날짜로 적는다
  const later = L.editShopItem(cleared, 's1', { price: '3000' }, TODAY, 'e2');
  assert.deepEqual(later.entries.at(-1), { id: 'e2', date: '2026-11-02', type: 'expense', amount: 9000, category: '식비', memo: '이마트 토마토 ×3' });
  assert.equal(later.shopping[0].entryId, 'e2');
});

test('쇼핑 리스트 백업: 예전 백업도 읽히고, 잘못된 항목과 없어진 기록 연결은 정리한다', () => {
  assert.deepEqual(L.normalizeData({ version: 1 }).shopping, []);
  let data = L.emptyData();
  data.shopping = L.addShopItem([], { store: '이마트', name: '토마토', price: '5000', qty: 2 }, 's1');
  data = L.buyShopItem(data, 's1', TODAY, 'e1');
  assert.deepEqual(L.normalizeData(JSON.parse(JSON.stringify(data))), data);

  const raw = JSON.parse(JSON.stringify(data));
  raw.entries = []; // 가계부에서 기록을 지운 경우
  raw.shopping.push({ id: 's1', name: '중복' }, { id: 's2', name: '' }, { id: 's3', name: '우유', price: -5, store: 7, category: '없는 분류', qty: 500, boughtOn: TODAY }, 'x');
  const back = L.normalizeData(raw);
  assert.equal(back.shopping[0].entryId, '');
  assert.deepEqual([back.shopping[0].bought, back.shopping[0].boughtOn], [true, TODAY]);
  // 수량·산 날짜가 없던 예전 품목은 1개, 안 산 품목의 산 날짜는 비움
  assert.deepEqual(back.shopping[1], { id: 's3', store: L.NO_STORE, name: '우유', category: '쇼핑', qty: 1, price: 0, bought: false, entryId: '', boughtOn: null });
  assert.equal(back.shopping.length, 2);
});
