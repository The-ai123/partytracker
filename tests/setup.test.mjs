import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';

function fixture(t) {
  const source = createStore(), target = createStore();
  t.after(() => { source.close(); target.close(); });
  const p = source.saveParty({ name: 'Garden Party', shot_ml: 30, reference_ml: 40, reference_abv: 45, markup_percent: 35 });
  const g = source.saveGuest({ name: 'Bob' });
  const spirit = source.saveDrink({ name: 'Vodka', kind: 'spirit', abv: 40, price_per_ml: .025 });
  const mixer = source.saveDrink({ name: 'Juice', kind: 'mixer', abv: 0, price: 0 });
  const cocktail = source.saveDrink({ name: 'Mix', kind: 'cocktail', price: 8, recipe: [{ drink_id: spirit.id, unit: 'shots', amount: 1.25 }, { drink_id: mixer.id, unit: 'topup', amount: 0 }] });
  source.submit({ request_id: 'export-source-serving', party_id: p.id, guest_id: g.id, drink_id: cocktail.id });
  source.archiveDrink(mixer.id, true);
  return { source, target, p, g, spirit, mixer, cocktail, file: JSON.parse(JSON.stringify(source.exportSetup(p.id))) };
}

test('setup export round-trips UUIDs, colors, rates, archived ingredients and recipes without history', t => {
  const { source, target, file, p } = fixture(t);
  assert.equal(file.servings, undefined); assert.equal(file.history, undefined);
  const preview = target.importSetup(file, { create_party: true, preview: true });
  assert.equal(preview.guests_added, 1); assert.equal(preview.drinks_added, 3);
  assert.equal(target.state().parties.length, 0); assert.equal(target.state().drinks.length, 0);
  const result = target.importSetup(file, { create_party: true, party_name: 'Imported Night' });
  assert.notEqual(result.party_id, p.id);
  const state = target.state();
  assert.equal(state.servings.length, 0); assert.equal(state.history.length, 0);
  assert.equal(state.parties[0].shot_ml, 30); assert.equal(state.parties[0].reference_abv, 45);
  assert.equal(state.parties[0].markup_percent, 35);
  assert.equal(state.parties[0].name, 'Imported Night');
  assert.deepEqual(target.exportSetup(result.party_id).drinks, source.exportSetup(p.id).drinks);
  assert.deepEqual(JSON.parse(JSON.stringify(target.exportSetup(result.party_id).guests)), file.guests);
});

test('merge keeps existing guests and menu data; repeat imports do not duplicate them', t => {
  const { source, file, p, g, spirit } = fixture(t);
  source.saveDrink({ id: spirit.id, name: 'Updated Vodka', kind: 'spirit', abv: 50, price_per_ml: .07 });
  const before = source.state();
  const result = source.importSetup(file, { create_party: false });
  assert.equal(result.guests_added, 0); assert.equal(result.drinks_added, 0);
  assert.deepEqual(source.state(), before);
  assert.equal(source.state().guests[0].id, g.id);
  assert.equal(source.state().parties[0].id, p.id);
});

test('same-name guests keep local identity while new drinks import', t => {
  const { target, file } = fixture(t);
  const local = target.saveGuest({ name: 'bOB' });
  const result = target.importSetup(file, { create_party: false });
  assert.equal(result.guests_kept, 1); assert.equal(target.state().guests[0].id, local.id);
  assert.equal(target.state().drinks.length, 3);
});

test('older setup exports default to zero markup', t => {
  const { target, file } = fixture(t);
  delete file.settings.markup_percent;
  target.importSetup(file, { create_party: true });
  assert.equal(target.state().parties[0].markup_percent, 0);
});

test('invalid imports and ingredient conflicts leave all data untouched', t => {
  const { target, file, spirit } = fixture(t);
  const before = target.state();
  for (const bad of [null, {}, { ...file, version: 99 }, { ...file, settings: null }]) {
    assert.throws(() => target.importSetup(bad, { create_party: true }));
    assert.deepEqual(target.state(), before);
  }
  const badRecipe = structuredClone(file);
  badRecipe.drinks.find(d => d.kind === 'cocktail').recipe[0].drink_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.throws(() => target.importSetup(badRecipe, { create_party: true }), /missing or invalid/);
  const badRate = structuredClone(file); badRate.drinks[0].price_per_ml = -1;
  assert.throws(() => target.importSetup(badRate, { create_party: true }), /price per mL/);
  assert.deepEqual(target.state(), before);
  target.importSetup(file, { create_party: false });
  target.db.prepare('DELETE FROM drinks WHERE kind=?').run('cocktail');
  target.saveDrink({ id: spirit.id, name: 'Now Beer', kind: 'premade', abv: 5, volume_ml: 355, price: 4 });
  const withConflict = target.state();
  assert.throws(() => target.importSetup(file, { create_party: true }), /conflicts/);
  assert.deepEqual(target.state(), withConflict);
});
