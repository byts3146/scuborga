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

v0.13.2 — 04/07/2026
--------------------
Réorganisation des boutons de Saisie : Publier avant Ajouter.
"✓ Aux opérations" renommé en "✓ Publier". La barre de sélection
(visible seulement si des lignes sont sélectionnées) est désormais
positionnée avant le bouton "+ Ajouter une opération" au lieu
d'après.

v0.13.1 — 04/07/2026
--------------------
Vers brouillons + bandeau collant (Opérations).
1) Nouveau bouton "↩ Vers brouillons" dans la barre de sélection :
   repasse la sélection en brouillon, avec confirmation.
2) Bandeau collant : recherche, comptes/filtres et barre de
   sélection restent visibles en scrollant, positionnés sous
   l'en-tête. Hauteur d'en-tête mesurée dynamiquement (variable CSS
   --header-h) pour s'adapter au contenu des badges.

v0.13.0 — 04/07/2026
--------------------
Correctif duplication + tri saisons + Adhérents enrichi.
1) Bug corrigé : dupliquer une opération générait un faux conflit de
   synchro (la copie conservait _cloudUpdatedAt de l'original).
   Corrigé dans duplicateOpsSel() et draftAction('dup').
2) Saisons triées par ordre décroissant dans le formulaire de
   saisie/édition uniquement.
3) Bouton "+ Ajouter une opération" (Saisie) plus visible ; message
   de confirmation reformulé.
4) Les opérations validées depuis Saisie passent en tête de l'ordre
   manuel s'il en existe un.
5) Menu Adhérents : recherche par nom, tri (montant/alphabétique),
   nouveau sous-onglet "Adhésions" (recettes réglées par l'adhérent
   puis dépenses payées par le club pour lui — FFESSM, Laffont
   assurance...).

v0.12.0 — 04/07/2026
--------------------
Réordonner les opérations via la sélection (sans glisser-déposer).
Nouveaux boutons "▲"/"▼" dans la barre de sélection multiple
d'Opérations : déplace la ou les ligne(s) sélectionnée(s) d'un cran,
fonctionne aussi pour une sélection non contiguë. La sélection reste
active après déplacement (clics répétés possibles).
Corrigé au passage : l'ordre manuel (Store.data.manualOrder)
n'était jamais synchronisé au cloud — ajout de
CloudSync.pushManualOrder(), l'ordre suit désormais entre appareils.

v0.11.10 — 04/07/2026
--------------------
Pastilles rouges -> bleues, tag adhérent en gris.
- CAT_HUE : sortie_debit (rouge/rose -> bleu) et autre_debit (rouge
  profond -> bleu-violet). Crédits et licence_debit/cf_debit
  inchangés.
- Tag adhérent : bleu accent -> gris neutre.
Non touché : .pill.cv (incohérences, conflits) reste rouge
(signal d'erreur volontairement distinct).

v0.11.9 — 04/07/2026
--------------------
Retrait de la note de solde cumulé dans Opérations.
Supprime les 3 variantes du texte explicatif au-dessus de la liste
("Solde après chaque opération...", "Renseigne le solde...",
"Sélectionne un seul compte..."). Le calcul et l'affichage du solde
cumulé à côté de chaque montant restent inchangés.

v0.11.8 — 04/07/2026
--------------------
Case "Formule" pour le champ Montant.
Nouvelle case à cocher "Formule (ex: 48,5-20)" sous le champ Montant :
cochée, bascule en clavier complet et pré-remplit le "=" (plus besoin
de trouver ce caractère sur un clavier numérique restreint) ;
décochée, revient au clavier numérique classique. Réinitialisée à
chaque ouverture du formulaire. Répond au point d'attention laissé
ouvert en v0.11.0.

v0.11.7 — 04/07/2026
--------------------
Message clair pour les conflits orphelins (opération introuvable).
Certains conflits référencent des opérations qui ont disparu du
cloud ET du local depuis (un rechargement complet remplace
Store.data.tx par le contenu du cloud, qui ne les contient plus —
seul le journal des conflits en garde la trace). Nouvel affichage
dédié pour ce cas : message explicatif clair + un seul bouton
"Retirer cette alerte" (au lieu des 3 boutons habituels, confus
quand il n'y a plus rien à arbitrer).

v0.11.6 — 04/07/2026
--------------------
Correction du vrai bug : cases à cocher héritant du style des
champs texte.
Root cause : la règle générale input/select/textarea (width:100%,
padding, fond, bordure) s'appliquait aussi aux <input type=checkbox>.
Régression introduite en v0.11.5 (retrait d'un width:auto pensé à
tort redondant). Dans une ligne flex nowrap, la case réclamait 100%
de la largeur, écrasant le libellé et poussant date/montant hors du
cadre visible — exactement les symptômes signalés par Franck (capture
à l'appui).
Correctif : nouvelle règle globale input[type=checkbox]{width:auto;
padding:0;background:none;border:none} qui réinitialise toutes les
cases à cocher de l'appli (9 au total), pas seulement celles
d'Opérations/Saisie.
Ce n'était pas un problème de cache : le code déployé était
identique au code source.

v0.11.5 — 04/07/2026
--------------------
Même disposition dans Saisie (draftRow).
Reproduit dans Saisie la disposition validée pour Opérations : ligne
principale (case, ⏳ si future, libellé, date, montant) + ligne méta
en dessous (catégorie ou "à classer" → adhérent → suggestion de
règle → incohérences).
Nettoyage CSS : anciennes règles .tx .lib/.meta/.amt/.grow devenues
mortes (tout passe désormais par .txline), supprimées.

v0.11.4 — 04/07/2026
--------------------
Ligne méta (cat2/cat3/adhérent) + déplacement du champ Adhérent.
1) Ligne d'opération (Opérations) : ajout d'une seconde ligne sous
   la ligne principale, avec cat2, cat3 puis l'adhérent si
   renseigné. Ne s'affiche pas si vide.
2) Formulaire de saisie : le champ Adhérent est déplacé juste après
   Cat. 3, sorti des "Détails avancés". Saison y reste seule.

v0.11.3 — 04/07/2026
--------------------
Lignes d'opération sur une seule ligne (Opérations).
Refonte de txRow() : [case à cocher] [⏳ si future] [libellé
tronqué] [date] [montant + solde cumulé].
Disparaît de l'affichage en liste (reste visible en ouvrant la
ligne) : pastilles cat2/cat3, tag adhérent, tag nature, pastille
"prévu" (remplacée par ⏳). Le statut "non classée" reste visible
via la bordure gauche ambre. Seuls #opsList et #futureList sont
concernés ; Saisie et le reste de l'appli sont inchangés.

v0.11.2 — 04/07/2026
--------------------
Focus auto sur Libellé + duplication depuis Opérations.
1) Le champ Libellé reçoit le focus automatiquement à l'ouverture du
   formulaire de saisie (nouvelle opération, édition, saisie en
   série) — évite un tap à vide à chaque fois.
2) Nouveau bouton "⎘ Dupliquer" dans la barre de sélection multiple
   d'Opérations. Duplique en brouillon(s) pour ajuster avant
   validation (1 sélectionnée → ouverture directe ; plusieurs →
   redirection vers Saisie).

v0.11.1 — 04/07/2026
--------------------
Cases à cocher toujours visibles, retrait du glisser-déposer.
- Les cases de sélection (Opérations) sont affichées en permanence,
  plus besoin d'activer un mode.
- Glisser-déposer (points ⠿, réordonnancement manuel) entièrement
  retiré — conflit avec la sélection permanente, et peu fiable au
  tactile de toute façon.
- La barre récap (nombre sélectionné + somme) s'affiche/se masque
  automatiquement selon la sélection.
Note : un ordre manuel déjà enregistré (Store.data.manualOrder)
reste respecté ; seule la possibilité d'en créer un nouveau via
glisser-déposer disparaît.

v0.11.0 — 04/07/2026
--------------------
Sélection multiple (Opérations) + formules dans le montant (Saisie).
1) Nouveau bouton "☑" dans Opérations : mode sélection avec case à
   cocher par ligne, barre récap (nombre sélectionné + somme), case
   "Tout". Le tap sur la ligne continue d'ouvrir l'édition ; seule
   la case sélectionne. Drag-to-reorder désactivé pendant la
   sélection.
2) Le champ Montant (Saisie) accepte une formule commençant par "="
   (ex: "=48,5-20" → 28,50), en plus d'un nombre simple avec virgule
   ou point. Résultat affiché après validation (blur). Enregistrement
   bloqué avec message clair si la formule est invalide.
   Point d'attention : sur certains claviers mobiles en mode
   numérique restreint, le caractère "=" n'est pas toujours
   disponible — à vérifier en conditions réelles.

v0.10.5 — 04/07/2026
--------------------
Soldes mensuels = fin de mois (au lieu de début).
La valeur saisie dans "Soldes de fin de mois" représente désormais
le solde au dernier jour du mois, et non plus au 1er.
- Renommage "Soldes de début de mois" → "Soldes de fin de mois"
- Affichage précis ("30 Septembre 2025" au lieu de "Septembre 2025")
- Contrôle de cohérence recalculé : solde fin-de-mois(N) + mouvements
  réels du mois N+1 = solde fin-de-mois(N+1) — la fenêtre de
  mouvements se décale d'un mois par rapport à la v0.10.4.
- Stockage inchangé (clé YYYY-MM-01), seule l'interprétation change.

v0.10.4 — 04/07/2026
--------------------
Boutons retour, soldes mensuels par saison, contrôle de cohérence,
À propos revu.
1) Bouton "‹ Retour aux réglages" ajouté dans Contrôles (vue à part
   entière, n'en avait aucun). Pour Synchro & conflits : le bouton
   standard est bien présent dans le code, identique aux autres
   écrans — à re-vérifier après déploiement.
2) Nouveau bloc "Soldes de début de mois" dans Paramètres → Soldes
   des comptes : saisie du solde bancaire réel au 1er de chaque mois
   d'une saison (sept. à août), par compte (CC/EP). Synchronisé au
   cloud (setting monthlyBalances).
3) Contrôles : sélecteur de saison (filtre toutes les statistiques)
   + nouveau bloc "Cohérence des soldes de début de mois" — vérifie
   que solde(mois N) + mouvements réels = solde(mois N+1), signale
   les écarts.
4) À propos : contenu remplacé par des informations dynamiques
   (nb opérations, règles, brouillons, saison en cours, date de
   version) au lieu d'un texte descriptif générique.

v0.10.3 — 04/07/2026
--------------------
Regroupement de Paramètres en 3 sections.
PARAM_MENU (liste plate de 7 entrées) devient PARAM_SECTIONS :
- Réglages : Saison par défaut, Soldes des comptes
- Données : Tables de classification, Import / sauvegarde
- Diagnostic : Contrôles, Synchro & conflits, À propos
Aucun changement fonctionnel, juste un regroupement visuel.

v0.10.2 — 04/07/2026
--------------------
Correction description obsolète : "Contrôles" mentionnait encore les
doublons, retirés en v0.9.8.

v0.10.1 — 04/07/2026
--------------------
Correction de résidus laissés par la refonte de nav (0.10.0).
- Titre statique par défaut de l'en-tête ("Tableau de bord") mis à
  jour vers "Opérations".
- Texte d'aide de "Soldes des comptes" qui mentionnait encore
  l'ancien onglet Accueil (supprimé) : reformulé.

v0.10.0 — 04/07/2026
--------------------
Refonte complète de la navigation principale.
Nouvelle structure de menus (6 onglets) : Opérations, Saisie,
Adhérents, Sorties, Bilan, Paramètres.
- Suppression de l'onglet "Accueil" (tableau de bord) : contenu
  perdu, décision explicite de Franck.
- Renommage "Classer" → "Saisie" (contenu strictement inchangé).
- Renommage "Bilans" → "Bilan" (singulier), qui ne contient plus que
  Résultat + Analyse CA/CV/CF.
- Extraction des sous-onglets "Adhérents" et "Sorties" du Bilan :
  deviennent chacun un onglet de navigation à part entière, avec
  leur propre sélecteur de saison (saison partagée avec le Bilan).
- "Opérations" devient la vue par défaut au démarrage.
- Nav légèrement réduite (police/icônes) pour accueillir 6 boutons
  sans débordement sur petit écran.

v0.9.8 — 04/07/2026
--------------------
Retrait carte "Points à traiter", retrait doublons, renommage menu.
1) Suppression de la carte "Points à traiter" de l'Accueil.
2) Suppression complète de la détection de doublons (demandée) :
   plus aucune analyse/traitement des doublons dans l'appli
   (controlStats, page Contrôles).
3) Renommage du menu "À classer" en "Classer" (onglet de navigation,
   titre de vue, texte d'aide). Le badge de statut "À classer" sur
   une opération non classée reste inchangé (notion différente).

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
