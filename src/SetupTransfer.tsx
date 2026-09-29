import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { api, decimal } from './types';

type Summary = {
  guests_added: number; guests_kept: number; drinks_added: number; drinks_kept: number;
  settings: { name: string; shot_ml: number; reference_ml: number; reference_abv: number; markup_percent: number };
  create_party: boolean; party_id?: string | null;
};

export function SetupTransfer({ partyId, imported }: { partyId?: string; imported: (id?: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return <div className="setup-transfer">
    <a className="secondary" href={`/api/setup/export${partyId ? `?party=${encodeURIComponent(partyId)}` : ''}`}><Download size={17} />Export Setup</a>
    <button className="secondary" onClick={() => setOpen(true)}><Upload size={17} />Import Setup</button>
    {open && <ImportDialog hasParty={!!partyId} close={() => setOpen(false)} imported={imported} />}
  </div>;
}

function ImportDialog({ hasParty, close, imported }: { hasParty: boolean; close: () => void; imported: (id?: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [setup, setSetup] = useState<unknown>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [createParty, setCreateParty] = useState(true), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function preview(file: unknown, partyName = name) {
    const result = await api<Summary>('setup/preview', { setup: file, create_party: createParty, party_name: partyName });
    setSummary(result); setName(result.settings.name);
  }
  return <dialog ref={dialog} aria-labelledby="import-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="modal-heading"><div><h2 id="import-title">Import your setup</h2><p>Bring your menu, recipes, and guests to this bar.</p></div><button className="icon-button" aria-label="Close import" disabled={busy} onClick={close}><X /></button></div>
    <p>Existing guests and drinks are kept. Matching drink UUIDs and matching guest UUIDs or names are skipped. No serving history or tabs are imported.</p>
    <label>Pour setup file (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; setSetup(undefined); setSummary(null); setError(''); setName('');
      if (!file) return;
      if (file.size > 4500000) { setError('Choose a setup file smaller than 4.5 MB.'); return; }
      setBusy(true);
      try { const parsed: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); await preview(parsed, ''); setSetup(parsed); }
      catch (e: unknown) { setError(e instanceof SyntaxError ? 'This file is not valid JSON. Choose an exported Pour setup file.' : e instanceof Error ? e.message : 'Could not read this file.'); }
      finally { setBusy(false); }
    }} /></label>
    <label className="checkbox"><input type="checkbox" checked={createParty} disabled={busy || !hasParty} onChange={e => { setCreateParty(e.target.checked); setSummary(null); }} />Create a new party using the file’s shot and reference settings</label>
    {createParty && <label>New party name<input value={name} disabled={busy} maxLength={80} onChange={e => { setName(e.target.value); setSummary(null); }} placeholder="Uses the exported party name" /></label>}
    {!createParty && <p className="form-note">Only guests and drinks will be added. Current party settings stay unchanged.</p>}
    {summary && <div className="import-preview" aria-live="polite"><h3>Ready to import</h3><dl>
      <dt>Guests</dt><dd>{summary.guests_added} added · {summary.guests_kept} existing kept</dd>
      <dt>Drinks & mixers</dt><dd>{summary.drinks_added} added · {summary.drinks_kept} existing kept</dd>
      {summary.create_party && <><dt>New party</dt><dd>{summary.settings.name}</dd><dt>Drink markup</dt><dd>{decimal(summary.settings.markup_percent)}%</dd><dt>Measuring shot</dt><dd>{decimal(summary.settings.shot_ml)} mL</dd><dt>Score reference</dt><dd>{decimal(summary.settings.reference_ml)} mL at {decimal(summary.settings.reference_abv)}% ABV</dd></>}
    </dl><p>Archived drinks are included. Existing serving history and tabs stay intact.</p></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="secondary" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy || setup === undefined} onClick={async () => {
      setBusy(true); setError('');
      try {
        if (!summary) await preview(setup);
        else { const result = await api<Summary>('setup/import', { setup, create_party: createParty, party_name: name }); await imported(result.party_id || undefined); close(); }
      } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Import failed.'); }
      finally { setBusy(false); }
    }}>{busy ? 'Working…' : summary ? 'Import Setup' : 'Review Import'}<Upload size={17} /></button></div>
  </dialog>;
}
