SCUBORGA — SUIVI DES VERSIONS
==============================
Application de trésorerie du club de plongée Napuka (FFESSM).
Hébergée sur GitHub Pages : https://byts3146.github.io/scuborga/

Note : l'historique des commits avant le 04/07/2026 n'a pas été
documenté de façon systématique (messages de commit génériques type
"Add files via upload"). Ce fichier journalise désormais chaque
modification à partir de la v0.8.4.


[Infra] 04/07/2026 — Ajout de .nojekyll
--------------------
Corrige des échecs de déploiement intermittents observés depuis le
28/06 ("Page build failed" sur GitHub Pages, constaté par Franck
après la v0.8.9). Cause : le repo passait par le moteur Jekyll par
défaut alors que le site est 100% statique. Ajout d'un fichier
.nojekyll à la racine pour que GitHub Pages serve les fichiers
directement. Vérifié : déploiement du commit suivant réussi
("built", sans erreur) via l'API GitHub.
Pas de changement de version applicative (fichier de config du
dépôt, pas du code de l'app).

v0.9.7 — 04/07/2026
--------------------
Retrait des boutons d'actions rapides de l'Accueil.
Supprime le bloc de 4 boutons (Importer, À classer, Contrôles,
Sauvegarder). Chaque action reste accessible sans perte :
- Importer un relevé → Paramètres → Import/sauvegarde
- Sauvegarder → Paramètres → Import/sauvegarde
- Contrôles → Paramètres → Contrôles
- À classer → onglet dédié dans la barre de navigation (avec badge)
La carte "Points à traiter" conserve ses propres liens directs.

v0.9.6 — 04/07/2026
--------------------
Refonte de la page Accueil.
- Sélecteur de saison allégé (simple ligne, plus de carte dédiée)
- Fusion de "Trésorerie" et des 4 KPIs en une seule carte
  "Vue d'ensemble" : Produits/Charges/Résultat en ligne, soldes
  réels CC/EP juste en dessous
- Suppression du KPI "À classer" : il affichait un compte différent
  (limité à la saison) du bouton d'action et de la carte "Points à
  traiter" (tous deux sur historique complet) — 3 chiffres
  différents pour la même notion. Une seule source de vérité
  désormais, reprise dans le titre "Points à traiter (N)"
- Nouvel ordre : saison → vue d'ensemble → points à traiter →
  actions rapides → dernières opérations

v0.9.5 — 04/07/2026
--------------------
Boutons de compte simplifiés (CC/EP) à côté de Filtres.
Remplace les 3 boutons "Tous comptes / Compte courant / Épargne"
(sur leur propre ligne) par 2 boutons compacts "CC" / "EP", déplacés
sur la même ligne que le bouton Filtres.
Comportement : cliquer sur un compte le sélectionne ; re-cliquer
dessus désélectionne et revient à "tous comptes".

v0.9.4 — 04/07/2026
--------------------
Correction contraste bouton Filtres + retrait stats Opérations.
1) Bug de contraste corrigé : la classe .btn.sec (utilisée par le
bouton "Filtres" et 8 autres boutons dans l'appli) n'avait pas de
couleur de texte propre et héritait du blanc défini par .btn — texte
blanc sur fond quasi-blanc, donc illisible depuis le passage au
thème clair (v0.9.0). Corrige tous les boutons concernés, pas
seulement Filtres.
2) Retrait de la ligne "X opération(s) affichée(s) · total réalisé"
dans la vue Opérations, jugée superflue.

v0.9.3 — 04/07/2026
--------------------
Retrait des filtres rapides (Ce mois-ci, Cette saison...).
Supprime la barre de filtres rapides de la vue Opérations, pour
simplifier davantage la zone de filtre.
- "À classer" reste couvert par son propre onglet dédié — aucune perte
- "Sans justificatif" reste visible dans Contrôles — aucune perte
- "Non pointées" filtrait sur un champ (pointage) qui n'a en réalité
  aucune interface pour être renseigné nulle part dans l'appli —
  perte fonctionnelle minime (donnée historique figée, pas un
  workflow actif)

v0.9.2 — 04/07/2026
--------------------
Simplification de la zone de filtre (Opérations).
Avant : 6 rangées successives avant même de voir une opération.
Simplifié à 4 :
- Suppression de la ligne de puces "filtres actifs", redondante avec
  l'état déjà visible sur les boutons surlignés (comptes, filtres
  rapides) et le compteur du bouton "Filtres".
- Fusion de la ligne résumé avec la ligne des boutons Filtres/
  Réinitialiser.
- Le bouton "Réinitialiser" ne s'affiche plus que si un filtre est
  réellement actif.

v0.9.1 — 04/07/2026
--------------------
Éclaircissement des pastilles de catégorie.
Les pastilles de cat2/cat3 utilisaient encore des couleurs HSL
pensées pour l'ancien thème sombre (fond très foncé + texte pâle),
oubliées lors du passage au thème clair (v0.9.0) — elles juraient
avec le reste de l'interface.
- Nouvelles valeurs : fond pâle (87-92% de luminosité) + texte
  saturé foncé (24-30%), même logique que le reste de la palette
  claire.
- Corrigé au passage 3 résidus rgba codés en dur oubliés lors de la
  v0.9.0 (pastilles "À classer" et tags d'incohérence).

v0.9.0 — 04/07/2026
--------------------
Passage en thème clair complet.
Le fond bleu sombre a été jugé pas assez sobre. Bascule vers un
thème clair (fond gris très clair #f5f6f8, cartes blanches, texte
sombre #1c2430), avec recalcul complet de la palette pour garder des
contrastes lisibles :
- Bleu (--accent/--accent2), vert, rouge et amber assombris pour
  rester lisibles sur fond clair (l'ancien bleu clair #4a9eff était
  pensé pour du texte sur fond sombre, pas l'inverse)
- Correction de tous les résidus visuels de l'ancien thème : fond du
  header/nav, bordures, flèche des menus déroulants natifs, ombres
  portées adoucies
Sauvegarde de l'ancien style.css (thème sombre) conservée par Claude
en cas de retour en arrière souhaité.

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
