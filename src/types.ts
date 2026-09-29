export type Party = { id: string; name: string; shot_ml: number; reference_ml: number; reference_abv: number; markup_percent: number; created_at: string };
export type Guest = { id: string; name: string; color: string };
export type Ingredient = { drink_id: string; unit: 'shots' | 'ml' | 'topup'; amount: number };
export type Drink = { id: string; name: string; kind: 'spirit' | 'mixer' | 'premade' | 'cocktail'; abv: number; volume_ml: number; price_cents: number; price_per_ml: number; recipe: Ingredient[]; archived: number };
export type Serving = { id: string; sequence: number; party_id: string; guest_id: string; drink_name: string; quantity_label: string; ingredients: (Ingredient & { name: string; abv: number; ml: number | null; alcohol_ml: number })[]; alcohol_ml: number; price_cents: number; base_price_cents: number; markup_percent: number; shot_ml: number; status: 'active' | 'void'; created_at: string };
export type State = { parties: Party[]; guests: Guest[]; drinks: Drink[]; servings: Serving[]; history: { party_id: string; undo_count: number; redo_count: number }[] };
export type Mix = { name: string; price: number; recipe: Ingredient[]; save_recipe: boolean };
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const decimal = (n: number) => Number(n.toFixed(2)).toString();
export const score = (ml: number, p: Party) => ml / (p.reference_ml * p.reference_abv / 100);
export const emptyState: State = { parties: [], guests: [], drinks: [], servings: [], history: [] };
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { details: data });
  return data;
}

export const rateMoney = (usd: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(usd);
