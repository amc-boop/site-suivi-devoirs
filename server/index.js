// Serveur local : npm run dev (avec Vite) ou npm start (site déjà construit dans dist/)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, errorHandler } from './app.js';
import { geminiEnabled } from './gemini.js';
import { usingSupabaseDb } from './db.js';
import { usingSupabaseStorage } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API prête sur http://localhost:${PORT}`);
  console.log(`  base : ${usingSupabaseDb ? 'Supabase (DATABASE_URL)' : 'locale (data/pglite)'} · photos : ${usingSupabaseStorage ? 'Supabase Storage' : 'locales (data/uploads)'} · quiz : ${geminiEnabled() ? 'Gemini activé' : 'désactivé (pas de GEMINI_API_KEY)'}`);
});
