import { Timetable } from './Admin.jsx';

// Emploi du temps modifiable par les parents (et l'admin)
export default function Edt() {
  return (
    <div className="page">
      <h1 className="h1">Emploi du temps</h1>
      <div className="section"><Timetable /></div>
    </div>
  );
}
