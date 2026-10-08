import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localSky, readLocation, locationFromInputs, phaseName } from '../extension/lib/sky-model.js';

process.env.TZ = 'America/Los_Angeles';
const location = { latitude: 37.77, longitude: -122.42 };

test('location is optional and rejects invalid coordinates without replacing them with zero', () => {
  assert.equal(locationFromInputs('', ''), null);
  assert.deepEqual(locationFromInputs('0', '0'), { latitude: 0, longitude: 0 });
  for (const pair of [['', '2'], ['2', ''], ['91', '0'], ['0', '-181'], ['nope', '1']]) {
    assert.throws(() => locationFromInputs(...pair));
  }
  for (const value of [null, { latitude: NaN, longitude: 0 }, { latitude: '1', longitude: 2 }]) assert.equal(readLocation(value), null);
});

test('rise/set times match the US Naval Observatory reference within a minute', () => {
  // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-08&coords=37.77,-122.42&tz=-8&dst=true
  const sky = localSky(new Date('2026-10-08T12:00:00'), location);
  for (const [event, time] of [[sky.sun.sunrise, '07:12'], [sky.sun.sunset, '18:42'], [sky.moon.rise, '05:09'], [sky.moon.set, '17:38']]) {
    assert.ok(Math.abs(event - new Date(`2026-10-08T${time}:00`)) < 60000);
  }
  assert.equal(sky.phase, 'Waning crescent');
  assert.ok(Math.abs(sky.illumination.fraction - .04) < .01);
});

test('phase and illumination work without a location', () => {
  const sky = localSky(new Date('2026-10-08T09:00:00'), null);
  assert.equal(sky.sun, null);
  assert.equal(sky.moon, null);
  assert.equal(sky.phase, 'Waning crescent');
  assert.ok(sky.illumination.fraction > 0 && sky.illumination.fraction < 1);
  assert.equal(phaseName(.94), 'Waning crescent');
  assert.equal(phaseName(.5), 'Full moon');
});

test('events stay on the selected local day near midnight and across daylight saving changes', () => {
  for (const day of ['2026-03-08', '2026-11-01']) {
    const morning = localSky(new Date(`${day}T00:01:00`), location);
    const evening = localSky(new Date(`${day}T23:59:00`), location);
    for (const body of ['sun', 'moon']) {
      for (const event of body === 'sun' ? ['sunrise', 'sunset'] : ['rise', 'set']) {
        assert.equal(morning[body][event]?.getTime(), evening[body][event]?.getTime());
        const value = morning[body][event];
        if (value) assert.equal(value.getDate(), Number(day.slice(-2)));
      }
    }
  }
});

test('polar daylight and darkness do not invent rise or set times', () => {
  const polar = { latitude: 89, longitude: 0 };
  for (const [date, flag] of [['2026-06-21T12:00:00', 'alwaysUp'], ['2026-12-21T12:00:00', 'alwaysDown']]) {
    const sky = localSky(new Date(date), polar);
    assert.equal(sky.sun.sunrise, null);
    assert.equal(sky.sun.sunset, null);
    assert.equal(sky.sun[flag], true);
  }
});
