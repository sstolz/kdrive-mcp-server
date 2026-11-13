# Spécification : kdrive-mcp-server, serveur MCP kDrive (local et distant)

Statut : brouillon v0.4, 01/11/2026 (mesures de l'API : `docs/api-notes.md` ; revue de la v0.3 :
`docs/spec-review.md`)
Paquet npm et dépôt GitHub : `kdrive-mcp-server` (libre sur npm au 31/10/2026 [1])

## 1. Objectif

Donner à un assistant compatible MCP (Claude Code, Claude Desktop, claude.ai, Claude iOS, tout
client MCP) un accès complet et maîtrisé à un ou plusieurs kDrive Infomaniak :

- lecture, recherche, lecture du contenu des documents ;
- écriture (création, dépôt, renommage, déplacement, corbeille) ;
- partage, désactivé par défaut ;
- éléments partagés avec l'utilisateur, dossiers communs, plusieurs drives ;
- restriction à une partie de l'arborescence, appliquée par le serveur ;
- deux modes d'exécution avec le même code : local (`npx`, stdio) et serveur HTTP (URL publique
  avec OAuth), pour les clients qui n'acceptent qu'une URL.

Projet open source (GitHub, licence MIT). **Non officiel, non affilié à Infomaniak** : à écrire en
tête du README, dans la description npm et dans le message d'accueil du serveur MCP. Ni logo ni
charte graphique Infomaniak ; « kDrive » n'est employé que pour désigner le service auquel le
serveur se connecte.

## 2. Hors périmètre (v1)

- Multi-utilisateur : une instance = un jeton Infomaniak = un propriétaire. Plusieurs personnes
  autorisées en OAuth partagent les mêmes droits kDrive.
- Autres produits kSuite (mail, agenda, kChat, contacts) : l'architecture doit permettre de les
  ajouter plus tard sous forme de modules, sans les implémenter.
- Synchronisation, cache de contenu, indexation locale.
- Fournisseur d'identité : l'authentification des personnes est toujours déléguée à un
  fournisseur OIDC existant. Le mode `proxy` assure en revanche les fonctions de serveur
  d'autorisation envers les clients MCP, limitées au contrat du §8.
- OCR des documents numérisés.
- Tout élément propre à une installation particulière (domaines, hôtes, fournisseur d'identité
  choisi) : la documentation ne contient que des exemples génériques.

## 3. Existant et réutilisation

[Infomaniak/mcp-server-kdrive](https://github.com/Infomaniak/mcp-server-kdrive) (MIT, TypeScript,
SDK MCP officiel, v1.2.0) : 14 outils, stdio uniquement, pas de lecture seule, pas de filtrage,
un seul drive, téléchargement renvoyé en base64 brut.

- On reprend son client d'API (`src/kdrive-client.ts`) avec attribution (en-tête de fichier et
  `NOTICE`), et on suit ses évolutions à la main (comparaison périodique).
- Pas de fork : outils, transports, politique d'accès et authentification sont réécrits.
- Même pile que les serveurs MCP d'Infomaniak (kdrive, mail, calendar, kchat, contact :
  TypeScript, Node LTS, `@modelcontextprotocol/sdk`, `zod`), pour pouvoir reprendre leurs
  clients plus tard.

Endpoints utilisés par le client officiel (base `https://api.infomaniak.com`, jeton Bearer) :

| Opération | Endpoint |
|---|---|
| recherche | `GET /3/drive/{drive_id}/files/search` (`directory_id`, `depth`) |
| liste d'un dossier | `GET /3/drive/{drive_id}/files/{file_id}/files` (`type[]`, `cursor`) |
| métadonnées | `GET /3/drive/{drive_id}/files/{file_id}` |
| téléchargement | `GET /2/drive/{drive_id}/files/{file_id}/download` |
| dépôt | `POST /3/drive/{drive_id}/upload` |
| création de dossier | `POST /3/drive/{drive_id}/files/{file_id}/directory` |
| renommage | `POST /2/drive/{drive_id}/files/{file_id}/rename` |
| déplacement | `POST /3/drive/{drive_id}/files/{file_id}/move/{dest_id}` |
| corbeille | `DELETE /2/drive/{drive_id}/files/{file_id}` |
| restauration | `POST /2/drive/{drive_id}/trash/{file_id}/restore` |
| lien de partage | `POST /2/drive/{drive_id}/files/{file_id}/link` |
| invitation | `POST /2/drive/{drive_id}/files/{file_id}/access/invitations` |
| récents | `GET /3/drive/{drive_id}/files/recents` |
| partages reçus | `GET /3/drive/files/shared_with_me` (sans `drive_id`, contrairement au client officiel) |
| partages émis | `GET /3/drive/{drive_id}/files/my_shared` (absent du client officiel) |

Les méthodes HTTP sont à confirmer dans le code source du client officiel. Liste des drives
accessibles : `GET /2/drive/init?with=drives`. Le paramètre `with` (`path`, `parents`,
`capabilities`…) fonctionne sur les métadonnées, les listes et la recherche : mesures et limites
dans `docs/api-notes.md`.

## 4. Modes d'exécution

Un seul paquet npm, un seul binaire :

```
npx @sstolz/kdrive-mcp-server                  # stdio (défaut), clients locaux
npx @sstolz/kdrive-mcp-server --http --port 3000 # Streamable HTTP, derrière un reverse proxy
docker run … ghcr.io/<owner>/kdrive-mcp-server # image du projet, mode HTTP
```

| | stdio | HTTP |
|---|---|---|
| Transport MCP | stdio | Streamable HTTP (pas de SSE historique) |
| Authentification client | aucune (processus local) | OAuth 2.1 obligatoire ; refus de démarrer sans configuration d'auth, sauf `--insecure-no-auth` qui force l'écoute sur `127.0.0.1` |
| Jeton Infomaniak | variable d'environnement | variable d'environnement ou fichier secret |
| Politique d'accès | identique | identique |

### Configuration

Ordre de priorité : options CLI, variables d'environnement, fichier de configuration
(`--config kdrive-mcp-server.yaml`). Les listes complexes (racines par drive, motifs) sont plus
lisibles dans le fichier YAML ; les variables couvrent les cas simples.

| Variable | Rôle |
|---|---|
| `KDRIVE_TOKEN` / `KDRIVE_TOKEN_FILE` | jeton API Infomaniak, portée `drive` |
| `KDRIVE_ID` | drive par défaut |
| `KDRIVE_IDS` | drives autorisés, séparés par des virgules (défaut : `KDRIVE_ID` seul, jamais tous les drives du jeton) |
| `KDRIVE_MCP_MODE` | `read` (défaut), `write`, `share` (cumulatif) |
| `KDRIVE_MCP_ROOTS` | dossiers autorisés, `driveId:folderId` ou `driveId:/chemin`, séparés par des virgules. Absente : drives de `KDRIVE_IDS` entiers. Renseignée : chaque drive de `KDRIVE_IDS` doit y figurer, sinon refus de démarrer ; `driveId:1` désigne explicitement un drive entier |
| `KDRIVE_MCP_DENY` | motifs de chemins interdits (glob), ex. `**/.ssh/**,**/Comptabilité/**` |
| `KDRIVE_MCP_MAX_TREE_ITEMS` | descendants examinés au plus par opération sur un dossier (défaut 10 000, §10.4) |
| `KDRIVE_MCP_SHARED_WITH_ME` | `0` (défaut) pour masquer les partages reçus, `1` pour les exposer |
| `KDRIVE_MCP_SHARED_WRITE` | `1` pour autoriser l'écriture dans les partages reçus (défaut `0`) ; sans effet si `KDRIVE_MCP_MODE` vaut `read` |
| `KDRIVE_MCP_MAX_READ_BYTES` | octets téléchargés au plus par appel (défaut 5 Mo) |
| `KDRIVE_MCP_MAX_EXTRACT_BYTES` | octets décompressés ou décodés au plus par appel (défaut 50 Mo) |
| `KDRIVE_MCP_EXTRACT_TIMEOUT_MS` | durée maximale d'extraction par appel (défaut 20 000) |
| `KDRIVE_MCP_MAX_OUTPUT_CHARS` | caractères renvoyés au plus par appel, base64 compris (défaut 200 000) |
| `KDRIVE_MCP_AUDIT_LOG` | fichier ou `stderr` pour le journal d'audit (défaut `stderr`) |
| `KDRIVE_MCP_ALLOW_PUBLIC_LINKS` | `1` pour autoriser les liens publics (niveau `share` requis) |
| `KDRIVE_MCP_INVITE_DOMAINS` | domaines e-mail autorisés pour les invitations ; absente ou vide, toute invitation est refusée. Comparaison exacte, sans casse, sur le domaine de l'adresse : les sous-domaines doivent être listés |
| `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_PUBLIC_URL` | mode HTTP |
| `OAUTH_*` | mode HTTP, cf. §8 |

## 5. Architecture

```
src/
  cli.ts              analyse des options, choix du transport
  config.ts           chargement et validation (zod) de la configuration
  kdrive/client.ts    client API (repris d'Infomaniak, MIT, attribution), multi-drive
  kdrive/types.ts
  policy/             résolution d'ascendance, racines, motifs interdits, niveaux
  tools/              un fichier par famille : read.ts, write.ts, share.ts
  extract/            conversion de contenu en texte (pdf, docx, xlsx, …)
  transport/stdio.ts
  transport/http.ts   Streamable HTTP, sessions, validation Origin
  auth/               vérification des jetons, métadonnées, proxy OAuth (§8)
  audit.ts            journal structuré (JSON lines)
```

Règles :

- aucun outil ni ressource n'appelle le client kDrive sans passer par `policy.check(operation)`,
  où `operation` décrit le niveau requis et les éléments affectés, avec leurs chemins actuels et
  résultants (§10.4) ;
- le client est instancié par drive. Deux voies d'autorisation seulement : un `drive_id` de
  `KDRIVE_IDS` (§10.1), ou un élément partagé autorisé d'un drive `external` (§10.3). Tout autre
  `drive_id` est refusé avant tout appel.

## 6. Outils

Chaque outil porte les annotations MCP (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) et n'est enregistré que si le niveau configuré l'autorise : un outil interdit
n'apparaît pas dans la liste, il ne se contente pas d'échouer.

Tous les outils acceptent un paramètre optionnel `drive_id` (défaut `KDRIVE_ID`).

| Outil | Niveau | Notes |
|---|---|---|
| `kdrive_list_drives` | read | drives configurés, avec nom et racines autorisées |
| `kdrive_list` | read | pagination par curseur, filtre fichier/dossier |
| `kdrive_search` | read | portée limitée aux racines autorisées |
| `kdrive_info` | read | métadonnées, chemin complet |
| `kdrive_resolve_path` | read | chemin lisible vers identifiant, pour éviter de manipuler des ID |
| `kdrive_read` | read | contenu en texte extrait (§7), ou image MCP, ou refus si binaire non géré |
| `kdrive_download` | read | contenu brut en base64, plafonné, pour les clients qui savent l'exploiter |
| `kdrive_recents` | read | filtré par la politique |
| `kdrive_shared_with_me` | read | partages reçus, tous drives confondus, avec le `drive_id` du propriétaire (§10.3) |
| `kdrive_my_shared` | read | partages émis ; destinataires et liens (`with=users,teams,sharelink`) renvoyés seulement au niveau `share`, jamais en `read` ni `write` |
| `kdrive_create_folder` | write | chemin résultant vérifié (§10.4) |
| `kdrive_upload` | write | texte ou base64 ; chemin résultant vérifié ; écrasement soumis à la règle ci-dessous |
| `kdrive_rename` | write | chemins actuels et résultants vérifiés, descendants compris (§10.4) |
| `kdrive_move` | write | source et destination vérifiées, descendants compris (§10.4) ; pas de déplacement entre drives en v1 |
| `kdrive_trash` | write, destructif | corbeille uniquement, jamais de suppression définitive ; descendants vérifiés (§10.4) |
| `kdrive_restore` | write | source et destination vérifiées (§10.5) |
| `kdrive_share_link` | share, destructif | désactivé par défaut ; lien public refusé sauf `KDRIVE_MCP_ALLOW_PUBLIC_LINKS=1` ; règle des dossiers au §10.4 |
| `kdrive_share_access` | share, destructif | désactivé par défaut ; destinataires limités à `KDRIVE_MCP_INVITE_DOMAINS` ; règle des dossiers au §10.4 |

Aucun outil de suppression définitive, de vidage de corbeille ou de modification des droits du
drive.

Ressources MCP : `kdrive://{drive_id}/file/{id}` (lecture via la même politique que les outils).
Pas de prompts en v1.

### Écrasement

`kdrive_upload` n'écrase un fichier qu'avec `overwrite: true`. Une recherche préalable ne suffit
pas à le garantir : un autre client peut créer le fichier entre la recherche et le dépôt. L'outil
n'est livré qu'après mesure du comportement de l'API en cas de collision (§13). Si l'API offre un
refus atomique, il est utilisé. Sinon, la garantie est réduite à « aucun écrasement connu au moment
de la vérification », et la description de l'outil comme le README le disent.

### Reprises

- Lectures : reprise sur 429 et 5xx, avec attente progressive et nombre d'essais plafonné.
- Écritures et partages : reprise sur 429 uniquement. Après un délai dépassé, une connexion perdue
  ou un 5xx, aucune reprise automatique : l'outil renvoie un résultat `incertain` et demande de
  vérifier l'état de l'élément avant toute nouvelle tentative. Le journal d'audit l'enregistre.

### Pagination filtrée

- Le filtrage peut vider une page : une page vide n'indique pas la fin. Seul `has_more: false`
  l'indique.
- Les outils renvoient un curseur opaque. Un appel d'outil fait au plus 5 appels de liste à l'API,
  puis rend les résultats obtenus avec `has_more: true`.
- `kdrive_search` sur plusieurs racines interroge les racines dans l'ordre de configuration,
  sans tri global, et supprime les doublons par couple `(drive_id, id)`. Le curseur porte l'indice
  de la racine et le curseur de l'API.

## 7. Lecture de contenu

`kdrive_read` renvoie un contenu exploitable par un modèle :

| Type | Rendu |
|---|---|
| texte, code, md, csv, json | texte, détection d'encodage |
| PDF | texte extrait, page par page, paramètre `pages` ; sans texte extractible (document numérisé), indication explicite, pas d'OCR |
| docx, odt | texte (structure de titres conservée en Markdown) |
| xlsx, ods | feuilles en CSV, paramètre `sheet`, plafond de lignes |
| pptx, odp | texte des diapositives |
| images | contenu image MCP, redimensionné si trop lourd |
| autres | refus explicite avec métadonnées, renvoi vers `kdrive_download` |

Plafonds, tous appliqués par appel (§4) :

- téléchargement : `KDRIVE_MCP_MAX_READ_BYTES`. Un fichier compressé (docx, odt, xlsx, ods, pptx,
  odp) ou un PDF plus gros que ce plafond est refusé, car une tranche d'octets n'y est pas
  exploitable ;
- décompression et décodage, images comprises : `KDRIVE_MCP_MAX_EXTRACT_BYTES`, pour borner le
  coût d'un petit fichier très compressé ;
- durée : `KDRIVE_MCP_EXTRACT_TIMEOUT_MS` ;
- sortie : `KDRIVE_MCP_MAX_OUTPUT_CHARS`, base64 compris (`kdrive_read` et `kdrive_download`).

Continuation : `pages` pour un PDF et `sheet` pour un tableur choisissent la partie lue. `offset`
compte des caractères de la sortie extraite ; pour un fichier texte seul, les tranches d'octets
restent possibles en interne. Toute sortie tronquée le signale et renvoie l'`offset` suivant et
l'`etag` du fichier. La suite se demande avec cet `etag` ; s'il a changé, l'appel est refusé pour
ne pas mêler deux versions. Sans cache de contenu, chaque continuation retélécharge et réextrait
le document.

Dépendances d'extraction pures JavaScript (pas de binaire natif), maintenues, à choisir et
justifier dans le README (pistes : `pdfjs-dist`, `mammoth`, une bibliothèque tableur sans
vulnérabilité connue).

## 8. Authentification (mode HTTP)

Version de référence : spécification d'autorisation MCP du 28/07/2026. La
[matrice de compatibilité des clients MCP](docs/mcp-client-compatibility.md) donne, par client, les
modes d'enregistrement documentés, les URL de retour, la version d'autorisation citée et le résultat
du test réel. Le serveur est une **ressource protégée OAuth 2.1** ; l'identité des personnes est toujours
vérifiée par un fournisseur OIDC externe, quel qu'il soit (Gitea, Keycloak, Authentik, Google,
Entra…). Aucun fournisseur n'est privilégié par le code ni par la documentation.

Cette version recommande les *Client ID Metadata Documents* (CIMD) et conserve l'enregistrement
dynamique comme mécanisme déprécié de compatibilité. La documentation des connecteurs Claude
consultée le 02/11/2026 décrit CIMD, utilisé seulement si les métadonnées du serveur d'autorisation
annoncent `client_id_metadata_document_supported` et la méthode `none`, ainsi que l'enregistrement
dynamique et la saisie manuelle d'un client ID ; le détail par client figure dans la matrice.

### Exigences connues de claude.ai (connecteurs personnalisés)

D'après la documentation Anthropic consultée le 31/10/2026 et le 01/11/2026 :

- claude.ai prend en charge l'**enregistrement dynamique de client** (RFC 7591) ; un serveur
  d'autorisation peut forcer un nouvel enregistrement en renvoyant `401 invalid_client` depuis
  l'endpoint de jeton ;
- à défaut, l'utilisateur peut saisir un **client ID et un secret** dans les paramètres avancés
  du connecteur ;
- versions d'autorisation citées : 2025-03-26 et 2025-06-18, à confronter à la version de
  référence dans la matrice de compatibilité ;
- URL de retour : `https://claude.ai/api/mcp/auth_callback` (la documentation annonce un possible
  passage à `https://claude.com/api/mcp/auth_callback`) ; nom du client OAuth : `Claude`.

### Trois modes, choisis par configuration

| Mode | Quand | Fonctionnement |
|---|---|---|
| `delegate` | le fournisseur répond aux exigences ci-dessous et gère l'enregistrement dynamique ou CIMD | le serveur publie `/.well-known/oauth-protected-resource` (RFC 9728) pointant vers l'émetteur et se contente de valider les jetons |
| `delegate-static` | mêmes exigences, client créé à la main chez le fournisseur | idem ; client ID et secret saisis dans le client MCP (paramètres avancés de claude.ai) |
| `proxy` | le fournisseur ne répond pas aux exigences, ou le client MCP ne permet pas la saisie manuelle | le serveur assure envers les clients MCP les métadonnées d'autorisation, l'enregistrement dynamique, `/authorize` et `/token`, délègue l'authentification au fournisseur amont avec un client statique, et émet ses propres jetons courts, signés, liés à l'audience du serveur |

### Capacités requises du fournisseur

| Capacité | `delegate` | `delegate-static` | `proxy` (fournisseur amont) |
|---|---|---|---|
| découverte (RFC 8414 ou OIDC Discovery) | oui | oui | oui |
| flux par code avec PKCE S256 | oui | oui | oui |
| enregistrement dynamique ou CIMD | oui | non | non |
| prise en compte de `resource` (RFC 8707) : `aud` égal à l'URI canonique du serveur | oui | oui | non |
| jeton d'accès JWT vérifiable (JWKS) | oui | oui | non |
| jeton d'identité OIDC | non | non | oui |

La prise en charge d'OIDC ne suffit pas. Les clients MCP envoient `resource` même si le fournisseur
l'ignore, et le serveur doit alors refuser le jeton, faute d'audience correcte. Avant d'utiliser
un mode `delegate`, tester un vrai jeton du fournisseur retenu (§12, jalon 0.2).

Les jetons opaques ne sont pas pris en charge en v1 (pas d'introspection) : un fournisseur qui en
émet passe par `proxy`. Un jeton d'identité n'est jamais accepté à la place d'un jeton d'accès.

### Vérification de chaque requête

Dans tous les modes : signature, `iss`, `aud` (égal à `OAUTH_AUDIENCE`, par défaut `MCP_PUBLIC_URL`
sous sa forme canonique), expiration, puis identité autorisée.

- `OAUTH_ALLOWED_SUBJECTS` liste les `sub` de `OAUTH_ISSUER`. Le couple `(iss, sub)` est
  l'identifiant de référence.
- `OAUTH_ALLOWED_EMAILS` est un mécanisme distinct, facultatif : comparaison exacte de l'adresse,
  avec `email_verified` vrai obligatoire. Une adresse pouvant changer ou être réattribuée, ce
  mécanisme est déconseillé dans la documentation.
- Refus de démarrer si les deux listes sont vides.
- `401` avec `WWW-Authenticate` conforme pour un jeton absent, invalide ou expiré ; `403` pour une
  identité authentifiée mais non autorisée.

### Contrat du mode `proxy`

- **Émetteurs distincts** : `MCP_PUBLIC_URL` pour les jetons du proxy, `OAUTH_ISSUER` pour le
  fournisseur amont. Le proxy publie ses métadonnées et inclut `iss` dans ses réponses
  d'autorisation (RFC 9207).
- **Enregistrement** : enregistrement dynamique, limité aux URL de `OAUTH_ALLOWED_REDIRECT_URIS`
  (liste obligatoire, comparaison exacte ; seule exception, le port des URL `http` de boucle locale `127.0.0.1`, `[::1]` et `localhost` peut varier, RFC 8252 §7.3). Avec `OAUTH_STATE_FILE`, un client enregistré survit au redémarrage tant qu'une de ses URL de retour reste dans la liste ; une URL retirée de la liste n'est plus acceptée. CIMD est ajouté si un client de la matrice l'exige.
- **Consentement** : page de consentement par `client_id`, affichée par le proxy avant la
  redirection vers le fournisseur, indiquant le nom du client et l'URL de retour.
- **État** : `state` aléatoire, à usage unique, valable 10 minutes, lié au navigateur et à la
  demande. Un état absent, expiré ou déjà utilisé est refusé.
- **Codes d'autorisation** : usage unique, 60 secondes, liés au client, à l'URL de retour, au défi
  PKCE et à `resource`. PKCE S256 obligatoire des deux côtés.
- **Jetons** : accès d'une heure, signé avec `OAUTH_SIGNING_KEY_FILE`, identifié par `kid`.
  Renouvellement avec rotation : un jeton de renouvellement réutilisé révoque la série.
- **Stockage** : une seule instance. Sans `OAUTH_STATE_FILE`, tout est en mémoire : après un
  redémarrage, les jetons d'accès restent valides jusqu'à expiration ; clients, flux en cours et
  jetons de renouvellement sont perdus, et l'endpoint de jeton répond `401 invalid_client` pour un
  client inconnu afin de provoquer un nouvel enregistrement, puis une nouvelle autorisation. Avec
  `OAUTH_STATE_FILE` (F-019), les clients enregistrés et les séries de renouvellement sont
  conservés dans un fichier SQLite privé (`0600`, système de fichiers local, verrou exclusif) ;
  consentements, flux amont, codes d'autorisation et caches de découverte restent en mémoire. Le
  fichier ne contient aucun jeton amont ni secret en clair ; il se traite comme un magasin de
  secrets.
- **Rotation de clé** : remplacer le fichier invalide les jetons en cours ; les clients se
  réautorisent. Comportement accepté en v1.

Variables : `OAUTH_MODE`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_ALLOWED_SUBJECTS`,
`OAUTH_ALLOWED_EMAILS`, et en mode `proxy` : `OAUTH_UPSTREAM_CLIENT_ID`,
`OAUTH_UPSTREAM_CLIENT_SECRET(_FILE)`, `OAUTH_SIGNING_KEY_FILE`, `OAUTH_ALLOWED_REDIRECT_URIS`, et en option `OAUTH_STATE_FILE`.

Le jeton Infomaniak ne quitte jamais le serveur ; le jeton OAuth du client n'est jamais transmis à
Infomaniak.

## 9. Sécurité

Menace principale : **injection d'instructions** via le contenu des fichiers lus. Un document
piégé peut demander à l'assistant de partager, déplacer ou supprimer.

Mesures :

- niveaux cumulatifs `read` < `write` < `share`, `read` par défaut ;
- partage désactivé par défaut, liens publics et domaines e-mail sous liste blanche ;
- corbeille uniquement, pas de suppression définitive ;
- politique appliquée côté serveur sur tous les éléments affectés (§10.4) ;
- destinataires et liens de partage invisibles sous le niveau `share`, pour qu'un document piégé
  ne puisse pas les faire recopier ;
- contenu renvoyé signalé comme donnée non fiable dans la description des outils ;
- journal d'audit de toutes les opérations d'écriture et de partage (horodatage, sujet OAuth ou
  `stdio` en mode local, outil, drive, identifiants, résultat), sans contenu ni secret. Si
  l'écriture du journal échoue, l'opération d'écriture ou de partage est refusée avant d'être
  exécutée ;
- mode HTTP : validation de l'en-tête `Origin`, écoute sur `127.0.0.1` par défaut derrière le
  reverse proxy, limitation de débit par sujet, taille de requête plafonnée ;
- aucun secret dans les journaux ni dans les messages d'erreur renvoyés au client ;
- `SECURITY.md` avec procédure de signalement.

## 10. Politique d'arborescence

### 10.1 Principe

Les outils manipulent des identifiants ; le filtrage doit remonter jusqu'à une racine autorisée.

- `policy.check(operation)` récupère l'ascendance des éléments affectés, vérifie qu'un ancêtre
  appartient aux racines autorisées de ce drive et qu'aucun chemin actuel ou résultant ne correspond
  à un motif interdit.
- **Aucun cache d'ascendance** : la vérification d'un élément coûte un appel et le filtrage d'une
  liste aucun (§10.2). Chaque décision repose sur une réponse fraîche de l'API, ce qui couvre aussi
  les déplacements faits depuis un autre client.
- Résultats de `list`, `search`, `recents`, `my_shared`, `shared_with_me` filtrés de la même façon.
- Racines désignables par chemin dans la configuration, résolues en identifiants au démarrage ;
  échec de démarrage si une racine est introuvable. La racine reste ensuite attachée à son
  identifiant : si le dossier est déplacé ou renommé, l'autorisation le suit jusqu'au prochain
  démarrage.
- En cas de doute (réponse incomplète, ascendance non établie, plafond atteint), l'opération est
  refusée.

### 10.2 Obtention de l'ascendance

Mesuré (`docs/api-notes.md`) : `with=parents` renvoie les dossiers ancêtres avec leur
identifiant, sans la racine (identifiant 1), et `with=path` le chemin complet. Les deux
fonctionnent sur les métadonnées, les listes et la recherche.

- Vérification d'un élément : un seul appel `files/{id}?with=path,parents`.
- Filtrage d'un résultat de liste ou de recherche : `with=path,parents` sur la requête, sans
  appel supplémentaire.
- Une racine autorisée d'identifiant 1 équivaut au drive entier et se traite à part.
- Une racine correspond si son identifiant est celui de l'élément ou figure dans `parents`. Les
  motifs interdits s'appliquent à `path`.

### 10.3 Partagés avec moi, dossiers communs

- **Partages reçus** : listés par `GET /3/drive/files/shared_with_me`. Chaque élément porte le
  `drive_id` du propriétaire, un drive de rôle `external` (`/2/drive/init`), et se lit avec les
  endpoints habituels sur ce drive. Ils forment une voie d'autorisation distincte, qui ne dépend
  ni de `KDRIVE_IDS` ni de `KDRIVE_MCP_ROOTS`. Conséquences :
  - **désactivés par défaut** : avec `KDRIVE_MCP_SHARED_WITH_ME=0`, aucun outil ne les liste ni n'y
    accède. Une configuration limitée à un dossier ne donne ainsi aucun accès externe implicite ;
  - un drive `external` n'est **jamais** traité comme un drive configuré : `KDRIVE_IDS` n'accepte
    que les rôles `admin` et assimilés, et le serveur refuse de démarrer sinon ;
  - l'accès à un drive `external` n'est possible que pour un élément partagé ou l'un de ses
    descendants. Connaître un identifiant ne suffit pas : l'appartenance est établie avant de
    renvoyer du contenu. Comme `parents` ne remonte pas chez le propriétaire, la vérification part
    de la liste des partages reçus et, si `parents` des enfants ne suffit pas, remonte par
    `parent_id` jusqu'à un élément partagé. À confirmer au jalon 0.1 ;
  - la liste des partages reçus est le seul cache de la politique : 60 secondes au plus pour les
    lectures, rechargée pour toute écriture ;
  - **lecture seule par défaut**, car le jeton a réellement les droits d'écriture du partage
    (`can_write`) sur le dossier d'une autre personne. L'écriture exige à la fois
    `KDRIVE_MCP_SHARED_WRITE=1` et un `KDRIVE_MCP_MODE` d'au moins `write` : cette option ne fait
    jamais écrire en mode `read` ;
  - les outils de partage (`kdrive_share_link`, `kdrive_share_access`) sont refusés sur ces
    éléments en v1 ;
  - `search` et `list` sur la racine d'un drive `external` sont interdits : on passe par
    `kdrive_shared_with_me` puis les dossiers partagés ;
  - les motifs interdits s'appliquent au chemin vu du destinataire (`/Shared/<nom>/…`), le seul
    que l'API expose.
- **Partages émis** : `kdrive_my_shared`, soumis aux racines et motifs comme tout élément du drive.
- **Dossiers communs** : dossiers ordinaires sous la racine, `visibility: is_team_space` (espace
  privé : `is_private_space`). Soumis aux racines et motifs comme les autres. Option à évaluer :
  filtrer par `visibility`.

### 10.4 Effets sur les chemins et les descendants

L'autorisation porte sur les effets de l'opération, pas seulement sur l'identifiant ciblé.

| Opération | Contrôle |
|---|---|
| création, dépôt | destination autorisée ; chemin résultant (dossier + nom) hors motifs interdits |
| renommage, déplacement d'un fichier | chemins actuel et résultant autorisés |
| renommage, déplacement, corbeille d'un dossier | idem, et aucun descendant ne correspond à un motif interdit, avant ou après l'opération |
| restauration | §10.5 |
| partage d'un fichier | chemin actuel autorisé |
| partage d'un dossier | chemin actuel autorisé, et aucun motif interdit ne peut concerner son contenu |

Si `KDRIVE_MCP_DENY` est vide, aucun parcours de descendants n'est nécessaire. Sinon, le parcours
s'arrête à `KDRIVE_MCP_MAX_TREE_ITEMS` et l'opération est refusée : on ne valide jamais une partie
de l'arborescence.

Un lien ou une invitation donne ensuite accès par kDrive, sans repasser par le serveur : inspecter
le contenu au moment du partage ne protège pas les fichiers ajoutés plus tard. La règle est donc
statique. On prend le préfixe littéral du motif, jusqu'au premier caractère générique ; le motif
concerne le dossier si ce préfixe et le chemin du dossier sont l'un préfixe de l'autre. Un préfixe
vide concerne tout : avec `**/.ssh/**`, aucun dossier ne peut être partagé. Ce refus large est
voulu en v1, et le README le signale.

### 10.5 Restauration

La destination ne suffit pas : un fichier supprimé d'un emplacement interdit pourrait être restauré
dans un dossier autorisé, puis lu.

- Vérifier d'abord que l'élément en corbeille appartenait au périmètre autorisé, puis la
  destination et le chemin résultant, descendants compris pour un dossier.
- Si les métadonnées de la corbeille ne permettent pas d'établir cette appartenance, la restauration
  est refusée. Aucune preuve n'est conservée côté serveur.
- `kdrive_restore` n'est livré qu'après mesure de ces métadonnées (§13).

### 10.6 Limite de la garantie

Toute vérification précède l'opération. Sans mécanisme atomique fourni par l'API, un changement
peut intervenir entre les deux, depuis un autre client ou par une autre personne. Le serveur réduit
cette fenêtre en travaillant sur des réponses fraîches, sans pouvoir la supprimer. Le README et
`SECURITY.md` le disent. Une éventuelle capacité de l'API limitant cette course sera utilisée (§13).

### 10.7 Critères d'acceptation de la politique

- Une configuration limitée à un dossier ne donne aucun accès externe implicite.
- Un identifiant connu d'un drive `external`, hors partage autorisé, est refusé.
- Partager ou mettre à la corbeille un parent contenant un descendant interdit est refusé.
- Créations, renommages et déplacements ne permettent pas de contourner les motifs interdits.
- Connaître l'identifiant d'un fichier supprimé hors périmètre ne permet pas de le restaurer dans
  une racine autorisée.
- Un fichier déplacé hors périmètre par un autre client est refusé dès l'appel suivant.
- Le mode `read` n'écrit jamais, quelles que soient les autres options.
- Outils et ressources MCP donnent les mêmes décisions.

Ces critères orientent la conception de la politique dès le jalon 0.1, même si les outils
correspondants arrivent plus tard.

## 11. Distribution et qualité

- npm : paquet public `kdrive-mcp-server`, binaire `kdrive-mcp-server`, Node LTS.
- Docker : image multi-architecture (amd64, arm64) sur GHCR, utilisateur non root, mode HTTP.
- `examples/` : `compose.yaml` générique avec Traefik, configuration YAML commentée, exemples
  de configuration Claude Code, Claude Desktop et claude.ai. Aucun domaine ni hôte réel.
- Tests : `vitest`, client kDrive simulé ; tests dédiés de la politique (critères du §10.7,
  pagination filtrée), de l'écriture (collision, réponse perdue après une écriture réussie), de
  l'extraction (plafond de décompression, sortie tronquée, continuation après modification, PDF
  sans texte) et de l'authentification (jeton absent, invalide ou expiré, mauvaise audience, jeton
  d'identité présenté comme jeton d'accès, identité non autorisée). En mode `proxy` : consentement
  par client, URL de retour modifiée, code réutilisé, état expiré ou invalide, expiration des
  jetons, redémarrage.
- CI GitHub Actions : lint, typecheck, tests, build ; publication npm et GHCR sur tag, versions
  sémantiques (semantic-release, comme le dépôt Infomaniak).
- Documentation : README (installation, configuration, connexion de chaque client), SECURITY.md,
  CHANGELOG, NOTICE (attribution Infomaniak), mention « non officiel ».

## 12. Jalons

| Version | Contenu |
|---|---|
| 0.0 | mesures sur l'API réelle : faites pour la lecture (`docs/api-notes.md`), restes au §13 |
| 0.1 | stdio, outils de lecture, politique (racines, motifs, drives, partages reçus, §10.7), tests |
| 0.2 | prérequis : test d'un vrai jeton du fournisseur retenu (§8). Mode HTTP, OAuth (`delegate`, `delegate-static`), image Docker ; le mode `proxy` passe ici si ce test échoue |
| 0.3 | extraction de contenu (`kdrive_read`) |
| 0.4 | prérequis : mesures d'écriture (§13). Outils d'écriture, journal d'audit |
| 0.5 | outils de partage (désactivés par défaut), mode OAuth `proxy` s'il n'est pas déjà livré |
| 1.0 | stabilisation, documentation complète, matrice de compatibilité, publication |

## 13. Points encore ouverts

Les mesures en lecture sont faites (`docs/api-notes.md`). Restent :

1. Partages reçus : `parents` des enfants d'un partage et périmètre de la recherche sur un drive
   `external` (§10.3).
2. Portées des jetons Infomaniak : lecture seule ou restriction à un drive possibles ? Mesuré :
   un jeton `drive` atteint tous les drives du compte, y compris les drives `external` ; documenter que la politique du serveur
   est la seule barrière si aucune portée plus fine n'existe.
3. Méthodes HTTP exactes des écritures (client officiel), à tester sur un dossier dédié.
4. `cursor` au-delà de 1000 éléments, tailles maximales de téléchargement et de dépôt.
5. Limites de débit : aucun en-tête ni 429 observé ; reprise prévue au §6.
6. Collision de dépôt : comportement de `POST /3/drive/{drive_id}/upload` sur un nom existant,
   existence d'un refus atomique. Le client officiel n'envoie aucun paramètre de conflit (§6).
7. Corbeille : métadonnées disponibles sur un élément supprimé, notamment son ancien chemin (§10.5).
8. Capacités de l'API limitant la course entre contrôle et opération (§10.6).
9. `Etag` : stabilité entre deux téléchargements et changement à la modification du fichier (§7).
10. Fournisseur OIDC retenu : prise en compte de `resource`, format et `aud` du jeton d'accès (§8).

Le nom `kdrive-mcp-server` est retenu ; vérifier avant publication qu'il reste libre sur npm.
Un dépôt GitHub tiers porte déjà un nom proche (1 résultat de recherche au 31/10/2026) : le
consulter pour éviter la confusion.

## 14. Sources

Consultées le 31/10/2026, sauf 9 (consultée le 01/11/2026) et 10 à 12, 15 à 17 : références
normatives citées sans relecture, à vérifier par l'agent de développement.

1. Registre npm, disponibilité des noms : `https://registry.npmjs.org/kdrive-mcp-server` (404),
   `https://registry.npmjs.org/kdrive-mcp` (pris).
2. Serveur MCP kDrive officiel d'Infomaniak, README et sources (`src/index.ts`,
   `src/kdrive-client.ts`, `package.json`, v1.2.0) :
   https://github.com/Infomaniak/mcp-server-kdrive
3. Paquet npm correspondant : https://www.npmjs.com/package/@infomaniak/mcp-server-kdrive
4. Autres serveurs MCP publiés par Infomaniak (mail, calendar, kchat, contact), recherche GitHub
   `org:Infomaniak mcp` : https://github.com/Infomaniak
5. Portail développeur Infomaniak, « Get files in directory » (paramètre `with`) :
   https://developer.infomaniak.com/docs/api/get/3/drive/%7Bdrive_id%7D/files/%7Bfile_id%7D/files
6. Page de création des jetons API Infomaniak (portée `drive`, citée par le README officiel) :
   https://manager.infomaniak.com/v3/ng/accounts/token/list
7. Anthropic, « Building custom connectors via remote MCP servers » (enregistrement dynamique,
   client ID et secret, URL de retour) :
   https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
8. Anthropic, documentation des connecteurs personnalisés : https://claude.com/docs/connectors/custom
9. Spécification MCP, autorisation, version du 28/07/2026 :
   https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
10. RFC 7591, OAuth 2.0 Dynamic Client Registration : https://www.rfc-editor.org/rfc/rfc7591
11. RFC 9728, OAuth 2.0 Protected Resource Metadata : https://www.rfc-editor.org/rfc/rfc9728
12. RFC 6749, OAuth 2.0 (erreur `invalid_client`) : https://www.rfc-editor.org/rfc/rfc6749
13. Serveurs MCP communautaires pour kDrive, écartés (locaux, peu diffusés) :
    https://www.pkgstats.com/pkg:kdrive-mcp,
    https://www.remoteopenclaw.com/mcp/henrikogaard/infomaniak-mcp,
    https://claudemarketplaces.com/mcp/mogacode-ma/infomaniak-mcp-agent
14. Exemple de serveur MCP distant avec OAuth (référence d'implémentation) :
    https://github.com/NapthaAI/http-oauth-mcp-server
15. RFC 8707, Resource Indicators for OAuth 2.0 : https://www.rfc-editor.org/rfc/rfc8707
16. Recommandations de sécurité MCP :
    https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
17. OpenID Connect Core 1.0 (stabilité des identifiants, `email_verified`) :
    https://openid.net/specs/openid-connect-core-1_0.html
