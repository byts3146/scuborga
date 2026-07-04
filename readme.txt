SCUBORGA — SUIVI DES VERSIONS
==============================
Application de trésorerie du club de plongée Napuka (FFESSM).
Hébergée sur GitHub Pages : https://byts3146.github.io/scuborga/

Note : l'historique des commits avant le 04/07/2026 n'a pas été
documenté de façon systématique (messages de commit génériques type
"Add files via upload"). Ce fichier journalise désormais chaque
modification à partir de la v0.8.4.


v0.8.9 — 04/07/2026
--------------------
Cache-busting sur les fichiers CSS/JS.
Corrige un effet de bord de la scission multi-fichiers (v0.8.5) : les
navigateurs peuvent mettre en cache assets/css/style.css et
assets/js/*.js indépendamment de index.html — une mise à jour pouvait
donc ne pas apparaître immédiatement malgré un push réussi (constaté
par Franck après la v0.8.8).
- Ajout d'un paramètre ?v=<version> sur les balises <link> et
  <script> pointant vers les fichiers externes, à incrémenter à
  chaque montée de version (intégré au processus de commit habituel
  aux côtés de APP_META.version et du <title>).

v0.8.8 — 04/07/2026
--------------------
Bouton de fermeture sur tous les panneaux de saisie.
Ajoute un bouton ✕ visible (cercle en haut à droite) sur tous les
panneaux type "sheet" — nouvelle opération, édition, édition
multiple, filtres, modales de confirmation. Jusqu'ici la seule façon
de quitter était de taper en dehors du panneau ou de glisser vers le
bas, peu évident sur mobile, en particulier pour annuler une saisie
de nouvelle opération en cours. Fermeture = comportement identique
au tap en dehors du panneau (rien n'est enregistré).
Pour mémoire, la navigation retour au sein de Paramètres (liste →
détail) disposait déjà d'un bouton "‹ Retour aux réglages".

v0.8.7 — 04/07/2026
--------------------
Correction : compte bancaire (CC/EP) enfin sélectionnable.
Bug corrigé : aucune interface ne permettait de choisir le compte
bancaire d'une opération — toute nouvelle opération était forcée
silencieusement sur CC. Vérifié en base : les 1846 opérations
existantes datent toutes de la migration groupée du 25/06, donc
aucune opération saisie manuellement n'avait jamais pu être posée
sur EP jusqu'ici.
- Nouveau sélecteur "Compte courant / Épargne" dans le formulaire de
  saisie (création et édition)
- La saisie en série conserve le compte choisi d'une ligne à l'autre
Non traité : l'édition multiple (plusieurs lignes à la fois) ne
permet toujours pas de changer le compte en masse.

v0.8.6 — 04/07/2026
--------------------
Écran de résolution des conflits de synchro.
- Nouvelle entrée "Synchro & conflits" dans Paramètres, avec badge
  numérique si des conflits sont en attente.
- Pour chaque conflit détecté (v0.8.5) : libellé lisible de
  l'opération, raison du conflit, et 3 actions au choix : reprendre
  la version cloud, garder la version locale (renvoi forcé), ou
  ignorer.
- Le badge de synchro global (haut d'écran) est cliquable et amène
  directement à cet écran.

v0.8.5 — 04/07/2026 (scission multi-fichiers)
--------------------
Abandon de la contrainte fichier unique. Aucun changement fonctionnel,
uniquement une réorganisation du code :
- index.html : structure HTML uniquement
- assets/css/style.css : ensemble des styles
- assets/js/data.js : données de référence statiques (catégories,
  comptes comptables, adhérents, feuilles de classification)
- assets/js/app.js : logique applicative (Store, CloudSync, UI, init)
Correction incidente : le <title> affichait encore "bêta 0.8.3"
malgré les montées de version précédentes ; recalé sur 0.8.5.

v0.8.5 — 04/07/2026
--------------------
Détection de conflit de synchro cloud.
- Avant d'écraser une opération existante, vérification que la ligne
  cloud n'a pas été modifiée ou supprimée par un autre appareil
  depuis la dernière lecture (comparaison de updated_at, alimenté par
  le trigger trg_operations_touch côté base).
- En cas de conflit détecté (modif concurrente ou suppression
  distante) : écrasement annulé, conflit journalisé (CloudSync.conflicts,
  persisté en localStorage) au lieu d'être silencieusement perdu.
- Badge de synchro : priorité d'affichage aux conflits en attente
  ("⚠ N conflit(s)").
- Après un push réussi, la référence temporelle locale est rafraîchie
  pour servir de nouvelle base de comparaison.

v0.8.4 — 04/07/2026
--------------------
Persistance de la file de synchro cloud.
- Corrige un risque de perte silencieuse : si l'onglet était fermé
  pendant qu'une synchro cloud était en attente (échec réseau), les
  changements restaient uniquement en mémoire et n'étaient jamais
  renvoyés au cloud.
- CloudSync.persistQueue() : sauvegarde la file dans localStorage à
  chaque ajout et à chaque retrait réussi.
- CloudSync.restoreQueue() : restaure la file au démarrage une fois
  la connexion cloud confirmée, avec toast informatif et relance
  automatique de la synchro.

v0.8.3 et versions antérieures
--------------------
Historique non détaillé rétroactivement. Points connus (d'après le
contexte de développement, non vérifiés commit par commit) :
- Migration complète vers Supabase (PostgreSQL + Auth + RLS) avec
  architecture "local-first" (écriture locale immédiate, synchro
  cloud en arrière-plan).
- Import et vérification d'intégrité des données historiques
  (opérations, règles de classification, fiches de classification,
  réglages).
- Passage du champ débit/crédit séparé à un champ montant unique
  avec bascule de signe +/-.
- Ajout de la saisie en série avec navigation clavier.
- Améliorations du suivi des sorties dans les bilans (synthèse
  encaissé / en attente / net, vue consolidée par personne).
