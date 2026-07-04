SCUBORGA — SUIVI DES VERSIONS
==============================
Application de trésorerie du club de plongée Napuka (FFESSM).
Hébergée sur GitHub Pages : https://byts3146.github.io/scuborga/

Note : l'historique des commits avant le 04/07/2026 n'a pas été
documenté de façon systématique (messages de commit génériques type
"Add files via upload"). Ce fichier journalise désormais chaque
modification à partir de la v0.8.4.


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
