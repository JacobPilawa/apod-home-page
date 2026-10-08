import { getTimes, getMoonTimes, getMoonIllumination } from '../vendor/suncalc/index.js';

export function readLocation(value) {
  if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
      !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  return { latitude: value.latitude, longitude: value.longitude };
}

export function locationFromInputs(latitude, longitude) {
  if (!latitude.trim() && !longitude.trim()) return null;
  const location = latitude.trim() && longitude.trim() && readLocation({ latitude: Number(latitude), longitude: Number(longitude) });
  if (!location) throw new Error('Enter a latitude from −90 to 90 and a longitude from −180 to 180, or leave both blank.');
  return location;
}

export function phaseName(phase) {
  // Primary phases are brief events; avoid calling a thin crescent a new moon.
  if (phase < .01 || phase > .99) return 'New moon';
  if (Math.abs(phase - .25) < .01) return 'First quarter';
  if (Math.abs(phase - .5) < .01) return 'Full moon';
  if (Math.abs(phase - .75) < .01) return 'Last quarter';
  if (phase < .25) return 'Waxing crescent';
  if (phase < .5) return 'Waxing gibbous';
  if (phase < .75) return 'Waning gibbous';
  return 'Waning crescent';
}

export function localSky(now, location) {
  const illumination = getMoonIllumination(now);
  const sky = { illumination, phase: phaseName(illumination.phase), sun: null, moon: null };
  location = readLocation(location);
  if (!location) return sky;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const noon = new Date(start);
  noon.setHours(12);
  const inDay = date => date instanceof Date && Number.isFinite(date.getTime()) && date >= start && date < end;
  const { latitude, longitude } = location;
  const sun = getTimes(noon, latitude, longitude, 0, -noon.getTimezoneOffset());
  sky.sun = { ...sun, sunrise: inDay(sun.sunrise) ? sun.sunrise : null, sunset: inDay(sun.sunset) ? sun.sunset : null };
  // Cover both UTC offsets on a daylight-saving transition day, then keep only
  // events within the actual local calendar day (which can be 23 or 25 hours).
  const offsets = new Set([-start.getTimezoneOffset(), -new Date(end.getTime() - 1).getTimezoneOffset()]);
  const moonDays = [...offsets].map(offset => getMoonTimes(noon, latitude, longitude, offset));
  sky.moon = {
    rise: moonDays.map(day => day.rise).find(inDay) || null,
    set: moonDays.map(day => day.set).find(inDay) || null,
    alwaysUp: moonDays.every(day => day.alwaysUp),
    alwaysDown: moonDays.every(day => day.alwaysDown)
  };
  return sky;
}
