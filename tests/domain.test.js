import test from 'node:test';
import assert from 'node:assert/strict';
import {tripDays,chileInstant,localParts,interval,escapeHTML} from '../public/domain.js';
test('Trip covers all 23 Chilean calendar dates',()=>{assert.equal(tripDays.length,23);assert.equal(tripDays[0],'2027-01-17');assert.equal(tripDays.at(-1),'2027-02-08')});
test('Chilean time is independent of visitor timezone, including midnight',()=>{assert.equal(chileInstant('2027-01-17','06:40'),'2027-01-17T09:40:00.000Z');assert.deepEqual(localParts('2027-02-09T02:50:00Z'),{day:'2027-02-08',time:'23:50'});assert.equal(chileInstant('2027-01-17','00:00'),'2027-01-17T03:00:00.000Z')});
test('Reject dates outside trip and durations outside supported range',()=>{assert.throws(()=>interval('2027-01-16','12:00',60));assert.throws(()=>interval('2027-02-08','23:30',120));assert.throws(()=>interval('2027-01-20','12:00',0));assert.throws(()=>interval('2027-01-20','12:00',900));assert.throws(()=>interval('2027-01-20','25:00',60));assert.equal(interval('2027-01-20','12:00',60).ends_at,'2027-01-20T16:00:00.000Z')});
test('User content cannot inject markup',()=>{assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')});
