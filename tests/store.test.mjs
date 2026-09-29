import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createStore } from '../server/store.mjs';

function fixture(t) {
  const store = createStore(); t.after(() => store.close());
  const party = store.saveParty({ name: 'test night', shot_ml: 30, reference_ml: 30, reference_abv: 40 });
  const guest = store.saveGuest({ name: 'bob a' });
  const spirit = store.saveDrink({ name: 'Vodka', kind: 'spirit', abv: 40, price_per_ml: 3.75 / 30 });
  let request = 0;
  const serve = extra => store.submit({ party_id: party.id, guest_id: guest.id, drink_id: spirit.id, shots: 1, request_id: `request-${++request}`, ...extra });
  return { store, party, guest, spirit, serve };
}

test('quarter-shot pours store real volume and immutable strength/price snapshots', t => {
  const { store, party, spirit, serve } = fixture(t);
  serve({ shots: 1.25 });
  let s = store.state().servings[0];
  assert.equal(s.alcohol_ml, 15); assert.equal(s.ingredients[0].ml, 37.5); assert.equal(s.price_cents, 469);
  store.saveParty({ ...party, shot_ml: 60, reference_ml: 45, reference_abv: 50 });
  store.saveDrink({ id: spirit.id, name: 'Vodka Changed', kind: 'spirit', abv: 50, price_per_ml: 5 / 60 });
  serve({ shots: 2 });
  const state = store.state();
  assert.equal(state.servings[0].alcohol_ml, 60); assert.equal(state.servings[0].price_cents, 1000);
  s = state.servings[1]; assert.equal(s.alcohol_ml, 15); assert.equal(s.shot_ml, 30); assert.equal(s.drink_name, 'Vodka'); assert.equal(s.ingredients[0].abv, 40);
});

test('mixed drinks count only ingredient alcohol and persist reproducible recipes', t => {
  const { store, spirit, serve } = fixture(t);
  const cranberry = store.saveDrink({ name: 'Cranberry', kind: 'mixer', abv: 0, price: 0 });
  const recipe = [{ drink_id: spirit.id, unit: 'shots', amount: 2 }, { drink_id: cranberry.id, unit: 'topup', amount: 0 }];
  serve({ custom: { name: 'Double Cran', price: 8, recipe, save_recipe: true } });
  const s = store.state().servings[0];
  assert.equal(s.alcohol_ml, 24); assert.equal(s.price_cents, 800); assert.equal(s.ingredients[1].ml, null);
  const saved = store.state().drinks.find(d => d.kind === 'cocktail'); assert.deepEqual(saved.recipe, recipe);
  serve({ drink_id: saved.id }); assert.equal(store.state().servings[0].alcohol_ml, 24);
});

test('markup applies once to every drink type, rounds only the final total, and preserves history', t => {
  const { store, party, spirit, serve } = fixture(t);
  store.saveParty({ ...party, markup_percent: 25 });
  store.saveDrink({ id: spirit.id, name: 'Vodka', kind: 'spirit', abv: 40, price_per_ml: .025 });
  serve({ shots: .25 });
  assert.equal(store.state().servings[0].price_cents, 23); // 18.75 cents × 1.25, not 19 × 1.25
  const beer = store.saveDrink({ name: 'Beer', kind: 'premade', abv: 5, volume_ml: 355, price: 4 });
  serve({ drink_id: beer.id });
  assert.equal(store.state().servings[0].price_cents, 500);
  serve({ custom: { name: 'Saved Mix', price: 8, save_recipe: true, recipe: [{ drink_id: spirit.id, unit: 'shots', amount: 2 }] } });
  assert.equal(store.state().servings[0].price_cents, 1000);
  const cocktail = store.state().drinks.find(d => d.kind === 'cocktail');
  assert.equal(cocktail.price_cents, 800);
  serve({ drink_id: cocktail.id });
  assert.equal(store.state().servings[0].price_cents, 1000);
  assert.equal(store.state().servings[0].base_price_cents, 800);
  assert.equal(store.state().servings[0].markup_percent, 25);
  store.saveParty({ ...party, markup_percent: 50 });
  serve({ drink_id: cocktail.id });
  assert.equal(store.state().servings[0].price_cents, 1200);
  assert.equal(store.state().servings[1].price_cents, 1000);
  assert.throws(() => store.saveParty({ ...party, markup_percent: -1 }), /Markup/);
});

test('fractional-cent mL rates retain precision and follow measuring-shot changes', t => {
  const { store, party, spirit, serve } = fixture(t);
  store.saveDrink({ id: spirit.id, name: 'Vodka', kind: 'spirit', abv: 40, price_per_ml: .025 });
  assert.equal(store.state().drinks[0].price_per_ml, .025);
  serve({ shots: .25 });
  assert.equal(store.state().servings[0].price_cents, 19);
  store.saveParty({ ...party, shot_ml: 60 });
  serve({ shots: .25 });
  assert.equal(store.state().servings[0].price_cents, 38);
  assert.equal(store.state().servings[1].price_cents, 19);
  assert.throws(() => store.saveDrink({ name: 'Bad', kind: 'spirit', abv: 40, price_per_ml: -1 }));
  assert.throws(() => store.saveDrink({ name: 'Old client', kind: 'spirit', abv: 40, price: 5 }));
});

test('legacy spirit prices migrate once without altering serving snapshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pour-migration-')), path = join(dir, 'test.sqlite');
  let store = createStore(path);
  try {
    const p = store.saveParty({ name: 'Legacy', shot_ml: 50, reference_ml: 30, reference_abv: 40 });
    const g = store.saveGuest({ name: 'Guest' });
    const d = store.saveDrink({ name: 'Spirit', kind: 'spirit', abv: 40, price_per_ml: .1 });
    store.submit({ request_id: 'legacy-pour', party_id: p.id, guest_id: g.id, drink_id: d.id, shots: 1 });
    store.db.exec("UPDATE drinks SET price_cents=500; ALTER TABLE drinks DROP COLUMN price_per_ml;");
    store.close(); store = createStore(path);
    assert.equal(store.state().drinks[0].price_per_ml, .1);
    assert.equal(store.state().servings[0].price_cents, 500);
    store.saveParty({ ...p, shot_ml: 25 });
    store.close(); store = createStore(path);
    assert.equal(store.state().drinks[0].price_per_ml, .1);
  } finally { store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); }
});

test('proof-equivalent strengths and premade serving volumes compare correctly', t => {
  const { store, serve } = fixture(t);
  const strong = store.saveDrink({ name: '100 Proof', kind: 'spirit', abv: 50, price_per_ml: 1 / 30 });
  const weak = store.saveDrink({ name: '50 Proof', kind: 'spirit', abv: 25, price_per_ml: 1 / 30 });
  const beer = store.saveDrink({ name: 'Beer', kind: 'premade', abv: 5, volume_ml: 355, price: 4 });
  serve({ drink_id: strong.id, shots: 1 }); serve({ drink_id: weak.id, shots: 2 }); serve({ drink_id: beer.id });
  const rows = store.state().servings;
  assert.equal(rows[0].alcohol_ml, 17.75); assert.equal(rows[1].alcohol_ml, rows[2].alcohol_ml);
});

test('names normalize case/spacing and two-name collision resolution is atomic', t => {
  const { store, guest } = fixture(t);
  assert.equal(guest.name, 'Bob A');
  assert.throws(() => store.saveGuest({ name: '  BOB   a  ' }), e => e.status === 409 && e.details.guest.id === guest.id);
  const other = store.saveGuest({ name: 'Alice' });
  assert.throws(() => store.saveGuest({ name: 'ALICE', rename_existing_id: guest.id, existing_name: 'Bob AA' }));
  assert.equal(store.state().guests.find(g => g.id === guest.id).name, 'Bob A');
  const newGuest = store.saveGuest({ name: 'bob ab', rename_existing_id: guest.id, existing_name: 'bob aa' });
  assert.equal(newGuest.name, 'Bob Ab'); assert.equal(store.state().guests.find(g => g.id === guest.id).name, 'Bob Aa');
  assert.throws(() => store.saveGuest({ id: other.id, name: 'BOB AB' }));
});

test('submission retry is idempotent and corrections support undo/redo branches', t => {
  const { store, party, serve } = fixture(t);
  const a = serve({ request_id: 'same-request' }); serve({ request_id: 'same-request' });
  assert.equal(store.state().servings.length, 1);
  store.history(party.id, 'undo'); assert.equal(store.state().servings[0].status, 'void');
  store.history(party.id, 'redo'); assert.equal(store.state().servings[0].status, 'active');
  store.voidServing(a.id); assert.equal(store.state().servings[0].status, 'void');
  store.history(party.id, 'undo'); assert.equal(store.state().servings[0].status, 'active');
  serve(); assert.throws(() => store.history(party.id, 'redo'), /Nothing to redo/);
  store.deleteServing(a.id); assert.equal(store.state().servings.length, 1);
  store.history(party.id, 'undo'); assert.equal(store.state().servings[0].status, 'void');
});

test('history is isolated between parties and redo restores chronological actions', t => {
  const { store, party, serve } = fixture(t);
  const second = store.saveParty({ name: 'next night', shot_ml: 45, reference_ml: 30, reference_abv: 40 });
  serve(); serve(); serve({ party_id: second.id });
  store.history(party.id, 'undo'); store.history(party.id, 'undo');
  assert.equal(store.state().servings.filter(s => s.party_id === party.id && s.status === 'active').length, 0);
  assert.equal(store.state().servings.find(s => s.party_id === second.id).status, 'active');
  store.history(party.id, 'redo'); store.history(party.id, 'redo');
  assert.equal(store.state().servings.filter(s => s.status === 'active').length, 3);
});

test('invalid recipes and volumes are rejected without partially saving servings', t => {
  const { store, spirit, serve } = fixture(t);
  assert.throws(() => serve({ shots: .3 }), /quarter-shot/);
  assert.throws(() => serve({ shots: -1 }));
  assert.throws(() => serve({ custom: { name: 'Bad', price: 3, recipe: [{ drink_id: spirit.id, unit: 'topup' }] } }), /measured amount/);
  assert.equal(store.state().servings.length, 0);
  store.archiveDrink(spirit.id, true); assert.throws(() => serve(), /no longer available/);
});

test('SQLite persists guests, history, recipes, and servings across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pour-test-')), path = join(dir, 'test.sqlite');
  let store = createStore(path);
  try {
    const p = store.saveParty({ name: 'Party', shot_ml: 30, reference_ml: 30, reference_abv: 40 });
    const g = store.saveGuest({ name: 'Guest' });
    const d = store.saveDrink({ name: 'Drink', kind: 'spirit', abv: 40, price_per_ml: 5 / 30 });
    store.submit({ request_id: 'persist-request', party_id: p.id, guest_id: g.id, drink_id: d.id, shots: 2 });
    store.close(); store = createStore(path);
    assert.equal(store.state().servings[0].alcohol_ml, 24); assert.equal(store.state().guests[0].id, g.id);
    store.history(p.id, 'undo'); assert.equal(store.state().servings[0].status, 'void');
  } finally { store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); }
});
