import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomInt } from 'node:crypto';
import { validateSetup } from './setup.mjs';

export class AppError extends Error { constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details; } }
const requireValue = (condition, message) => { if (!condition) throw new AppError(message); };
const number = (value, label, min, max) => { const n = Number(value); requireValue(value !== '' && value != null && Number.isFinite(n) && n >= min && n <= max, `${label} must be between ${min} and ${max}.`); return n; };
const nameOf = value => { const name = String(value ?? '').trim().replace(/\s+/gu, ' '); requireValue(name.length > 0 && name.length <= 80, 'Enter a name of 1–80 characters.'); return name.toLocaleLowerCase('en-US').replace(/(^|\s)(\p{L})/gu, (_, gap, char) => gap + char.toLocaleUpperCase('en-US')); };
const keyOf = name => name.toLocaleLowerCase('en-US');
const cents = value => Math.round(number(value, 'Price', 0, 10000) * 100);
const quarter = value => { const n = number(value, 'Shots', .25, 20); requireValue(Number.isInteger(n * 4), 'Use quarter-shot increments.'); return n; };
const palette = ['#6cc4a1', '#e6ad73', '#ac9ce4', '#73b7db', '#df90a5', '#b9c970', '#d892cd', '#71c8c8', '#daa16e', '#8ba9e8'];

export function createStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS parties (id TEXT PRIMARY KEY, name TEXT NOT NULL, shot_ml REAL NOT NULL, reference_ml REAL NOT NULL, reference_abv REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drinks (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, abv REAL NOT NULL, volume_ml REAL NOT NULL, price_cents INTEGER NOT NULL, recipe_json TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS servings (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, party_id TEXT NOT NULL REFERENCES parties(id), guest_id TEXT NOT NULL REFERENCES guests(id), drink_name TEXT NOT NULL, quantity_label TEXT NOT NULL, ingredients_json TEXT NOT NULL, alcohol_ml REAL NOT NULL, price_cents INTEGER NOT NULL, shot_ml REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, party_id TEXT NOT NULL REFERENCES parties(id), serving_id TEXT NOT NULL REFERENCES servings(id) ON DELETE CASCADE, before_status TEXT NOT NULL, after_status TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS servings_party ON servings(party_id, created_at);
  `);
  // Preserve existing per-shot menu prices by converting them once, using the
  // newest party's measuring shot (or the original default on an empty install).
  if (!db.prepare('PRAGMA table_info(drinks)').all().some(c => c.name === 'price_per_ml')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE drinks ADD COLUMN price_per_ml REAL NOT NULL DEFAULT 0');
      db.exec(`UPDATE drinks SET price_per_ml = price_cents / 100.0 /
        COALESCE((SELECT shot_ml FROM parties ORDER BY created_at DESC, rowid DESC LIMIT 1), 44.36)
        WHERE kind='spirit'`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (!db.prepare('PRAGMA table_info(parties)').all().some(c => c.name === 'markup_percent')) db.exec('ALTER TABLE parties ADD COLUMN markup_percent REAL NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(servings)').all().some(c => c.name === 'base_price_cents')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE servings ADD COLUMN base_price_cents REAL NOT NULL DEFAULT 0; ALTER TABLE servings ADD COLUMN markup_percent REAL NOT NULL DEFAULT 0; UPDATE servings SET base_price_cents=price_cents;');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const party = id => { const p = get('SELECT * FROM parties WHERE id=?', id); if (!p) throw new AppError('Party not found.', 404); return p; };
  const drink = id => { const d = get('SELECT * FROM drinks WHERE id=?', id); if (!d || d.archived) throw new AppError('That drink is no longer available.'); return d; };
  const ingredients = value => {
    requireValue(Array.isArray(value) && value.length > 0 && value.length <= 30, 'Add 1–30 ingredients.');
    return value.map(row => {
      const d = drink(String(row.drink_id));
      requireValue(d.kind === 'spirit' || d.kind === 'mixer', 'Recipes use spirits and mixers.');
      const unit = row.unit;
      requireValue(['shots', 'ml', 'topup'].includes(unit), 'Choose shots, mL, or top up.');
      requireValue(unit !== 'topup' || d.abv === 0, 'Alcoholic ingredients need a measured amount.');
      return { drink_id: d.id, unit, amount: unit === 'topup' ? 0 : unit === 'shots' ? quarter(row.amount) : number(row.amount, 'Ingredient mL', .1, 5000) };
    });
  };
  const recordAction = (p, s, before, after) => { run('DELETE FROM actions WHERE party_id=? AND undone=1', p); run('INSERT INTO actions(party_id,serving_id,before_status,after_status) VALUES(?,?,?,?)', p, s, before, after); };
  return {
    db,
    exportSetup(partyId) {
      const p = partyId ? party(partyId) : get('SELECT * FROM parties ORDER BY created_at DESC LIMIT 1');
      return {
        format: 'pour-setup', version: 1, exported_at: new Date().toISOString(),
        settings: p ? { name: p.name, shot_ml: p.shot_ml, reference_ml: p.reference_ml, reference_abv: p.reference_abv, markup_percent: p.markup_percent } : { name: 'Imported Party', shot_ml: 44.36, reference_ml: 44.36, reference_abv: 40, markup_percent: 0 },
        guests: all('SELECT id,name,color FROM guests ORDER BY name'),
        drinks: all('SELECT * FROM drinks').map(({ recipe_json, ...d }) => ({ ...d, recipe: JSON.parse(recipe_json) })),
      };
    },
    importSetup(file, options = {}) { return transaction(() => {
      const setup = validateSetup(file);
      requireValue(typeof options.create_party === 'boolean', 'Choose whether to create a new party.');
      const partyName = nameOf(options.party_name || setup.settings.name);
      const guests = setup.guests.filter(g => !get('SELECT id FROM guests WHERE id=? OR name_key=?', g.id, keyOf(g.name)));
      const drinks = setup.drinks.filter(d => !get('SELECT id FROM drinks WHERE id=?', d.id));
      // Existing entries win; validate recipes against what will actually exist.
      const combined = new Map([...setup.drinks, ...all('SELECT * FROM drinks')].map(d => [d.id, d]));
      for (const d of drinks) for (const r of d.recipe) {
        const ingredient = combined.get(r.drink_id);
        requireValue(ingredient && ['spirit', 'mixer'].includes(ingredient.kind) && (r.unit !== 'topup' || ingredient.abv === 0), 'An existing ingredient conflicts with an imported recipe. No changes were made.');
      }
      const summary = {
        guests_added: guests.length, guests_kept: setup.guests.length - guests.length,
        drinks_added: drinks.length, drinks_kept: setup.drinks.length - drinks.length,
        settings: { ...setup.settings, name: partyName }, create_party: options.create_party,
      };
      if (options.preview) return summary;
      for (const g of guests) run('INSERT INTO guests VALUES(?,?,?,?,?)', g.id, g.name, keyOf(g.name), g.color, new Date().toISOString());
      for (const d of drinks) run('INSERT INTO drinks(id,name,kind,abv,volume_ml,price_cents,price_per_ml,recipe_json,archived) VALUES(?,?,?,?,?,?,?,?,?)', d.id, d.name, d.kind, d.abv, d.volume_ml, d.price_cents, d.price_per_ml, JSON.stringify(d.recipe), d.archived);
      const p = options.create_party ? this.saveParty({ ...setup.settings, name: partyName }) : null;
      return { ...summary, party_id: p?.id || null };
    }); },
    state() {
      return { parties: all('SELECT * FROM parties ORDER BY created_at DESC'), guests: all('SELECT * FROM guests ORDER BY name'), drinks: all('SELECT * FROM drinks').map(d => ({ ...d, recipe: JSON.parse(d.recipe_json), recipe_json: undefined })), servings: all('SELECT rowid AS sequence,* FROM servings ORDER BY rowid DESC').map(s => ({ ...s, ingredients: JSON.parse(s.ingredients_json), ingredients_json: undefined })), history: all('SELECT party_id, SUM(undone=0) AS undo_count, SUM(undone=1) AS redo_count FROM actions GROUP BY party_id') };
    },
    saveParty(body) {
      const id = body.id || randomUUID();
      const p = { id, name: nameOf(body.name), shot_ml: number(body.shot_ml, 'Shot size', 1, 500), reference_ml: number(body.reference_ml, 'Reference shot size', 1, 500), reference_abv: number(body.reference_abv, 'Reference ABV', .1, 100), markup_percent: number(body.markup_percent ?? (body.id ? party(id).markup_percent : 0), 'Markup percentage', 0, 10000) };
      if (body.id) party(id);
      run('INSERT INTO parties(id,name,shot_ml,reference_ml,reference_abv,created_at,markup_percent) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,shot_ml=excluded.shot_ml,reference_ml=excluded.reference_ml,reference_abv=excluded.reference_abv,markup_percent=excluded.markup_percent', id, p.name, p.shot_ml, p.reference_ml, p.reference_abv, new Date().toISOString(), p.markup_percent);
      return p;
    },
    saveGuest(body) { return transaction(() => {
      const name = nameOf(body.name), key = keyOf(name), id = body.id || randomUUID();
      if (body.id) requireValue(get('SELECT id FROM guests WHERE id=?', id), 'Guest not found.');
      if (body.rename_existing_id) {
        const existing = get('SELECT * FROM guests WHERE id=?', String(body.rename_existing_id));
        requireValue(existing && !body.id, 'Existing guest not found.');
        const renamed = nameOf(body.existing_name), renamedKey = keyOf(renamed);
        requireValue(renamedKey !== key, 'Give the two guests different names.');
        requireValue(!get('SELECT id FROM guests WHERE name_key=? AND id<>?', renamedKey, existing.id), 'The existing guest’s new name is already in use.');
        run('UPDATE guests SET name=?,name_key=? WHERE id=?', renamed, renamedKey, existing.id);
      }
      const existing = get('SELECT * FROM guests WHERE name_key=? AND id<>?', key, id);
      if (existing) throw new AppError('This name already exists.', 409, { guest: existing });
      if (body.id) run('UPDATE guests SET name=?,name_key=? WHERE id=?', name, key, id);
      else run('INSERT INTO guests VALUES(?,?,?,?,?)', id, name, key, palette[randomInt(palette.length)], new Date().toISOString());
      return get('SELECT * FROM guests WHERE id=?', id);
    }); },
    saveDrink(body) {
      const id = body.id || randomUUID(), kind = body.kind;
      requireValue(['spirit', 'mixer', 'premade', 'cocktail'].includes(kind), 'Choose a drink type.');
      if (body.id) requireValue(get('SELECT id FROM drinks WHERE id=?', id), 'Drink not found.');
      const recipe = kind === 'cocktail' ? ingredients(body.recipe) : [];
      const abv = kind === 'cocktail' ? 0 : number(body.abv, 'ABV', 0, 100);
      requireValue(kind !== 'mixer' || abv === 0, 'Use the spirit type for alcoholic ingredients.');
      const volume = kind === 'premade' ? number(body.volume_ml, 'Serving volume', 1, 10000) : 0;
      const rate = kind === 'spirit' ? number(body.price_per_ml, 'Price per mL', 0, 10000) : 0;
      run('INSERT INTO drinks(id,name,kind,abv,volume_ml,price_cents,recipe_json,price_per_ml,archived) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,abv=excluded.abv,volume_ml=excluded.volume_ml,price_cents=excluded.price_cents,recipe_json=excluded.recipe_json,price_per_ml=excluded.price_per_ml', id, nameOf(body.name), kind, abv, volume, kind === 'spirit' ? 0 : cents(body.price), JSON.stringify(recipe), rate);
      return { id };
    },
    archiveDrink(id, archived) { requireValue(get('SELECT id FROM drinks WHERE id=?', id), 'Drink not found.'); run('UPDATE drinks SET archived=? WHERE id=?', archived ? 1 : 0, id); },
    submit(body) { return transaction(() => {
      requireValue(typeof body.request_id === 'string' && body.request_id.length >= 8 && body.request_id.length <= 100, 'Missing submission identifier.');
      const previous = get('SELECT * FROM servings WHERE request_id=?', body.request_id);
      if (previous) return { id: previous.id, duplicate: true };
      const p = party(String(body.party_id));
      requireValue(get('SELECT id FROM guests WHERE id=?', String(body.guest_id)), 'Choose a guest.');
      let rows, drinkName, price, quantityLabel;
      if (body.custom) {
        rows = ingredients(body.custom.recipe); drinkName = nameOf(body.custom.name || 'Custom Mix'); price = cents(body.custom.price); quantityLabel = '1 mixed drink';
      } else {
        const d = drink(String(body.drink_id)); drinkName = d.name;
        if (d.kind === 'spirit') { const shots = quarter(body.shots); rows = [{ drink_id: d.id, unit: 'shots', amount: shots }]; price = d.price_per_ml * shots * p.shot_ml * 100; quantityLabel = `${shots} shot${shots === 1 ? '' : 's'}`; }
        else if (d.kind === 'cocktail') { rows = ingredients(JSON.parse(d.recipe_json)); price = d.price_cents; quantityLabel = '1 mixed drink'; }
        else { requireValue(d.kind === 'premade', 'Mixers are used in the drink builder.'); rows = [{ drink_id: d.id, unit: 'ml', amount: d.volume_ml }]; price = d.price_cents; quantityLabel = `${d.volume_ml} mL`; }
      }
      const basePrice = price;
      price = Math.round(basePrice * (1 + p.markup_percent / 100));
      const snapshot = rows.map(row => { const d = drink(row.drink_id); const ml = row.unit === 'topup' ? null : row.amount * (row.unit === 'shots' ? p.shot_ml : 1); return { ...row, name: d.name, abv: d.abv, ml, alcohol_ml: ml === null ? 0 : ml * d.abv / 100 }; });
      const alcohol = snapshot.reduce((sum, row) => sum + row.alcohol_ml, 0), id = randomUUID();
      run('INSERT INTO servings(id,request_id,party_id,guest_id,drink_name,quantity_label,ingredients_json,alcohol_ml,price_cents,shot_ml,status,created_at,base_price_cents,markup_percent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, body.request_id, p.id, body.guest_id, drinkName, quantityLabel, JSON.stringify(snapshot), alcohol, price, p.shot_ml, 'active', new Date().toISOString(), basePrice, p.markup_percent);
      recordAction(p.id, id, 'void', 'active');
      if (body.custom?.save_recipe) this.saveDrink({ name: drinkName, kind: 'cocktail', price: basePrice / 100, recipe: rows });
      return { id };
    }); },
    voidServing(id) { return transaction(() => { const s = get('SELECT * FROM servings WHERE id=?', id); requireValue(s && s.status === 'active', 'This serving is already void or missing.'); run("UPDATE servings SET status='void' WHERE id=?", id); recordAction(s.party_id, id, 'active', 'void'); }); },
    deleteServing(id) { requireValue(get('SELECT id FROM servings WHERE id=?', id), 'Serving not found.'); run('DELETE FROM servings WHERE id=?', id); },
    history(partyId, direction) { return transaction(() => {
      party(partyId); requireValue(direction === 'undo' || direction === 'redo', 'Unknown history action.');
      const redo = direction === 'redo';
      const a = get(`SELECT * FROM actions WHERE party_id=? AND undone=? ORDER BY id ${redo ? 'ASC' : 'DESC'} LIMIT 1`, partyId, redo ? 1 : 0);
      requireValue(a, `Nothing to ${direction}.`);
      run('UPDATE servings SET status=? WHERE id=?', redo ? a.after_status : a.before_status, a.serving_id);
      run('UPDATE actions SET undone=? WHERE id=?', redo ? 0 : 1, a.id);
    }); },
    close() { db.close(); }
  };
}
