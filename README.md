# Scuborga — bêta 0.2.1

Version modulaire de Scuborga pour GitHub Pages.

## Changements clés

- `index.html` allégé.
- CSS déplacé dans `assets/styles.css`.
- JavaScript séparé en modules dans `src/`.
- Les opérations ne sont plus embarquées dans le HTML.
- Supabase devient la source principale des opérations.
- Auth Supabase obligatoire : les politiques RLS existantes exigent un utilisateur authentifié.
- Export JSON/CSV conservé comme sauvegarde.

## Déploiement GitHub Pages

Dépose tous les fichiers à la racine du dépôt GitHub :

```text
index.html
.nojekyll
README.md
assets/
src/
```

Puis laisse GitHub Pages publier la branche `main`, dossier `/root`.

## Attention

Cette version 0.2.1 est une bascule d'architecture. Elle ne reprend pas encore toute la logique avancée historique du fichier monolithique, notamment l'import bancaire complet et le workflow brouillon massif. Elle est faite pour valider :

1. l'authentification Supabase ;
2. le chargement des 1 846 opérations migrées ;
3. la consultation, les filtres, les bilans, les contrôles ;
4. l'ajout, la modification et la suppression d'opérations via Supabase.



## v0.2.1-beta

Correction de continuité visuelle : reprise d'une disposition plus proche de la série 0.1.x tout en gardant Supabase comme source principale.
