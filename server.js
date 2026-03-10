const express = require('express');
const app = express();

// ── Middleware ──
// Permet à Express de lire le corps JSON des requêtes entrantes (depuis n8n)
app.use(express.json({ limit: '5mb' })); // limit 5mb car les emails HTML peuvent être lourds

// Sert automatiquement tous les fichiers statiques du dossier "public"
// index.html, CSS, JS sont servis depuis ici
app.use(express.static('public'));

// ── Stockage en mémoire ──
// Tableau simple — rapide à mettre en place mais les leads sont perdus au redémarrage
// À remplacer par PostgreSQL ou SQLite en production
let leads = [];

// ── Utilitaire : extraire le texte brut d'un HTML ──
// Utilisé pour afficher une version éditable sans balises HTML dans le dashboard
// Exemple : "<p>Bonjour <b>Jean</b></p>" → "Bonjour Jean"
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // supprime les blocs <style>
    .replace(/<[^>]+>/g, ' ')                        // supprime toutes les balises HTML
    .replace(/&nbsp;/g, ' ')                         // décode les espaces insécables
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')                         // réduit les espaces multiples
    .trim();
}

// ── Utilitaire : wrapper un texte brut dans un template HTML email ──
// Quand Claude/n8n envoie du texte brut (pas du HTML), on le met en forme
// automatiquement dans un template visuel cohérent avec le design LeadFlow
function wrapTextToHTML(text) {
  if (!text) return '';
  // Si c'est déjà du HTML, on ne touche pas
  if (text.trim().startsWith('<')) return text;

  // Convertit le texte brut en paragraphes HTML
  // Chaque bloc séparé par une ligne vide devient un <p>
  const paragraphs = text
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .map(block => {
      // Lignes courtes sans ponctuation de fin = titre de section
      if (block.length < 60 && !block.endsWith('.') && !block.endsWith(',')) {
        return `<p style="color:#8a9ab0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin:20px 0 6px;font-weight:600;">${block}</p>`;
      }
      return `<p style="color:#4a5a70;font-size:14px;line-height:1.8;margin:0 0 14px;">${block.replace(/\n/g,'<br>')}</p>`;
    })
    .join('');

  return `<html><body style="font-family:Georgia,serif;background:#f4f1eb;padding:30px 20px;">
    <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
      <div style="background:#0d1117;padding:28px 32px;text-align:center;">
        <div style="background:linear-gradient(135deg,#c8a45a,#e2c17e);display:inline-block;padding:7px 16px;border-radius:7px;margin-bottom:12px;">
          <span style="color:#0d1117;font-size:11px;font-weight:700;letter-spacing:2px;">AGENCE ORPI</span>
        </div>
        <p style="color:#8a9ab0;font-size:11px;letter-spacing:1px;margin:0;">LeadFlow — Email généré par IA</p>
      </div>
      <div style="padding:32px;">${paragraphs}</div>
      <div style="background:#0d1117;padding:14px 32px;text-align:center;">
        <p style="color:#4a5a70;font-size:10px;margin:0;">Propulsé par LeadFlow × n8n</p>
      </div>
    </div>
  </body></html>`;
}

// ── ROUTE 1 : Réception d'un nouveau lead depuis n8n ──
// n8n appelle cette route en POST après avoir scoré le lead avec Claude
// Le body contient : prenom, nom, email, tel, bien, source, projet, message,
//                    score, score_raison, email_bienvenue, relance_j2, relance_j7
app.post('/webhook/lead', (req, res) => {

  const body = req.body;

  // On construit le champ emailContent qui regroupe les 3 emails générés par l'IA
  // email_bienvenue, relance_j2, relance_j7 sont envoyés par n8n dans le body
  // wrapTextToHTML détecte automatiquement si c'est du texte brut ou du HTML :
  //   - texte brut (envoyé par Claude via n8n) → mis en forme dans un template HTML
  //   - HTML complet (déjà formaté) → conservé tel quel
  const emailContent = {
    j0: wrapTextToHTML(body.email_bienvenue || ''),
    j2: wrapTextToHTML(body.relance_j2 || ''),
    j7: wrapTextToHTML(body.relance_j7 || '')
  };

  // emailText contient la version texte brut de chaque email (pour l'édition agent)
  // L'agent voit le texte sans balises HTML, plus lisible pour faire des modifications
  const emailText = {
    j0: htmlToText(emailContent.j0),
    j2: htmlToText(emailContent.j2),
    j7: htmlToText(emailContent.j7)
  };

  // emailStatus trace l'état de chaque email
  // j0 est déjà envoyé automatiquement par n8n — on le marque 'auto_sent'
  // j2 et j7 sont en attente — ils seront envoyés par le workflow relances ou manuellement
  const emailStatus = {
    j0: 'auto_sent',
    j2: 'pending',
    j7: 'pending'
  };

  const lead = {
    ...body,           // tous les champs envoyés par n8n (prenom, nom, email, score, etc.)
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    status: 'new',
    notes: '',
    emailContent,      // HTML complet des 3 emails — pour l'aperçu visuel
    emailText,         // Texte brut des 3 emails — pour l'édition par l'agent
    emailStatus,       // État de chaque email (auto_sent / pending / sent / skipped)
    sendHistory: [],   // Historique des envois manuels (cliqués par l'agent)
    history: []        // Historique des actions sur ce lead (affiché dans l'onglet Historique)
  };

  leads.unshift(lead);

  // ── LOGS DÉTAILLÉS ─────────────────────────────────────────
  // Visible dans Railway → onglet "Deployments" → "View Logs"
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📥 NOUVEAU LEAD REÇU — ID ${lead.id}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  prenom       : ${body.prenom       || '❌ MANQUANT'}`);
  console.log(`  nom          : ${body.nom          || '❌ MANQUANT'}`);
  console.log(`  email        : ${body.email        || '❌ MANQUANT'}`);
  console.log(`  tel          : ${body.tel          || '❌ MANQUANT'}`);
  console.log(`  bien         : ${body.bien         || '❌ MANQUANT'}`);
  console.log(`  source       : ${body.source       || '❌ MANQUANT'}`);
  console.log(`  projet       : ${body.projet       || '❌ MANQUANT'}`);
  console.log(`  score        : ${body.score        || '❌ MANQUANT'}`);
  console.log(`  score_raison : ${body.score_raison ? body.score_raison.slice(0,80)+'…' : '❌ MANQUANT'}`);
  console.log(`  message      : ${body.message      ? body.message.slice(0,80)+'…'      : '❌ MANQUANT'}`);
  console.log('─────────────────────────────────────────────────');
  // Emails — on vérifie leur présence ET leur contenu
  if (emailContent.j0) {
    const wasText = !(body.email_bienvenue || '').trim().startsWith('<');
    const preview = htmlToText(emailContent.j0).slice(0, 80);
    console.log(`  ✅ email_bienvenue : ${emailContent.j0.length} caractères ${wasText ? '(texte brut → converti en HTML)' : '(HTML natif)'}`);
    console.log(`     Aperçu texte    : "${preview}…"`);
  } else {
    console.log(`  ❌ email_bienvenue : MANQUANT — clé attendue : "email_bienvenue"`);
  }
  if (emailContent.j2) {
    const wasText = !(body.relance_j2 || '').trim().startsWith('<');
    const preview = htmlToText(emailContent.j2).slice(0, 80);
    console.log(`  ✅ relance_j2      : ${emailContent.j2.length} caractères ${wasText ? '(texte brut → converti en HTML)' : '(HTML natif)'}`);
    console.log(`     Aperçu texte    : "${preview}…"`);
  } else {
    console.log(`  ❌ relance_j2      : MANQUANT — clé attendue : "relance_j2"`);
  }
  if (emailContent.j7) {
    const wasText = !(body.relance_j7 || '').trim().startsWith('<');
    const preview = htmlToText(emailContent.j7).slice(0, 80);
    console.log(`  ✅ relance_j7      : ${emailContent.j7.length} caractères ${wasText ? '(texte brut → converti en HTML)' : '(HTML natif)'}`);
    console.log(`     Aperçu texte    : "${preview}…"`);
  } else {
    console.log(`  ❌ relance_j7      : MANQUANT — clé attendue : "relance_j7"`);
  }
  console.log('─────────────────────────────────────────────────');
  // Dump complet des clés reçues — utile pour voir si n8n envoie des noms différents
  console.log(`  Toutes les clés reçues dans le body :`);
  console.log(`  → ${Object.keys(body).join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  res.json({ ok: true, id: lead.id });
});

// ── ROUTE 2 : Le dashboard récupère tous les leads ──
// Le dashboard appelle cette route toutes les 3 secondes pour se mettre à jour
app.get('/api/leads', (req, res) => {
  res.json(leads);
});

// ── ROUTE 3 : Mettre à jour un lead (statut, notes) ──
// Quand l'agent change le statut ou sauvegarde une note dans le dashboard
app.patch('/api/leads/:id', (req, res) => {
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead non trouvé' });
  Object.assign(lead, req.body);
  console.log(`📝 Lead mis à jour : ${lead.prenom} ${lead.nom}`);
  res.json({ ok: true });
});

// ── Démarrage du serveur ──
// Railway injecte automatiquement la variable PORT
// En local, on utilise le port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LeadFlow démarré sur le port ${PORT}`);
});