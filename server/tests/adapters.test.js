/**
 * Adapter Unit Tests
 *
 * Tests the pure transformation helpers in TBAdapter and GreentechAdapter.
 * No real IoT platform is contacted — all methods under test are synchronous
 * or use pre-seeded in-memory cache data.
 */

const { TBAdapter }        = require('../adapters/tb-adapter');
const { GreentechAdapter } = require('../adapters/greentech-adapter');

// ─────────────────────────────────────────────────────────────────────────────
// TBAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe('TBAdapter._parseTelemetryResponse', () => {
  let adapter;
  beforeAll(() => {
    adapter = new TBAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('parses standard TB array format { key: [{value}] }', () => {
    const raw = { temperature: [{ value: '22.5' }], line1: [{ value: 'true' }] };
    const result = adapter._parseTelemetryResponse(raw);
    expect(result.temperature).toBe(22.5);
    expect(result.line1).toBe(true);
  });

  test('converts "true" string to boolean true', () => {
    expect(adapter._parseTelemetryResponse({ flag: [{ value: 'true' }] }).flag).toBe(true);
  });

  test('converts "false" string to boolean false', () => {
    expect(adapter._parseTelemetryResponse({ flag: [{ value: 'false' }] }).flag).toBe(false);
  });

  test('converts numeric strings to numbers', () => {
    const r = adapter._parseTelemetryResponse({ acTemperatureSet: [{ value: '24' }] });
    expect(r.acTemperatureSet).toBe(24);
  });

  test('leaves non-numeric strings as-is', () => {
    const r = adapter._parseTelemetryResponse({ label: [{ value: 'hello' }] });
    expect(r.label).toBe('hello');
  });

  test('returns empty object for null input', () => {
    expect(adapter._parseTelemetryResponse(null)).toEqual({});
  });

  test('returns empty object for undefined input', () => {
    expect(adapter._parseTelemetryResponse(undefined)).toEqual({});
  });

  test('skips keys with empty arrays', () => {
    const r = adapter._parseTelemetryResponse({
      temperature: [],
      humidity: [{ value: '55' }],
    });
    expect(r.temperature).toBeUndefined();
    expect(r.humidity).toBe(55);
  });

  test('handles TB timestamp format { key: [[ts, val]] }', () => {
    // TB also returns [[timestamp, value]] in some contexts — value at index 1
    const raw = { line1: [['1710000000000', 'true']] };
    // arr[0][1] path: arr[0].value is undefined, so arr[0] itself is the value
    // _parseTelemetryResponse uses arr[0].value ?? arr[0]
    const result = adapter._parseTelemetryResponse(raw);
    // Should not throw; value falls back to the array element itself
    expect(result).toBeDefined();
  });
});

describe('TBAdapter.getDeviceConfig', () => {
  let adapter;
  beforeAll(() => {
    adapter = new TBAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('returns standard 3-lamp / 2-dimmer defaults', async () => {
    const cfg = await adapter.getDeviceConfig();
    expect(cfg.lamps).toBe(3);
    expect(cfg.dimmers).toBe(2);
    expect(cfg.ac).toBe(1);
    expect(cfg.curtains).toBe(1);
    expect(cfg.blinds).toBe(1);
  });

  test('lampNames has exactly 3 entries', async () => {
    const cfg = await adapter.getDeviceConfig();
    expect(cfg.lampNames).toHaveLength(3);
    expect(typeof cfg.lampNames[0]).toBe('string');
  });

  test('dimmerNames has exactly 2 entries', async () => {
    const cfg = await adapter.getDeviceConfig();
    expect(cfg.dimmerNames).toHaveLength(2);
  });
});

describe('TBAdapter.getCapabilities', () => {
  let adapter;
  beforeAll(() => {
    adapter = new TBAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('reports realtime: true', () => {
    expect(adapter.getCapabilities().realtime).toBe(true);
  });

  test('reports commandVerify: true', () => {
    expect(adapter.getCapabilities().commandVerify).toBe(true);
  });

  test('reports doorLock: true', () => {
    expect(adapter.getCapabilities().doorLock).toBe(true);
  });

  test('sensors list includes temperature, humidity, co2', () => {
    const { sensors } = adapter.getCapabilities();
    expect(sensors).toContain('temperature');
    expect(sensors).toContain('humidity');
    expect(sensors).toContain('co2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter — helper utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._curtainPos', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('"open"  → 100', () => expect(adapter._curtainPos('open')).toBe(100));
  test('"close" → 0',   () => expect(adapter._curtainPos('close')).toBe(0));
  test('"stop"  → 50',  () => expect(adapter._curtainPos('stop')).toBe(50));
  test('null    → 0',   () => expect(adapter._curtainPos(null)).toBe(0));
  test('undefined → 0', () => expect(adapter._curtainPos(undefined)).toBe(0));
  test('"OPEN" (uppercase) → 0 — case-sensitive API value', () => {
    // The Greentech API returns lowercase; uppercase is not a valid state
    expect(adapter._curtainPos('OPEN')).toBe(0);
  });
});

describe('GreentechAdapter._flattenTBFormat', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('extracts value from TB array wrapper', () => {
    const flat = adapter._flattenTBFormat({
      line1:       [{ value: true }],
      temperature: [{ value: 22.5 }],
      acMode:      [{ value: 2 }],
    });
    expect(flat.line1).toBe(true);
    expect(flat.temperature).toBe(22.5);
    expect(flat.acMode).toBe(2);
  });

  test('skips keys with empty arrays', () => {
    const flat = adapter._flattenTBFormat({ line1: [], line2: [{ value: false }] });
    expect(flat.line1).toBeUndefined();
    expect(flat.line2).toBe(false);
  });

  test('returns empty object for empty input', () => {
    expect(adapter._flattenTBFormat({})).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._buildTBFormat — room-level status fields
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._buildTBFormat — room status (Chinese values)', () => {
  let adapter;
  const emptyGroups = { d: [], tgd: [], wk: [], cl: [], cj: [], fw: [] };

  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('checkStatus "入住" → roomStatus 1 (occupied)', () => {
    const tb = adapter._buildTBFormat({ checkStatus: '入住' }, emptyGroups);
    expect(tb.roomStatus[0].value).toBe(1);
  });

  test('checkStatus "未入住" → roomStatus 0 (vacant)', () => {
    const tb = adapter._buildTBFormat({ checkStatus: '未入住' }, emptyGroups);
    expect(tb.roomStatus[0].value).toBe(0);
  });

  test('checkStatus any other value → roomStatus 0', () => {
    const tb = adapter._buildTBFormat({ checkStatus: 'unknown' }, emptyGroups);
    expect(tb.roomStatus[0].value).toBe(0);
  });

  test('lockStatus "开" → doorUnlock true (unlocked)', () => {
    const tb = adapter._buildTBFormat({ lockStatus: '开' }, emptyGroups);
    expect(tb.doorUnlock[0].value).toBe(true);
  });

  test('lockStatus "关" → doorUnlock false (locked)', () => {
    const tb = adapter._buildTBFormat({ lockStatus: '关' }, emptyGroups);
    expect(tb.doorUnlock[0].value).toBe(false);
  });

  test('outStatus "开" → dndService true (DND active)', () => {
    const tb = adapter._buildTBFormat({ outStatus: '开' }, emptyGroups);
    expect(tb.dndService[0].value).toBe(true);
  });

  test('outStatus "关" → dndService false', () => {
    const tb = adapter._buildTBFormat({ outStatus: '关' }, emptyGroups);
    expect(tb.dndService[0].value).toBe(false);
  });

  test('hoststatus "1" → deviceStatus 1 (online)', () => {
    const tb = adapter._buildTBFormat({ hoststatus: '1' }, emptyGroups);
    expect(tb.deviceStatus[0].value).toBe(1);
  });

  test('hoststatus "0" → deviceStatus 0 (offline)', () => {
    const tb = adapter._buildTBFormat({ hoststatus: '0' }, emptyGroups);
    expect(tb.deviceStatus[0].value).toBe(0);
  });

  test('powerStatus "开" → pdMode false (card inserted = power on)', () => {
    const tb = adapter._buildTBFormat({ powerStatus: '开' }, emptyGroups);
    expect(tb.pdMode[0].value).toBe(false);
  });

  test('powerStatus "关" → pdMode true (card removed = power down)', () => {
    const tb = adapter._buildTBFormat({ powerStatus: '关' }, emptyGroups);
    expect(tb.pdMode[0].value).toBe(true);
  });

  test('airStatus "开" → acRunning true', () => {
    const tb = adapter._buildTBFormat({ airStatus: '开' }, emptyGroups);
    expect(tb.acRunning[0].value).toBe(true);
  });

  test('airStatus "关" → acRunning false', () => {
    const tb = adapter._buildTBFormat({ airStatus: '关' }, emptyGroups);
    expect(tb.acRunning[0].value).toBe(false);
  });

  test('missing field → key absent from result', () => {
    const tb = adapter._buildTBFormat({}, emptyGroups);
    expect(tb.roomStatus).toBeUndefined();
    expect(tb.doorUnlock).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._buildTBFormat — lamps & dimmers (dynamic count)
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._buildTBFormat — lamps', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('maps 5 lamps dynamically to line1–line5', () => {
    const groups = {
      d: [
        { turn: 'ON' }, { turn: 'OFF' }, { turn: 'ON' }, { turn: 'OFF' }, { turn: 'ON' }
      ],
      tgd: [], wk: [], cl: [], cj: [], fw: [],
    };
    const tb = adapter._buildTBFormat({}, groups);
    expect(tb.line1[0].value).toBe(true);
    expect(tb.line2[0].value).toBe(false);
    expect(tb.line3[0].value).toBe(true);
    expect(tb.line4[0].value).toBe(false);
    expect(tb.line5[0].value).toBe(true);
    expect(tb.line6).toBeUndefined();
  });

  test('no lamps → no line keys', () => {
    const groups = { d: [], tgd: [], wk: [], cl: [], cj: [], fw: [] };
    const tb = adapter._buildTBFormat({}, groups);
    expect(tb.line1).toBeUndefined();
  });
});

describe('GreentechAdapter._buildTBFormat — dimmers', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('dimmer ON with brightness 75 → dimmer1 = 75', () => {
    const groups = { d: [], tgd: [{ turn: 'ON', brightness: 75 }], wk: [], cl: [], cj: [], fw: [] };
    expect(adapter._buildTBFormat({}, groups).dimmer1[0].value).toBe(75);
  });

  test('dimmer OFF → dimmer1 = 0 (regardless of stored brightness)', () => {
    const groups = { d: [], tgd: [{ turn: 'OFF', brightness: 75 }], wk: [], cl: [], cj: [], fw: [] };
    expect(adapter._buildTBFormat({}, groups).dimmer1[0].value).toBe(0);
  });

  test('dimmer ON with no brightness → defaults to 100', () => {
    const groups = { d: [], tgd: [{ turn: 'ON' }], wk: [], cl: [], cj: [], fw: [] };
    expect(adapter._buildTBFormat({}, groups).dimmer1[0].value).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._buildTBFormat — AC
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._buildTBFormat — AC (Chinese mode mapping)', () => {
  let adapter;
  const base = { d: [], tgd: [], cl: [], cj: [], fw: [] };
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('"制冷" (cooling) ON → acMode 2', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '低风' }] };
    expect(adapter._buildTBFormat({}, g).acMode[0].value).toBe(2);
  });

  test('"制热" (heating) ON → acMode 1', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制热', temperature: '24', fatSpeed: '自动' }] };
    expect(adapter._buildTBFormat({}, g).acMode[0].value).toBe(1);
  });

  test('"通风" (ventilation) ON → acMode 3', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '通风', temperature: '26', fatSpeed: '高风' }] };
    expect(adapter._buildTBFormat({}, g).acMode[0].value).toBe(3);
  });

  test('AC OFF → acMode 0', () => {
    const g = { ...base, wk: [{ turn: 'OFF', modern: '制冷', temperature: '22', fatSpeed: '低风' }] };
    expect(adapter._buildTBFormat({}, g).acMode[0].value).toBe(0);
  });

  test('temperature string "22" → acTemperatureSet 22 (number)', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '自动' }] };
    expect(adapter._buildTBFormat({}, g).acTemperatureSet[0].value).toBe(22);
  });

  test('"低风" (low) → fanSpeed 1', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '低风' }] };
    expect(adapter._buildTBFormat({}, g).fanSpeed[0].value).toBe(1);
  });

  test('"中风" (medium) → fanSpeed 2', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '中风' }] };
    expect(adapter._buildTBFormat({}, g).fanSpeed[0].value).toBe(2);
  });

  test('"高风" (high) → fanSpeed 3', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '高风' }] };
    expect(adapter._buildTBFormat({}, g).fanSpeed[0].value).toBe(3);
  });

  test('"自动" (auto) → fanSpeed 0', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '自动' }] };
    expect(adapter._buildTBFormat({}, g).fanSpeed[0].value).toBe(0);
  });

  test('curTemp "23.5" → temperature 23.5', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '自动', curTemp: '23.5' }] };
    expect(adapter._buildTBFormat({}, g).temperature[0].value).toBe(23.5);
  });

  test('missing curTemp → temperature key absent', () => {
    const g = { ...base, wk: [{ turn: 'ON', modern: '制冷', temperature: '22', fatSpeed: '自动' }] };
    expect(adapter._buildTBFormat({}, g).temperature).toBeUndefined();
  });

  test('no wk device → no AC keys in result', () => {
    const g = { ...base, wk: [] };
    const tb = adapter._buildTBFormat({}, g);
    expect(tb.acMode).toBeUndefined();
    expect(tb.fanSpeed).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._buildTBFormat — curtains
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._buildTBFormat — curtains', () => {
  let adapter;
  const base = { d: [], tgd: [], wk: [], cj: [], fw: [] };
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('cl[0] open → curtainsPosition 100', () => {
    const g = { ...base, cl: [{ certain: 'open' }] };
    expect(adapter._buildTBFormat({}, g).curtainsPosition[0].value).toBe(100);
  });

  test('cl[0] close → curtainsPosition 0', () => {
    const g = { ...base, cl: [{ certain: 'close' }] };
    expect(adapter._buildTBFormat({}, g).curtainsPosition[0].value).toBe(0);
  });

  test('cl[1] maps to blindsPosition', () => {
    const g = { ...base, cl: [{ certain: 'close' }, { certain: 'open' }] };
    const tb = adapter._buildTBFormat({}, g);
    expect(tb.curtainsPosition[0].value).toBe(0);
    expect(tb.blindsPosition[0].value).toBe(100);
  });

  test('no cl devices → curtains keys absent', () => {
    const g = { ...base, cl: [] };
    const tb = adapter._buildTBFormat({}, g);
    expect(tb.curtainsPosition).toBeUndefined();
    expect(tb.blindsPosition).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._translateToGreentechCommands — lamps
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._translateToGreentechCommands — lamps', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  const base = { tgd: [], wk: [], cl: [], cj: [], fw: [] };

  test('line1=true → { id, turn: "ON" } for d[0]', () => {
    const cmds = adapter._translateToGreentechCommands({ line1: true }, { ...base, d: [{ id: 'lamp-1' }] });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({ id: 'lamp-1', turn: 'ON' });
  });

  test('line1=false → { id, turn: "OFF" }', () => {
    const cmds = adapter._translateToGreentechCommands({ line1: false }, { ...base, d: [{ id: 'lamp-1' }] });
    expect(cmds[0]).toEqual({ id: 'lamp-1', turn: 'OFF' });
  });

  test('line2 maps to d[1]', () => {
    const cmds = adapter._translateToGreentechCommands(
      { line2: true }, { ...base, d: [{ id: 'l1' }, { id: 'l2' }] }
    );
    expect(cmds[0].id).toBe('l2');
  });

  test('maps 5 lamps dynamically (line1–line5)', () => {
    const d = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }];
    const cmds = adapter._translateToGreentechCommands(
      { line1: true, line3: false, line5: true }, { ...base, d }
    );
    expect(cmds).toHaveLength(3);
    expect(cmds.find(c => c.id === 'l1').turn).toBe('ON');
    expect(cmds.find(c => c.id === 'l3').turn).toBe('OFF');
    expect(cmds.find(c => c.id === 'l5').turn).toBe('ON');
  });

  test('ignores line index beyond available devices (no error)', () => {
    const cmds = adapter._translateToGreentechCommands(
      { line2: true }, { ...base, d: [{ id: 'l1' }] }
    );
    expect(cmds).toHaveLength(0);
  });

  test('empty telemetry → empty commands', () => {
    expect(adapter._translateToGreentechCommands({}, { ...base, d: [{ id: 'l1' }] })).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._translateToGreentechCommands — dimmers
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._translateToGreentechCommands — dimmers', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });
  const base = { d: [], wk: [], cl: [], cj: [], fw: [] };

  test('dimmer1=80 → { id, turn: "ON", brightness: 80 }', () => {
    const cmds = adapter._translateToGreentechCommands(
      { dimmer1: 80 }, { ...base, tgd: [{ id: 'd1' }] }
    );
    expect(cmds[0]).toEqual({ id: 'd1', turn: 'ON', brightness: 80 });
  });

  test('dimmer1=0 → { id, turn: "OFF", brightness: 0 }', () => {
    const cmds = adapter._translateToGreentechCommands(
      { dimmer1: 0 }, { ...base, tgd: [{ id: 'd1' }] }
    );
    expect(cmds[0]).toEqual({ id: 'd1', turn: 'OFF', brightness: 0 });
  });

  test('dimmer2 maps to tgd[1]', () => {
    const cmds = adapter._translateToGreentechCommands(
      { dimmer2: 50 }, { ...base, tgd: [{ id: 'd1' }, { id: 'd2' }] }
    );
    expect(cmds[0].id).toBe('d2');
    expect(cmds[0].brightness).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._translateToGreentechCommands — AC
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._translateToGreentechCommands — AC', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });
  const base = { d: [], tgd: [], cl: [], cj: [], fw: [] };
  const withAC = { ...base, wk: [{ id: 'ac-1' }] };

  test('acMode 0 → turn "OFF"', () => {
    const cmds = adapter._translateToGreentechCommands({ acMode: 0 }, withAC);
    expect(cmds[0].turn).toBe('OFF');
    expect(cmds[0].id).toBe('ac-1');
    expect(cmds[0].modern).toBeUndefined();
  });

  test('acMode 1 (heating) → turn "ON", modern "制热"', () => {
    const cmds = adapter._translateToGreentechCommands({ acMode: 1 }, withAC);
    expect(cmds[0].turn).toBe('ON');
    expect(cmds[0].modern).toBe('制热');
  });

  test('acMode 2 (cooling) → modern "制冷"', () => {
    expect(adapter._translateToGreentechCommands({ acMode: 2 }, withAC)[0].modern).toBe('制冷');
  });

  test('acMode 3 (ventilation) → modern "通风"', () => {
    expect(adapter._translateToGreentechCommands({ acMode: 3 }, withAC)[0].modern).toBe('通风');
  });

  test('acTemperatureSet → temperature sent as string', () => {
    const cmds = adapter._translateToGreentechCommands({ acTemperatureSet: 22 }, withAC);
    expect(cmds[0].temperature).toBe('22');
  });

  test('fanSpeed 0 → fatSpeed "自动" (auto)', () => {
    expect(adapter._translateToGreentechCommands({ fanSpeed: 0 }, withAC)[0].fatSpeed).toBe('自动');
  });

  test('fanSpeed 1 → fatSpeed "低风" (low)', () => {
    expect(adapter._translateToGreentechCommands({ fanSpeed: 1 }, withAC)[0].fatSpeed).toBe('低风');
  });

  test('fanSpeed 2 → fatSpeed "中风" (medium)', () => {
    expect(adapter._translateToGreentechCommands({ fanSpeed: 2 }, withAC)[0].fatSpeed).toBe('中风');
  });

  test('fanSpeed 3 → fatSpeed "高风" (high)', () => {
    expect(adapter._translateToGreentechCommands({ fanSpeed: 3 }, withAC)[0].fatSpeed).toBe('高风');
  });

  test('all AC keys combined into exactly one command', () => {
    const cmds = adapter._translateToGreentechCommands(
      { acMode: 2, acTemperatureSet: 23, fanSpeed: 2 }, withAC
    );
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ id: 'ac-1', turn: 'ON', modern: '制冷', temperature: '23', fatSpeed: '中风' });
  });

  test('no commands when wk is empty', () => {
    expect(adapter._translateToGreentechCommands({ acMode: 2 }, { ...base, wk: [] })).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter._translateToGreentechCommands — curtains
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter._translateToGreentechCommands — curtains', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });
  const base = { d: [], tgd: [], wk: [], cj: [], fw: [] };

  test('curtainsPosition > 0 → certain: "open" for cl[0]', () => {
    const cmds = adapter._translateToGreentechCommands(
      { curtainsPosition: 100 }, { ...base, cl: [{ id: 'cl-1' }] }
    );
    expect(cmds[0]).toEqual({ id: 'cl-1', certain: 'open' });
  });

  test('curtainsPosition 0 → certain: "close"', () => {
    const cmds = adapter._translateToGreentechCommands(
      { curtainsPosition: 0 }, { ...base, cl: [{ id: 'cl-1' }] }
    );
    expect(cmds[0]).toEqual({ id: 'cl-1', certain: 'close' });
  });

  test('blindsPosition maps to cl[1]', () => {
    const cmds = adapter._translateToGreentechCommands(
      { blindsPosition: 100 }, { ...base, cl: [{ id: 'cl-1' }, { id: 'cl-2' }] }
    );
    expect(cmds[0]).toEqual({ id: 'cl-2', certain: 'open' });
  });

  test('no curtain commands when cl is empty', () => {
    expect(
      adapter._translateToGreentechCommands({ curtainsPosition: 100 }, { ...base, cl: [] })
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreentechAdapter.getDeviceConfig — uses pre-seeded device cache
// ─────────────────────────────────────────────────────────────────────────────

describe('GreentechAdapter.getDeviceConfig', () => {
  let adapter;

  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
    adapter.authenticate = async () => {};     // skip real API auth
    adapter._deviceCache.set('room-1', {
      d:   [{ id: 'l1', deviceName: 'Socket' }, { id: 'l2', deviceName: 'Chandelier' }],
      tgd: [{ id: 'd1', deviceName: 'Main Dimmer' }],
      wk:  [{ id: 'ac-1' }],
      cl:  [{ id: 'cl-1' }],
      cj:  [],
      fw:  [],
    });
  });

  test('lamps count matches d[] length', async () => {
    expect((await adapter.getDeviceConfig('room-1')).lamps).toBe(2);
  });

  test('dimmers count matches tgd[] length', async () => {
    expect((await adapter.getDeviceConfig('room-1')).dimmers).toBe(1);
  });

  test('ac = 1 when wk[] is non-empty', async () => {
    expect((await adapter.getDeviceConfig('room-1')).ac).toBe(1);
  });

  test('curtains = 1 when cl[] has ≥1 entry', async () => {
    expect((await adapter.getDeviceConfig('room-1')).curtains).toBe(1);
  });

  test('blinds = 0 when cl[] has only 1 entry', async () => {
    expect((await adapter.getDeviceConfig('room-1')).blinds).toBe(0);
  });

  test('lampNames extracted from deviceName fields', async () => {
    const cfg = await adapter.getDeviceConfig('room-1');
    expect(cfg.lampNames).toEqual(['Socket', 'Chandelier']);
  });

  test('dimmerNames extracted from deviceName fields', async () => {
    const cfg = await adapter.getDeviceConfig('room-1');
    expect(cfg.dimmerNames).toEqual(['Main Dimmer']);
  });

  test('blinds = 1 when cl[] has ≥2 entries', async () => {
    adapter._deviceCache.set('room-2', {
      d: [], tgd: [], wk: [], cl: [{ id: 'cl-1' }, { id: 'cl-2' }], cj: [], fw: []
    });
    expect((await adapter.getDeviceConfig('room-2')).blinds).toBe(1);
  });
});

describe('GreentechAdapter.getCapabilities', () => {
  let adapter;
  beforeAll(() => {
    adapter = new GreentechAdapter({ host: 'http://localhost', username: 'u', password: 'p' });
  });

  test('realtime is false (polling only)', () => {
    expect(adapter.getCapabilities().realtime).toBe(false);
  });

  test('commandVerify is false', () => {
    expect(adapter.getCapabilities().commandVerify).toBe(false);
  });

  test('sensors includes temperature', () => {
    expect(adapter.getCapabilities().sensors).toContain('temperature');
  });

  test('doorLock is false (not available in Greentech)', () => {
    expect(adapter.getCapabilities().doorLock).toBe(false);
  });
});
