import { AppError } from './store.mjs';

const check = (ok, message) => { if (!ok) throw new AppError(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const numeric = (value, min, max, label) => {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `Invalid ${label} in setup file.`);
  return value;
};
const name = value => {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80, 'Invalid name in setup file.');
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US').replace(/(^|\s)(\p{L})/gu, (_, gap, char) => gap + char.toLocaleUpperCase('en-US'));
};
const id = value => {
  check(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), 'Invalid UUID in setup file.');
  return value.toLowerCase();
};

export function validateSetup(file) {
  check(object(file) && file.format === 'pour-setup' && file.version === 1, 'Choose a Pour setup JSON file (version 1).');
  check(Array.isArray(file.guests) && file.guests.length <= 10000 && Array.isArray(file.drinks) && file.drinks.length <= 5000, 'Invalid guest or drink list in setup file.');
  check(object(file.settings), 'Missing party settings in setup file.');
  const settings = {
    name: name(file.settings.name),
    shot_ml: numeric(file.settings.shot_ml, 1, 500, 'shot size'),
    reference_ml: numeric(file.settings.reference_ml, 1, 500, 'reference volume'),
    reference_abv: numeric(file.settings.reference_abv, .1, 100, 'reference ABV'),
    markup_percent: numeric(file.settings.markup_percent === undefined ? 0 : file.settings.markup_percent, 0, 10000, 'markup percentage'),
  };
  const guests = file.guests.map(g => {
    check(object(g), 'Invalid guest in setup file.');
    check(typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color), 'Invalid guest color in setup file.');
    return { id: id(g.id), name: name(g.name), color: g.color };
  });
  check(new Set(guests.map(g => g.id)).size === guests.length && new Set(guests.map(g => g.name.toLowerCase())).size === guests.length, 'Setup file contains duplicate guests.');
  const drinks = file.drinks.map(d => {
    check(object(d) && ['spirit', 'mixer', 'premade', 'cocktail'].includes(d.kind), 'Invalid drink type in setup file.');
    check(d.archived === 0 || d.archived === 1, 'Invalid archived status in setup file.');
    const result = {
      id: id(d.id), name: name(d.name), kind: d.kind, archived: d.archived,
      abv: numeric(d.abv, 0, 100, 'ABV'),
      volume_ml: numeric(d.volume_ml, d.kind === 'premade' ? 1 : 0, 10000, 'serving volume'),
      price_cents: numeric(d.price_cents, 0, 1000000, 'serving price'),
      price_per_ml: numeric(d.price_per_ml, 0, 10000, 'price per mL'),
      recipe: [],
    };
    check(Number.isInteger(result.price_cents), 'Serving prices must be whole cents.');
    check(d.kind !== 'mixer' || d.abv === 0, 'Mixers must be non-alcoholic.');
    check(Array.isArray(d.recipe) && (d.kind === 'cocktail' ? d.recipe.length > 0 && d.recipe.length <= 30 : d.recipe.length === 0), 'Invalid cocktail recipe in setup file.');
    result.recipe = d.recipe.map(r => {
      check(object(r) && ['shots', 'ml', 'topup'].includes(r.unit), 'Invalid recipe ingredient.');
      const amount = numeric(r.amount, r.unit === 'topup' ? 0 : r.unit === 'shots' ? .25 : .1, r.unit === 'topup' ? 0 : r.unit === 'shots' ? 20 : 5000, 'ingredient amount');
      check(r.unit !== 'shots' || Number.isInteger(amount * 4), 'Recipe shots must use quarter increments.');
      return { drink_id: id(r.drink_id), unit: r.unit, amount };
    });
    return result;
  });
  check(new Set(drinks.map(d => d.id)).size === drinks.length, 'Setup file contains duplicate drink UUIDs.');
  const byId = new Map(drinks.map(d => [d.id, d]));
  for (const d of drinks) for (const r of d.recipe) {
    const ingredient = byId.get(r.drink_id);
    check(ingredient && ['spirit', 'mixer'].includes(ingredient.kind), 'A recipe references a missing or invalid ingredient.');
    check(r.unit !== 'topup' || ingredient.abv === 0, 'Alcoholic ingredients need a measured amount.');
  }
  return { settings, guests, drinks };
}
