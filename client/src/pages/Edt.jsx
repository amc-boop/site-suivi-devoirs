import { useState } from 'react';
import { Camera } from 'lucide-react';
import { Timetable } from './Admin.jsx';
import TimetableImport from '../TimetableImport.jsx';

// Emploi du temps : import en photo ou saisie à la main
export default function Edt() {
  const [importing, setImporting] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div className="page">
      <h1 className="h1">Emploi du temps</h1>
      <button className="btn big block section" onClick={() => setImporting(true)}><Camera size={22} /> Importer depuis une photo</button>
      <div className="section"><Timetable key={key} /></div>
      {importing && <TimetableImport hasExisting onClose={() => setImporting(false)} onSaved={() => setKey((k) => k + 1)} />}
    </div>
  );
}
