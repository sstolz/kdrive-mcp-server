# Revue de la spécification kdrive-mcp-server

Date : 1 novembre 2026. Version examinée : brouillon v0.3 du 31 octobre 2026.

Le projet est réalisable. La spécification doit toutefois préciser plusieurs règles pour que
les restrictions d’accès soient effectivement garanties. Les décisions prioritaires portent
sur les partages reçus, les opérations affectant une arborescence, la restauration et la
validité des autorisations mises en cache.

Cette revue concerne [SPEC.md](../SPEC.md) et s’appuie sur les observations consignées dans
[les notes API](api-notes.md). Les scénarios décrits sont des conséquences possibles des règles
actuelles ; ils ne constituent pas des vulnérabilités démontrées sur une implémentation.
Les corrections ci-dessous sont des propositions à intégrer à la spécification.

## Priorités de correction

| Remarque | Priorité | Décision attendue avant |
|---|---|---|
| 1. Périmètre des partages reçus | Haute | La politique du jalon 0.1 |
| 2. Effets sur les descendants et les chemins | Haute | La conception de la politique ; validation aux jalons 0.4 et 0.5 |
| 3. Autorisation des restaurations | Haute | Le jalon 0.4 |
| 4. Cache et modifications concurrentes | Haute | Le jalon 0.1 |
| 5. Compatibilité des fournisseurs OIDC | Haute | Le jalon 0.2 |
| 6. Contrat du proxy OAuth | Haute | Le jalon 0.5 |
| 7. Écrasement et répétition des écritures | Haute | Le jalon 0.4 |
| 8. Limites et pagination de l’extraction | Moyenne | Le jalon 0.3 |

## 1 Périmètre des partages reçus

Sections concernées : §4, §5 et §10.3 de [SPEC.md](../SPEC.md).

Le §5 refuse tout appel sur un drive absent de `KDRIVE_IDS`. Le §10.3 exige pourtant de lire
des éléments de drives `external`, qui ne peuvent pas figurer dans cette liste. Ces deux
règles nécessitent une exception explicitement définie.

Par ailleurs, `KDRIVE_MCP_SHARED_WITH_ME=1` par défaut expose les partages reçus en plus des
drives et racines configurés. Une configuration limitée à un dossier personnel ne limite donc
pas nécessairement l’ensemble des données accessibles à ce dossier.

**Correction proposée :** distinguer deux voies d’autorisation :

- les éléments des drives configurés, soumis aux racines et aux exclusions ;
- les éléments partagés autorisés et leurs descendants, soumis à une politique distincte.

La seconde voie devrait être activée explicitement, ou limitée par une liste de couples
`drive_id` et identifiant d’élément partagé. L’appartenance au partage doit être établie avant
de retourner du contenu. L’option d’écriture dans les partages doit rester subordonnée au
niveau global : elle ne doit jamais transformer le mode `read` en mode d’écriture.

**Validation attendue :** une configuration limitée à un dossier ne donne aucun accès externe
implicite. Un identifiant externe connu ne suffit pas à autoriser sa lecture. L’ascendance des
enfants d’un partage doit être confirmée sur l’API réelle, comme prévu dans les notes API.

## 2 Effets sur les descendants et les chemins

Sections concernées : §6, §9 et §10.1–10.2 de [SPEC.md](../SPEC.md).

La politique vérifie l’identifiant ciblé et son chemin actuel. Cette vérification ne couvre
pas tous les effets d’une opération sur un dossier.

Par exemple, si `/Projet/Confidentiel` est interdit, autoriser le partage de `/Projet` peut
exposer ce sous-dossier. Mettre `/Projet` à la corbeille l’affecte également. Un renommage ou
un déplacement du parent peut modifier les chemins servant à appliquer les exclusions.
De même, contrôler seulement le dossier de destination ne vérifie pas le chemin final d’un
fichier créé, déplacé ou renommé.

**Correction proposée :** définir l’autorisation selon les effets de l’opération :

- contrôler les chemins actuels et résultants des éléments affectés ;
- traiter explicitement les descendants pour les opérations sur un dossier ;
- refuser une opération lorsque son périmètre ne peut pas être vérifié dans les limites
  prévues, plutôt que valider seulement une partie de l’arborescence ;
- appliquer la même politique aux outils et aux ressources MCP.

Le partage demande une règle supplémentaire : le lien ou l’invitation donne accès via kDrive,
sans repasser par le filtre MCP à chaque lecture. Une inspection des descendants au moment du
partage ne protège donc pas les futurs fichiers ajoutés. Une règle simple pour la v1 serait
de refuser le partage d’un dossier lorsque des exclusions peuvent concerner son contenu.

**Validation attendue :** partager ou mettre à la corbeille un parent contenant un descendant
interdit est refusé. Les créations, renommages et déplacements ne permettent pas de contourner
les exclusions en changeant les chemins.

## 3 Autorisation des restaurations

Sections concernées : §6, §9 et §10 de [SPEC.md](../SPEC.md).

La description de `kdrive_restore` exige explicitement de vérifier la destination. Elle ne
définit pas comment établir que l’élément supprimé appartient lui-même au périmètre autorisé.
La règle générale de vérification des identifiants ne suffit pas à définir ce cas particulier.

Un fichier provenant d’un emplacement interdit pourrait ainsi être restauré dans un dossier
autorisé, puis lu, si l’implémentation ne contrôle que la destination.

**Correction proposée :** vérifier l’autorisation de la source dans la corbeille, puis celle
de la destination et du chemin résultant. Mesurer les métadonnées disponibles sur les éléments
supprimés. Si elles ne permettent pas d’établir cette autorisation, refuser la restauration.

Une alternative serait de limiter la restauration aux éléments mis à la corbeille par le
serveur, avec une preuve persistante suffisante. Ce choix ajouterait un besoin de stockage et
devrait préciser comment les changements de politique affectent les restaurations.

**Validation attendue :** connaître l’identifiant d’un fichier supprimé hors périmètre ne
permet pas de le restaurer dans une racine autorisée.

## 4 Cache et modifications concurrentes

Sections concernées : §10.1 et §10.3 de [SPEC.md](../SPEC.md).

Le cache d’ascendance est invalidé après les mutations effectuées par le serveur. Il ne peut
pas être invalidé de cette manière après un déplacement réalisé depuis l’interface kDrive,
un autre client ou par un autre utilisateur.

Un fichier déplacé hors d’une racine autorisée peut donc rester considéré comme accessible
jusqu’à l’expiration du cache. La mise en cache des partages reçus pose une question similaire
lorsque leurs droits ou leur contenu évoluent.

**Correction proposée :** préciser la durée maximale de validité des données mises en cache
et les opérations exigeant une vérification fraîche. Pour les mutations du serveur,
l’invalidation doit couvrir les descendants affectés par un déplacement ou un renommage.
Un cache utilisé pour accélérer la navigation ne devrait pas, à lui seul, constituer une
preuve d’autorisation pour une opération sensible.

Même avec une vérification fraîche, un changement peut intervenir entre le contrôle et
l’opération. Sans mécanisme atomique fourni par l’API, cette course ne peut pas être éliminée
par le serveur seul. La spécification doit décrire cette limite de garantie.

Il faut aussi choisir si une racine configurée par chemin, puis résolue en identifiant, suit
le dossier lorsqu’il est déplacé ou reste attachée à l’emplacement initial.

**Validation attendue :** tester un déplacement hors périmètre effectué par un autre client,
ainsi qu’un renommage de parent. Le comportement observé doit respecter la règle de fraîcheur
retenue.

## 5 Compatibilité des fournisseurs OIDC

Section concernée : §8 de [SPEC.md](../SPEC.md).

Les modes délégués supposent des jetons d’accès dont le serveur peut vérifier la signature,
l’émetteur, l’audience et l’expiration. Prendre en charge OIDC ou l’enregistrement dynamique
ne garantit pas à lui seul qu’un fournisseur délivre un jeton d’accès utilisable pour cette
ressource MCP. La compatibilité doit donc être décrite par capacités et par mode.

MCP impose de valider que le jeton d’accès est destiné au serveur concerné.
[Spécification d’autorisation MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

**Correction proposée :** définir les exigences de chaque mode : découverte des métadonnées,
enregistrement du client, PKCE, audience et validation des jetons. Distinguer les jetons
d’identité des jetons d’accès ; indiquer si les jetons opaques sont pris en charge par
introspection ou exclus du périmètre initial.

La liste des personnes autorisées doit également avoir une sémantique précise. Le couple
`(iss, sub)` constitue l’identifiant stable défini par OIDC. L’e-mail peut changer ou être
réattribué ; s’il reste accepté pour l’autorisation, prévoir un mode distinct exigeant une
adresse vérifiée et une politique explicite de correspondance.
[Stabilité des identifiants OIDC](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability),
[attributs standards OIDC](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims)

**Validation attendue :** tester chaque mode avec un fournisseur répondant à ses exigences,
ainsi que les refus de jeton destiné à une autre audience, de jeton d’identité utilisé à la
place d’un jeton d’accès et d’utilisateur non autorisé.

## 6 Contrat du proxy OAuth

Sections concernées : §2, §8 et §12 de [SPEC.md](../SPEC.md).

Le mode `proxy` expose des endpoints d’autorisation et émet ses propres jetons. Il exerce donc
des fonctions de serveur d’autorisation, même si l’authentification des personnes est déléguée.
La mention « serveur d’autorisation OAuth complet » hors périmètre doit préciser les fonctions
effectivement conservées dans le proxy.

**Correction proposée :** compléter le contrat du proxy avec :

- le consentement associé à chaque client MCP ;
- la validation exacte des URL de retour et la protection contre les requêtes forgées ;
- les codes d’autorisation à usage unique, liés au client, à la redirection et à PKCE ;
- le stockage de l’état, sa durée de vie et le comportement après redémarrage ;
- les durées de vie des jetons, la rotation des clés et la stratégie de renouvellement ;
- la distinction entre l’émetteur OIDC amont et l’émetteur des jetons du proxy.

Les recommandations MCP décrivent notamment les contrôles de consentement par client,
de redirection et d’état nécessaires pour éviter qu’un client obtienne une autorisation
indue à travers un proxy.
[Recommandations de sécurité MCP](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

Le choix des modes doit également intégrer les *Client ID Metadata Documents* (CIMD).
La version MCP du 28 juillet 2026 recommande leur prise en charge et conserve l’enregistrement
dynamique comme mécanisme de compatibilité déprécié. La capacité d’enregistrement dynamique
ne devrait donc pas être le seul critère distinguant les modes. Fixer une version de référence
du protocole et une matrice de compatibilité des clients rendrait l’exigence vérifiable.
[Spécification d’autorisation MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

**Validation attendue :** tester le consentement par client, le rejet d’une redirection
modifiée, la réutilisation d’un code et un état expiré ou invalide. Définir puis tester le
comportement à l’expiration des jetons et au redémarrage du serveur.

## 7 Écrasement et répétition des écritures

Sections concernées : §6 et §13 de [SPEC.md](../SPEC.md).

La promesse de ne pas écraser un fichier sans `overwrite: true` ne peut pas reposer uniquement
sur une recherche préalable. Un autre client peut créer le fichier entre cette recherche
et le dépôt.

**Correction proposée :** mesurer le comportement de l’API en cas de collision et rechercher
un mécanisme atomique de refus d’écrasement. Si ce mécanisme manque, définir une stratégie
compatible avec la garantie annoncée ou réduire explicitement cette garantie avant de
proposer l’opération.

La politique de reprise doit distinguer lectures et écritures. Une réponse perdue après une
création ou une invitation ne signifie pas que l’opération a échoué. Répéter aveuglément la
requête peut produire un doublon ou répéter une action. Définir les opérations réessayables,
les mécanismes d’idempotence disponibles et la réponse en cas de résultat incertain.

**Validation attendue :** tester une création concurrente portant le même nom et une réponse
perdue après une écriture réussie. Aucun écrasement ni doublon ne doit être masqué par la
gestion des erreurs.

## 8 Limites et pagination de l’extraction

Sections concernées : §4 et §7 de [SPEC.md](../SPEC.md).

Les limites actuelles mélangent octets lus, pages, caractères retournés et `offset`. Une
tranche d’octets ne correspond pas nécessairement à une partie exploitable d’un PDF ou d’un
document bureautique. Un petit fichier compressé peut également produire beaucoup de données
décompressées ; sa taille téléchargée ne borne pas le coût de l’extraction.

**Correction proposée :** séparer les plafonds de téléchargement, de décompression, de durée
de traitement et de sortie. Préciser si les limites sont appliquées par appel ou par document,
et inclure le coût du base64 et du décodage des images dans les limites pertinentes.

Définir la signification de `offset` pour chaque type de résultat, ou fournir un curseur de
continuation. Une continuation doit être liée à une version du fichier pour éviter de mélanger
deux versions entre les appels. Les notes API signalent un `Etag` sur les téléchargements ;
son utilisation pour ce contrôle reste à valider. Sans cache de contenu, préciser le coût
éventuel d’un nouveau téléchargement et d’une nouvelle extraction à chaque continuation.

Le comportement des PDF scannés doit être explicite : l’extraction de texte ne constitue pas
une reconnaissance optique de caractères. Ajouter l’OCR nécessiterait un périmètre distinct.

**Validation attendue :** couvrir un document dépassant les limites de décompression, une
sortie tronquée, une continuation après modification du fichier et un PDF sans texte
extractible.

## Précisions complémentaires

| Sujet | Point à fixer dans la spécification |
|---|---|
| Pagination filtrée | Une page vide après filtrage ne signifie pas nécessairement la fin. Définir le curseur, les limites d’appels amont et le signal de continuation. |
| Recherche sur plusieurs racines | Définir la fusion des résultats, la suppression des doublons et la continuation entre les racines. |
| Racines partiellement configurées | Préciser le sort d’un drive autorisé sans racine renseignée lorsque d’autres drives ont des racines explicites. Éviter une ouverture implicite de ce drive entier. |
| Domaines d’invitation | Une liste absente ou vide devrait interdire les invitations. Définir la comparaison des domaines et le traitement des sous-domaines. |
| Journal d’audit | Définir une destination par défaut, par exemple `stderr`, l’identité utilisée en stdio et le comportement si l’écriture du journal échoue. |
| Erreurs OAuth | Distinguer un jeton absent ou invalide d’une identité authentifiée sans autorisation, au lieu de répondre systématiquement `401`. |

Pour les erreurs OAuth, MCP distingue notamment `401` pour l’authentification manquante ou
invalide et `403` pour les permissions insuffisantes.
[Gestion des erreurs MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#error-handling)

## Ordre de travail proposé

1. Fixer les invariants de la politique d’accès et transformer les scénarios 1 à 4 en critères
   d’acceptation avant de figer l’architecture de cette politique.
2. Compléter les mesures API sur les partages reçus, la corbeille, les collisions de dépôt
   et les capacités permettant de limiter les courses entre contrôle et opération.
3. Définir les capacités requises des fournisseurs OAuth avant le jalon HTTP, puis détailler
   séparément le proxy avant son implémentation.
4. Formaliser les contrats de pagination, d’extraction et d’erreur avant les outils concernés.

Les jalons existants peuvent être conservés. Les cas de restauration et de partage doivent
néanmoins influencer la conception initiale de la politique, même si les outils correspondants
arrivent plus tard.
