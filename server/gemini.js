// Génération de quiz à partir d'une photo de cours, via l'API Gemini (offre gratuite).
// Sans GEMINI_API_KEY, la fonctionnalité est simplement désactivée.
export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function quizFromImages(images, { subject, chapter, count = 8 }) {
  if (!geminiEnabled()) throw Object.assign(new Error('Quiz désactivé : aucune clé GEMINI_API_KEY.'), { status: 503 });

  const prompt = `Tu es professeur en classe de première générale en France.
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
              },
              required: ['question', 'choix', 'bonne', 'explication'],
            },
          },
        },
        required: ['questions'],
      },
    },
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    const msg = res.status === 429 ? 'Limite gratuite de Gemini atteinte, réessaie dans une minute.' : `Erreur Gemini (${res.status}).`;
    console.error('Gemini', res.status, txt.slice(0, 500));
    throw Object.assign(new Error(msg), { status: 502 });
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('Réponse de Gemini illisible, réessaie.'), { status: 502 }); }
  const questions = (parsed.questions || [])
    .filter((q) => q.question && Array.isArray(q.choix) && q.choix.length >= 2 && Number.isInteger(q.bonne) && q.bonne >= 0 && q.bonne < q.choix.length)
    .slice(0, 15);
  if (!questions.length) throw Object.assign(new Error("Gemini n'a pas trouvé de cours lisible sur la photo."), { status: 422 });
  return { titre: parsed.titre || chapter, questions };
}
