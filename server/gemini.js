// Génération de quiz à partir d'une photo de cours, via l'API Gemini (offre gratuite).
// Sans GEMINI_API_KEY, la fonctionnalité est simplement désactivée.
export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);
// Modèle principal (Flash-Lite : rapide, lit les images, large quota gratuit) puis modèle de secours
const MODELS = () => [...new Set([process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest'])];
const fail = (msg, status) => Object.assign(new Error(msg), { status });

// Appelle Gemini en essayant chaque modèle tant que l'erreur est temporaire (quota, surcharge, lenteur, modèle retiré)
async function callGemini(body) {
  let last = fail('Gemini est indisponible pour le moment, réessaie dans quelques minutes.', 504);
  // Plusieurs modèles à la suite : l'offre gratuite renvoie parfois 503 « forte demande » sur l'un d'eux
  // Budget total de 50 s (la fonction Vercel est coupée à 60 s)
  const plan = MODELS();
  const deadline = Date.now() + 50_000;
  for (const [n, model] of plan.entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, 1000));
    const left = deadline - Date.now();
    if (left < 5000) break;
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(20_000, left)),
      });
    } catch (e) {
      console.error('Gemini', model, e.name);
      last = fail(e.name === 'TimeoutError' ? 'Gemini met trop de temps à répondre, réessaie.' : 'Impossible de joindre Gemini (connexion ?).', 504);
      continue;
    }
    if (res.ok) return res.json();
    const txt = await res.text();
    console.error('Gemini', model, res.status, txt.slice(0, 300));
    last = fail(res.status === 429 ? 'Limite gratuite de Gemini atteinte, réessaie dans une minute.'
      : res.status === 400 || res.status === 403 ? 'Clé Gemini refusée : vérifie GEMINI_API_KEY dans .env.' : `Erreur Gemini (${res.status}).`, 502);
    if (![404, 429, 500, 503].includes(res.status)) break;
  }
  throw last;
}

export async function quizFromImages(images, { subject, chapter, count = 8, prompt: customPrompt, allowEmptyImages = false }) {
  if (!geminiEnabled()) throw Object.assign(new Error('Quiz désactivé : aucune clé GEMINI_API_KEY.'), { status: 503 });

  const prompt = customPrompt || `Tu es professeur en classe de première générale en France.
Voici la photo d'un cours de ${subject || 'une matière'}${chapter ? `, chapitre « ${chapter} »` : ''}.
Écris ${count} questions de révision en français, uniquement à partir de ce qui est dans le cours.
Mélange : définitions, formules ou mécanismes, et application courte.
Chaque question a 4 choix, une seule bonne réponse, et une explication d'une ou deux phrases.
Si la photo est illisible ou n'est pas un cours, renvoie une liste vide.`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.buffer.toString('base64') } })),
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          titre: { type: 'STRING' },
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                question: { type: 'STRING' },
                choix: { type: 'ARRAY', items: { type: 'STRING' } },
                bonne: { type: 'INTEGER', description: 'index (0 à 3) de la bonne réponse' },
                explication: { type: 'STRING' },
                matiere: { type: 'STRING' },
              },
              required: ['question', 'choix', 'bonne', 'explication'],
            },
          },
        },
        required: ['questions'],
      },
    },
  };

  const data = await callGemini(body);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('Réponse de Gemini illisible, réessaie.'), { status: 502 }); }
  const questions = (parsed.questions || [])
    .filter((q) => q.question && Array.isArray(q.choix) && q.choix.length >= 2 && Number.isInteger(q.bonne) && q.bonne >= 0 && q.bonne < q.choix.length)
    .slice(0, 15);
  if (!questions.length && !allowEmptyImages) throw Object.assign(new Error("Gemini n'a pas trouvé de cours lisible sur la photo."), { status: 422 });
  return { titre: parsed.titre || chapter, questions };
}

// Lecture d'une photo d'emploi du temps : renvoie les créneaux trouvés (rien n'est enregistré ici)
export async function timetableFromImages(images) {
  if (!geminiEnabled()) throw Object.assign(new Error('Lecture désactivée : aucune clé GEMINI_API_KEY.'), { status: 503 });
  const prompt = `Voici la photo de l'emploi du temps d'un élève de première générale en France (souvent une capture de Pronote ou un tableau papier).
Liste TOUS les cours de la semaine type, un objet par cours :
- jour : 1 = lundi, 2 = mardi, 3 = mercredi, 4 = jeudi, 5 = vendredi, 6 = samedi ;
- debut et fin au format HH:MM (24 h) ;
- matiere : le nom de la matière tel qu'écrit (ex. « MATHEMATIQUES », « SES », « PHYSIQUE-CHIMIE », « HIST.-GEO. », « ANGLAIS LV1 ») ;
- salle si elle est indiquée, sinon vide.
Ignore les récréations, la cantine, les heures vides, les permanences et les cours annulés.
Si un cours n'a lieu qu'une semaine sur deux (semaine A / B, Q1 / Q2), garde-le et mets « A » ou « B » dans le champ semaine.
Si la photo n'est pas un emploi du temps, renvoie une liste vide.`;
  const body = {
    contents: [{ role: 'user', parts: [...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.buffer.toString('base64') } })), { text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          cours: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                jour: { type: 'INTEGER' }, debut: { type: 'STRING' }, fin: { type: 'STRING' },
                matiere: { type: 'STRING' }, salle: { type: 'STRING' }, semaine: { type: 'STRING' },
              },
              required: ['jour', 'debut', 'fin', 'matiere'],
            },
          },
        },
        required: ['cours'],
      },
    },
  };
  const data = await callGemini(body);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('Réponse de Gemini illisible, réessaie.'), { status: 502 }); }
  const hhmm = (s) => { const m = String(s || '').trim().replace('h', ':').match(/^(\d{1,2}):?(\d{2})?$/); return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null; };
  return (parsed.cours || [])
    .map((c) => ({ weekday: Number(c.jour), start: hhmm(c.debut), end: hhmm(c.fin), label: String(c.matiere || '').trim(), room: String(c.salle || '').trim().slice(0, 20), week: String(c.semaine || '').trim().toUpperCase().slice(0, 1) }))
    .filter((c) => c.weekday >= 1 && c.weekday <= 6 && c.start && c.end && c.end > c.start && c.label);
}
