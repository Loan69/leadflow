// ════════════════════════════════════════════════════════════════
// server-debug.js — Version locale pour déboguer LeadFlow
// ════════════════════════════════════════════════════════════════
//
// USAGE :
//   node server-debug.js
//   Puis ouvrir http://localhost:3000
//
// DIFFÉRENCES AVEC server.js (production) :
//   - Logs détaillés de chaque requête et payload reçu
//   - Route GET /debug/leads pour inspecter les leads en mémoire
//   - Route POST /debug/test-lead pour injecter un lead de test sans n8n
//   - CORS activé pour accepter les requêtes de n8n en local
//   - Affichage de l'état des emails reçus dans le terminal
// ════════════════════════════════════════════════════════════════

const express = require('express');
const app = express();

// ── Middleware ──────────────────────────────────────────────────

// Parsing JSON avec limite haute car les emails HTML peuvent être lourds
app.use(express.json({ limit: '10mb' }));

// CORS : permet à n8n (sur un autre port ou domaine) d'appeler ce serveur en local
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Logger toutes les requêtes entrantes avec timestamp
app.use((req, res, next) => {
  const time = new Date().toLocaleTimeString('fr-FR');
  console.log(`\n[${time}] ${req.method} ${req.path}`);
  next();
});

// Fichiers statiques (dashboard)
app.use(express.static('public'));

// ── Stockage en mémoire ─────────────────────────────────────────
let leads = [];

// ── Utilitaire : extraire le texte brut d'un HTML ──────────────
// Retire toutes les balises HTML pour obtenir le texte lisible par l'agent
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // supprime les blocs <style>
    .replace(/<[^>]+>/g, ' ')                        // supprime toutes les balises HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── ROUTE 1 : Réception d'un lead depuis n8n ───────────────────
// C'est la route principale appelée par n8n après le scoring Claude
// En debug, on affiche le payload complet dans le terminal
app.post('/webhook/lead', (req, res) => {
  const body = req.body;

  // ── LOG DEBUG : affiche le payload reçu dans le terminal ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 PAYLOAD REÇU DE N8N :');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  prenom          : ${body.prenom || '❌ MANQUANT'}`);
  console.log(`  nom             : ${body.nom || '❌ MANQUANT'}`);
  console.log(`  email           : ${body.email || '❌ MANQUANT'}`);
  console.log(`  tel             : ${body.tel || '❌ MANQUANT'}`);
  console.log(`  bien            : ${body.bien || '❌ MANQUANT'}`);
  console.log(`  source          : ${body.source || '❌ MANQUANT'}`);
  console.log(`  projet          : ${body.projet || '❌ MANQUANT'}`);
  console.log(`  score           : ${body.score || '❌ MANQUANT'}`);
  console.log(`  score_raison    : ${body.score_raison ? body.score_raison.slice(0, 60) + '…' : '❌ MANQUANT'}`);
  console.log(`  message         : ${body.message ? body.message.slice(0, 60) + '…' : '❌ MANQUANT'}`);
  console.log('─────────────────────────────────────────────────');

  // Vérifie si les emails HTML sont présents et affiche leur taille
  const emailBienvenue = body.email_bienvenue || '';
  const relanceJ2      = body.relance_j2 || '';
  const relanceJ7      = body.relance_j7 || '';

  if (emailBienvenue) {
    console.log(`  ✅ email_bienvenue : ${emailBienvenue.length} caractères`);
  } else {
    console.log(`  ❌ email_bienvenue : MANQUANT — le mail J0 ne s'affichera pas`);
  }
  if (relanceJ2) {
    console.log(`  ✅ relance_j2      : ${relanceJ2.length} caractères`);
  } else {
    console.log(`  ❌ relance_j2      : MANQUANT — le mail J2 ne s'affichera pas`);
  }
  if (relanceJ7) {
    console.log(`  ✅ relance_j7      : ${relanceJ7.length} caractères`);
  } else {
    console.log(`  ❌ relance_j7      : MANQUANT — le mail J7 ne s'affichera pas`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Construction des champs structurés
  const emailContent = { j0: emailBienvenue, j2: relanceJ2, j7: relanceJ7 };
  const emailText    = {
    j0: htmlToText(emailBienvenue),
    j2: htmlToText(relanceJ2),
    j7: htmlToText(relanceJ7)
  };
  const emailStatus  = { j0: 'auto_sent', j2: 'pending', j7: 'pending' };

  const lead = {
    ...body,
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    status: 'new',
    notes: '',
    emailContent,
    emailText,
    emailStatus,
    sendHistory: [],
    history: []
  };

  leads.unshift(lead);
  console.log(`✅ Lead créé avec ID ${lead.id} — ${lead.prenom} ${lead.nom}`);
  res.json({ ok: true, id: lead.id });
});

// ── ROUTE 2 : Dashboard récupère les leads ─────────────────────
app.get('/api/leads', (req, res) => {
  console.log(`📋 GET /api/leads — ${leads.length} leads en mémoire`);
  res.json(leads);
});

// ── ROUTE 3 : Mise à jour d'un lead ───────────────────────────
app.patch('/api/leads/:id', (req, res) => {
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) {
    console.log(`❌ PATCH /api/leads/${req.params.id} — Lead introuvable`);
    return res.status(404).json({ error: 'Lead non trouvé' });
  }
  Object.assign(lead, req.body);
  console.log(`📝 Lead mis à jour : ${lead.prenom} ${lead.nom} — champs : ${Object.keys(req.body).join(', ')}`);
  res.json({ ok: true });
});

// ── ROUTE DEBUG 1 : Inspecter tous les leads en mémoire ────────
// Appelle http://localhost:3000/debug/leads dans ton navigateur
// pour voir l'état complet de tous les leads (avec emailContent)
app.get('/debug/leads', (req, res) => {
  console.log('🔍 DEBUG : dump de tous les leads');
  res.json(leads);
});

// ── ROUTE DEBUG 2 : Injecter un lead de test sans n8n ──────────
// Simule exactement ce que n8n enverrait avec des vrais emails HTML
// Appelle avec : curl -X POST http://localhost:3000/debug/test-lead
app.post('/debug/test-lead', (req, res) => {
  console.log('\n🧪 INJECTION D\'UN LEAD DE TEST...');

  // On simule le payload exact que Claude/n8n enverrait
  const fakePayload = {
    prenom: 'Jean',
    nom: 'Dupont',
    email: 'jean.dupont@test.com',
    tel: '06 12 34 56 78',
    bien: 'Appartement T3 Lyon 6ème — 380 000€',
    source: 'SeLoger',
    projet: 'Achat résidence principale',
    message: 'Bonjour, je souhaite visiter ce bien dès que possible, mon projet est abouti.',
    score: 'hot',
    score_raison: 'Le lead exprime une urgence forte ("dès que possible") et indique un projet abouti.',
    // Email J0 — HTML complet comme Claude le génèrerait
    email_bienvenue: `<html><body style="font-family:Georgia,serif;background:#f4f1eb;padding:30px 20px;">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
        <div style="background:#0d1117;padding:32px 36px;text-align:center">
          <div style="background:linear-gradient(135deg,#c8a45a,#e2c17e);display:inline-block;padding:8px 18px;border-radius:8px;margin-bottom:14px">
            <span style="color:#0d1117;font-size:11px;font-weight:700;letter-spacing:2px">AGENCE ORPI</span>
          </div>
          <h1 style="color:#e8eef6;font-size:22px;font-weight:400;margin:0">Votre demande a bien été reçue</h1>
        </div>
        <div style="padding:36px">
          <p style="color:#1a2130;font-size:16px;margin:0 0 16px">Bonjour <strong style="color:#c8a45a">Jean</strong>,</p>
          <p style="color:#4a5a70;font-size:14px;line-height:1.8;margin:0 0 20px">
            Nous avons bien reçu votre demande concernant l'<strong>Appartement T3 Lyon 6ème — 380 000€</strong>.
            Notre équipe va prendre contact avec vous dans les plus brefs délais pour organiser une visite.
          </p>
          <div style="background:#f8f6f1;border:1px solid #e8e0d0;border-radius:10px;padding:20px;margin-bottom:24px">
            <p style="color:#8a9ab0;font-size:10px;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px">Bien immobilier</p>
            <p style="color:#1a2130;font-size:15px;font-weight:700;margin:0">Appartement T3 Lyon 6ème — 380 000€</p>
          </div>
          <p style="color:#4a5a70;font-size:13px;margin:0">À très bientôt,<br><strong style="color:#1a2130">L'équipe Orpi LeadFlow</strong></p>
        </div>
        <div style="background:#0d1117;padding:20px 36px;text-align:center">
          <p style="color:#4a5a70;font-size:11px;margin:0">Propulsé par LeadFlow × SweepBright</p>
        </div>
      </div>
    </body></html>`,
    // Email J2 — relance douce
    relance_j2: `<html><body style="font-family:Georgia,serif;background:#f4f1eb;padding:30px 20px;">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;overflow:hidden">
        <div style="background:#0d1117;padding:28px 36px;text-align:center">
          <h1 style="color:#e8eef6;font-size:20px;font-weight:400;margin:0">Avez-vous eu le temps d'y réfléchir ?</h1>
        </div>
        <div style="padding:36px">
          <p style="color:#1a2130;font-size:16px;margin:0 0 16px">Bonjour <strong style="color:#c8a45a">Jean</strong>,</p>
          <p style="color:#4a5a70;font-size:14px;line-height:1.8;margin:0 0 20px">
            Suite à votre demande pour l'<strong>Appartement T3 Lyon 6ème</strong>, nous souhaitions savoir
            si vous êtes toujours intéressé(e). Nous restons disponibles pour organiser une visite à votre convenance.
          </p>
          <p style="color:#4a5a70;font-size:13px;margin:0">Cordialement,<br><strong style="color:#1a2130">L'équipe Orpi</strong></p>
        </div>
        <div style="background:#0d1117;padding:16px 36px;text-align:center">
          <p style="color:#4a5a70;font-size:11px;margin:0">LeadFlow × SweepBright</p>
        </div>
      </div>
    </body></html>`,
    // Email J7 — biens similaires
    relance_j7: `<html><body style="font-family:Georgia,serif;background:#f4f1eb;padding:30px 20px;">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;overflow:hidden">
        <div style="background:#0d1117;padding:28px 36px;text-align:center">
          <h1 style="color:#e8eef6;font-size:20px;font-weight:400;margin:0">Nous avons des biens similaires pour vous</h1>
        </div>
        <div style="padding:36px">
          <p style="color:#1a2130;font-size:16px;margin:0 0 16px">Bonjour <strong style="color:#c8a45a">Jean</strong>,</p>
          <p style="color:#4a5a70;font-size:14px;line-height:1.8;margin:0 0 20px">
            Depuis votre demande initiale, de nouveaux biens correspondant à vos critères sont disponibles
            sur Lyon 6ème. N'hésitez pas à nous contacter pour en savoir plus ou planifier une visite.
          </p>
          <p style="color:#4a5a70;font-size:13px;margin:0">À votre disposition,<br><strong style="color:#1a2130">L'équipe Orpi</strong></p>
        </div>
        <div style="background:#0d1117;padding:16px 36px;text-align:center">
          <p style="color:#4a5a70;font-size:11px;margin:0">LeadFlow × SweepBright</p>
        </div>
      </div>
    </body></html>`
  };

  // On simule la réception comme si c'était n8n
  const emailContent = { j0: fakePayload.email_bienvenue, j2: fakePayload.relance_j2, j7: fakePayload.relance_j7 };
  const emailText    = { j0: htmlToText(emailContent.j0), j2: htmlToText(emailContent.j2), j7: htmlToText(emailContent.j7) };
  const emailStatus  = { j0: 'auto_sent', j2: 'pending', j7: 'pending' };

  const lead = {
    ...fakePayload,
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    status: 'new',
    notes: '',
    emailContent,
    emailText,
    emailStatus,
    sendHistory: [],
    history: []
  };

  leads.unshift(lead);
  console.log(`✅ Lead de test créé : ${lead.prenom} ${lead.nom} (ID: ${lead.id})`);
  res.json({ ok: true, id: lead.id, lead });
});

// ── ROUTE DEBUG 3 : Vider tous les leads ───────────────────────
// Utile pour repartir de zéro sans redémarrer le serveur
app.delete('/debug/reset', (req, res) => {
  leads = [];
  console.log('🗑️  Tous les leads ont été supprimés');
  res.json({ ok: true, message: 'Leads vidés' });
});

// ── Démarrage ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     LeadFlow DEBUG — Mode local actif          ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  Dashboard   → http://localhost:${PORT}           ║`);
  console.log(`║  Leads JSON  → http://localhost:${PORT}/debug/leads║`);
  console.log(`║  Test lead   → POST /debug/test-lead           ║`);
  console.log(`║  Reset       → DELETE /debug/reset             ║`);
  console.log('╚════════════════════════════════════════════════╝');
  console.log('\n💡 Injecte un lead de test avec :');
  console.log(`   curl -X POST http://localhost:${PORT}/debug/test-lead\n`);
});