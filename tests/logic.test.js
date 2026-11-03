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

test('체크 켜고 끄기는 원본을 바꾸지 않고, 빈 날짜는 지운다', () => {
  const before = {};
  const on = L.toggleCheck(before, '2026-11-03', 'a');
  assert.deepEqual(before, {});
  assert.deepEqual(on, { '2026-11-03': ['a'] });
  assert.deepEqual(L.toggleCheck(on, '2026-11-03', 'a'), {});
});

test('연속 기록: 오늘 안 했으면 어제까지 센다', () => {
  const checks = { '2026-11-01': ['a'], '2026-11-02': ['a'], '2026-10-30': ['a'] };
  assert.equal(L.streak(checks, 'a', '2026-11-03'), 2);
  assert.equal(L.streak({ ...checks, '2026-11-03': ['a'] }, 'a', '2026-11-03'), 3);
  assert.equal(L.streak(checks, 'a', '2026-11-05'), 0);
  assert.equal(L.streak(checks, 'b', '2026-11-03'), 0);
});

test('최근 7일은 오래된 날부터 오늘까지', () => {
  const days = L.recentDays({ '2026-11-03': ['a'], '2026-10-28': ['a'] }, 'a', '2026-11-03');
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { date: '2026-10-28', done: true });
  assert.deepEqual(days[6], { date: '2026-11-03', done: true });
  assert.equal(days.filter(d => d.done).length, 2);
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
  assert.deepEqual(data.habits, [{ id: 'a', name: '물 마시기', emoji: '💧' }]);
  assert.deepEqual(data.checks, { '2026-11-03': ['a'] });
  assert.deepEqual(data.entries, [{ id: 'e1', date: '2026-11-03', type: 'expense', amount: 5000, category: '기타', memo: '김밥' }]);
  assert.deepEqual(data.diary, { '2026-11-03': { mood: '🙂', text: '좋은 하루' } });
});

test('저장한 데이터는 그대로 다시 읽힌다', () => {
  const data = L.emptyData();
  data.habits.push({ id: 'h1', name: '운동', emoji: '🏃' });
  data.checks['2026-11-03'] = ['h1'];
  data.entries.push({ id: 'e1', date: '2026-11-03', type: 'income', amount: 1000, category: '용돈', memo: '' });
  data.diary['2026-11-03'] = { mood: '', text: '<script>alert(1)</script>' };
  assert.deepEqual(L.normalizeData(JSON.parse(JSON.stringify(data))), data);
});
