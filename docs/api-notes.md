# Notes sur l'API kDrive (jalon 0.0)

Mesures du 31/10/2026 avec un jeton de portée `drive`, requêtes GET uniquement, sur deux drives
d'un même compte (un drive personnel et un drive kSuite). Base : `https://api.infomaniak.com`,
authentification `Authorization: Bearer <jeton>`.

## Drives accessibles

- `GET /2/drive/init?with=drives` → `data.drives[]` avec `id` et `name`. Fonctionne ; `data`
  contient aussi `ips`.
- `GET /2/drive` → 422 `validation_failed`. `GET /3/drive/init` → 404.
- Chaque drive porte un `role` : `admin` sur ses propres drives, `external` sur le drive d'une
  autre personne dont on a reçu un partage. Un jeton de portée `drive` voit **tous ces drives**.
  `KDRIVE_IDS` est donc une vraie barrière de sécurité : ne jamais les exposer tous par défaut.
- Drive non accessible au jeton → 401 `not_authorized` (et non 404).

## Modèle de fichier

Champs de `GET /3/drive/{drive_id}/files/{file_id}` : `id`, `drive_id`, `name`, `type` (`dir`,
`file`), `status`, `visibility`, `parent_id`, `depth`, `added_at`, `created_at`, `created_by`,
`last_modified_at`, `last_modified_by`, `revised_at`, `updated_at`, `color`. Les fichiers portent
aussi `size` et `mime_type`. La racine a l'identifiant 1.

## Ascendance (filtrage de l'arborescence)

Le paramètre `with` résout le problème en **un seul appel**, sans remontée parent par parent.

| Requête | Résultat |
|---|---|
| `with=path` | `path` : chemin complet, commence par `/`, nom de l'élément inclus |
| `with=parents` | `parents[]` : objets dossier complets (`id`, `name`, `visibility`, …), du nombre de `depth - 1` |
| `with=parents.path` | valeur acceptée, mais ni `path` ni `parents` dans la réponse |
| `with=path,parents,capabilities` | combinable |

- Disponible sur les métadonnées (`files/{id}`), la **liste** d'un dossier et la **recherche**.
  Le filtrage des résultats ne demande donc aucun appel supplémentaire.
- `parents` **n'inclut pas la racine** (identifiant 1) : aucun résultat de recherche ne la contient.
  Mesuré : `depth` 9, 3, 4, 4, 5 pour 8, 2, 3, 3, 4 parents. Une racine autorisée `1` se traite
  donc à part (drive entier).

## Espaces et dossiers communs

- Le champ `visibility` des enfants de la racine distingue les espaces : `is_private_space`,
  `is_team_space` (mesuré sur le drive kSuite ; le drive personnel n'a qu'un espace privé).
- Les dossiers communs sont bien des dossiers ordinaires, listés sous la racine. Un filtrage
  par `visibility` serait possible en plus des racines.

## Partages reçus

- `GET /3/drive/files/shared_with_me` (**sans** `drive_id`) renvoie les partages reçus. La forme
  utilisée par le client officiel, `GET /3/drive/{drive_id}/files/shared_with_me`, renvoie une
  liste vide sur les drives de l'utilisateur alors qu'un partage existe : elle ne convient pas.
- Chaque élément porte le `drive_id` **du propriétaire** (un drive de rôle `external`) et
  `visibility: is_in_shared_space`.
- Le contenu se lit avec les endpoints habituels sur ce `drive_id` : métadonnées, liste d'un
  dossier et téléchargement mesurés (200, 206).
- L'élément partagé apparaît avec `depth` 1, `parents` vide et un `path` vu du destinataire, de
  la forme `/Shared/<nom>` : il ne reflète pas l'emplacement chez le propriétaire, dont
  l'ascendance n'est pas exposée. Les fichiers de l'utilisateur sont, eux, sous `/Private/…`. Non mesuré : `parents` des enfants du partage.
- `with=capabilities` donne les droits réels. Sur le partage mesuré : `can_read`, `can_write`,
  `can_rename`, `can_move`, `can_upload`, `can_create_file`, `can_create_directory`, `can_leave`…
  Un jeton peut donc modifier le dossier d'une autre personne.
- Sur un drive `external`, `files/1`, la liste de la racine et la recherche répondent 200, sans
  erreur. La racine liste 1 élément et la recherche renvoie des résultats. Non mesuré : si ces
  résultats se limitent aux partages reçus (hypothèse probable, l'API semble filtrer selon les
  droits du compte).

## Partages émis

- `GET /3/drive/{drive_id}/files/my_shared` liste les éléments partagés par l'utilisateur (la
  variante `/2/` répond aussi).
- `with=users,teams` détaille les destinataires ; `sharelink` vaut `null` sans lien de partage.
- Absent du client officiel.

## Pagination

- Réponses de liste : `result`, `data`, `response_at`, `cursor`, `has_more`.
- `limit` : 1000 accepté ; 5000 → 422 `validation_rule_max`, « The limit may not be greater than
  1000 ».
- La recherche accepte `query`, `limit`, `with` ; `per_page` provoque un 422.
- `recents` renvoie le même modèle de fichier.

## Téléchargement

`GET /2/drive/{drive_id}/files/{file_id}/download` avec `Range: bytes=0-0` → **206** :
`Accept-Ranges: bytes`, `Content-Range: bytes 0-0/<taille>`, `Content-Type` correct, `Etag`.
La lecture partielle est prise en charge : on peut contrôler type et taille avant de tout
télécharger, et lire par tranches. Les champs `size` et `mime_type` des métadonnées sont
cohérents avec ces en-têtes (2 fichiers testés).

## Erreurs

Format : `{"result": "error", "error": {"code", "description", "context", "errors"?}}`.

| Cas | HTTP | `code` |
|---|---|---|
| identifiant inexistant | 404 | `object_not_found` |
| drive inaccessible | 401 | `not_authorized` |
| paramètre invalide | 422 | `validation_failed`, détail dans `errors[]` (`validation_rule_max`, …) |

## Limites de débit

Aucun en-tête `rate` ou `limit` dans les réponses de lecture. Limites réelles inconnues (aucun 429
observé sur une trentaine d'appels) : prévoir une reprise sur 429 avec attente progressive.

## Non mesuré

- Effet réel des opérations d'écriture et méthodes HTTP associées : lire le client officiel, puis
  tester sur un dossier dédié au jalon 0.4.
- Comportement de `cursor` sur un dossier de plus de 1000 éléments.
- Taille maximale de téléchargement et de dépôt.
- `parents` des enfants d'un partage reçu, périmètre de la recherche sur un drive `external`.
- Portées fines des jetons : à constater sur la page de création des jetons.
