// Isolated demo database for browser verification; never touches data/.
import { mkdirSync } from 'node:fs';
import { createStore } from '../server/store.mjs';
mkdirSync('.local/preview', { recursive: true });
const s = createStore('.local/preview/partytracker.sqlite');
if (!s.state().parties.length) {
  const p = s.saveParty({ name: 'Saturday Social', shot_ml: 44.36, reference_ml: 44.36, reference_abv: 40 });
  const guests = ['Alex Morgan', 'Jamie Chen', 'Sam Rivera', 'Taylor James', 'Jordan Lee', 'Casey Brooks', 'Riley Park', 'Morgan Reed', 'Drew Carter', 'Avery Woods', 'Quinn Ellis', 'Charlie Gray', 'Blake Young', 'Skyler Bell', 'Rowan Hayes', 'Cameron Fox', 'Dakota Lane', 'Emerson West', 'Finley Stone', 'Parker Rose', 'Reese Dean', 'Sage Cole', 'Bob A', 'Robin Lake'].map(name => s.saveGuest({ name }));
  const vodka = s.saveDrink({ name: 'Tito’s Vodka', kind: 'spirit', abv: 40, price_per_ml: 5 / 44.36 });
  const gin = s.saveDrink({ name: 'Hendrick’s Gin', kind: 'spirit', abv: 44, price_per_ml: 6 / 44.36 });
  s.saveDrink({ name: 'Espolòn Tequila', kind: 'spirit', abv: 40, price_per_ml: 5 / 44.36 });
  s.saveDrink({ name: 'Bulleit Bourbon', kind: 'spirit', abv: 45, price_per_ml: 6 / 44.36 });
  const cranberry = s.saveDrink({ name: 'Cranberry Juice', kind: 'mixer', abv: 0, price: 0 });
  const tonic = s.saveDrink({ name: 'Tonic', kind: 'mixer', abv: 0, price: 0 });
  const cocktail = s.saveDrink({ name: 'Vodka Cranberry', kind: 'cocktail', price: 8, recipe: [{ drink_id: vodka.id, unit: 'shots', amount: 2 }, { drink_id: cranberry.id, unit: 'topup', amount: 0 }] });
  s.saveDrink({ name: 'Gin & Tonic', kind: 'cocktail', price: 8, recipe: [{ drink_id: gin.id, unit: 'shots', amount: 1.5 }, { drink_id: tonic.id, unit: 'ml', amount: 120 }] });
  const beer = s.saveDrink({ name: 'Sierra Nevada', kind: 'premade', abv: 5.6, volume_ml: 355, price: 4 });
  s.saveDrink({ name: 'Stella Artois', kind: 'premade', abv: 5, volume_ml: 330, price: 4 });
  s.saveDrink({ name: 'Sparkling Water', kind: 'premade', abv: 0, volume_ml: 355, price: 1 });
  for (let i = 0; i < 15; i++) s.submit({ request_id: `preview-serving-${i}`, party_id: p.id, guest_id: guests[i % 7].id, drink_id: [vodka.id, cocktail.id, beer.id][i % 3], shots: 1 });
}
s.close();
