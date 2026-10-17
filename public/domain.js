export const TRIP_START = '2027-01-17';
export const TRIP_END = '2027-02-08';
export const ZONE = 'America/Santiago';
export const categories = ['friends', 'work', 'explore', 'travel', 'personal'];
export const tripDays = Array.from({length:23},(_,i)=>new Date(Date.UTC(2027,0,17+i)).toISOString().slice(0,10));
export function localParts(iso) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function chileInstant(day,time) {
  // Resolve the IANA offset instead of relying on the visitor's local timezone.
  let guess = Date.parse(`${day}T${time}:00Z`);
  for(let i=0;i<3;i++) {
    const p=localParts(guess);
    guess += Date.parse(`${day}T${time}:00Z`) - Date.parse(`${p.day}T${p.time}:00Z`);
  }
  const p=localParts(guess);
  if(p.day!==day || p.time!==time) throw new Error('Invalid local time');
  return new Date(guess).toISOString();
}
export function interval(day,time,minutes) {
  if(!tripDays.includes(day)|| !/^\d{2}:\d{2}$/.test(time)|| !Number.isFinite(+minutes)||+minutes<15||+minutes>480) throw new Error('Invalid meeting time');
  const starts_at=chileInstant(day,time);
  const ends_at=new Date(Date.parse(starts_at)+Number(minutes)*60000).toISOString();
  if(localParts(ends_at).day>TRIP_END) throw new Error('Outside trip dates');
  return {starts_at,ends_at};
}
export const escapeHTML = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
