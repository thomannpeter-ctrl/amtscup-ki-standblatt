import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
const upload = multer({ dest: 'uploads/', limits: { fileSize: 12 * 1024 * 1024 } });

app.disable('x-powered-by');
app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/analyse', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Foto empfangen.' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'Die KI ist auf dem Server noch nicht eingerichtet.' });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const b64 = fs.readFileSync(req.file.path).toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';

    const prompt = `Du liest ein fotografiertes Gruppen-Standblatt des Amtscup Konolfingen aus.
Das Blatt kann Pistole, Feld A 300m oder Jungschützen sein. Erkenne zuerst die Disziplin aus der sichtbaren Formularüberschrift.
Lies Handschrift vorsichtig. Erfinde keine Angaben. Wenn etwas nicht sicher lesbar ist, lasse es leer oder markiere den Schützen als unsicher.
Gib ausschliesslich gültiges JSON zurück, ohne Markdown und ohne zusätzlichen Text, exakt mit diesen Feldern:
{"disziplin":"","runde":"","kombination":"","sektion":"","gruppe":"","schuetzen":[{"name":"","jahrgang":"","total":null,"unsicher":false}],"gruppen_resultat":null,"hinweise":[]}
Erfasse alle auf dem Standblatt eingetragenen Schützenzeilen, nicht nur vier. Totale und Gruppenresultat als Zahlen, sofern sichtbar. Hinweise kurz und auf Deutsch.`;

    const response = await client.responses.create({
      model: MODEL,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: `data:${mime};base64,${b64}`, detail: 'high' }
        ]
      }]
    });

    const text = (response.output_text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    if (!text) throw new Error('Die KI hat keine auswertbaren Daten zurückgegeben.');

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Die KI-Antwort konnte nicht gelesen werden. Bitte Foto erneut aufnehmen.'); }

    res.json(data);
  } catch (e) {
    console.error('Analysefehler:', e?.status || '', e?.code || '', e?.message || e);
    let message = 'Die KI-Auswertung ist fehlgeschlagen. Bitte später nochmals versuchen.';
    if (e?.status === 401) message = 'Der KI-Schlüssel ist ungültig. Der Administrator muss ihn erneuern.';
    if (e?.status === 429) message = 'Für die KI ist momentan kein Guthaben verfügbar oder das Nutzungslimit wurde erreicht.';
    if (e?.status === 400) message = 'Das Foto konnte von der KI nicht verarbeitet werden. Bitte ein neues Foto versuchen.';
    res.status(500).json({ error: message });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

app.listen(PORT, () => console.log(`Amtscup KI läuft auf Port ${PORT}`));
