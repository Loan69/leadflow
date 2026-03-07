const express = require('express');
const app = express();

// Permet à Express de lire le JSON envoyé par n8n
app.use(express.json());

// Sert automatiquement tous les fichiers du dossier "public"
// Quand quelqu'un ouvre l'URL, il reçoit public/index.html
app.use(express.static('public'));

// ── Stockage des leads en mémoire ──
// Simple tableau JavaScript — les leads sont perdus si le serveur redémarre
// Pour une vraie prod, on utiliserait une base de données
let leads = [];

// ── ROUTE 1 : n8n envoie un nouveau lead ──
// n8n fait un POST sur /webhook/lead avec les infos du lead en JSON
app.post('/webhook/lead', (req, res) => {
  const lead = {
    ...req.body,
    id: Date.now().toString(),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    status: 'new',
    notes: '',
    history: [
      {
        ico: '🏠',
        cls: 'tl-lead',
        title: 'Lead SweepBright reçu',
        desc: `Via ${req.body.source || 'Plateforme'} · ${req.body.bien || ''}`,
        time: new Date().toLocaleTimeString('fr-FR')
      }
    ]
  };
  leads.unshift(lead);
  console.log(`✅ Nouveau lead reçu : ${lead.prenom} ${lead.nom}`);
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