// F-031 (#31): the expected fixed texts of the proxy pages, per language
// (spec "French texts" table). Non-ASCII characters are written as \u
// escapes: U+00A0 is the no-break space before a colon.
import type { ErrorPage } from "../../src/auth/proxy/pages.js";

export type PageLanguage = "en" | "fr";

export interface PageTexts {
  productTagline: string;
  sourceLink: string;
  languageNav: string;
  consentTitle: string;
  consentIntro: string;
  requestDetails: string;
  clientIdLabel: string;
  clientHostLabel: string;
  clientNameLabel: string;
  unnamedClient: string;
  selfDeclaredSuffix: string;
  metadataNotice: string;
  loopbackLine: string;
  selfDeclaredNotice: string;
  redirectUriLabel: string;
  resourceLabel: string;
  approve: string;
  deny: string;
  consentNote: string;
  errorTitle: string;
  error: Record<ErrorPage, string>;
  errorNote: string;
}

export const TEXTS: Record<PageLanguage, PageTexts> = {
  en: {
    productTagline:
      "Unofficial MCP server for kDrive, not affiliated with Infomaniak.",
    sourceLink: "Source code on GitHub",
    languageNav: "Language",
    consentTitle: "Authorize access",
    consentIntro:
      "An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below.",
    requestDetails: "Request details",
    clientIdLabel: "Client ID:",
    clientHostLabel: "Client host:",
    clientNameLabel: "Client name:",
    unnamedClient: "unnamed client",
    selfDeclaredSuffix: "(self-declared, unverified)",
    metadataNotice:
      "This name comes from the client's metadata document and is unverified.",
    loopbackLine: "This client redirects to this computer only (loopback).",
    selfDeclaredNotice: "The client name is self-declared and unverified.",
    redirectUriLabel: "Redirect URI:",
    resourceLabel: "Protected resource:",
    approve: "Approve",
    deny: "Deny",
    consentNote:
      "Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. Enter your password only on your identity provider's sign-in page, never on this page.",
    errorTitle: "Authorization error",
    error: {
      invalid_request: "The authorization request is invalid.",
      consent: "This consent request is unknown, expired or already used.",
      callback: "This sign-in response is unknown, expired or already used.",
      busy: "Too many authorization requests are pending. Try again later.",
    },
    errorNote:
      "This request was not completed. If your application is not connected, return to it and start the connection again.",
  },
  fr: {
    productTagline:
      "Serveur MCP non officiel pour kDrive, non affilié à Infomaniak.",
    sourceLink: "Code source sur GitHub",
    languageNav: "Langue",
    consentTitle: "Autoriser l'accès",
    consentIntro:
      "Une application demande à se connecter à ce kdrive-mcp-server. Ce serveur donne à des clients MCP, tels que des assistants d'IA, accès à des fichiers dans kDrive, dans la limite des dossiers et du mode configurés par son opérateur. N'approuvez que si vous avez vous-même lancé cette connexion et reconnaissez le client ci-dessous.",
    requestDetails: "Détails de la demande",
    clientIdLabel: "Identifiant du client :",
    clientHostLabel: "Hôte du client :",
    clientNameLabel: "Nom du client :",
    unnamedClient: "client sans nom",
    selfDeclaredSuffix: "(déclaré par le client, non vérifié)",
    metadataNotice:
      "Ce nom provient du document de métadonnées du client et n'est pas vérifié.",
    loopbackLine:
      "Ce client redirige uniquement vers cet ordinateur (boucle locale).",
    selfDeclaredNotice:
      "Le nom du client est déclaré par le client lui-même et n'est pas vérifié.",
    redirectUriLabel: "URI de redirection :",
    resourceLabel: "Ressource protégée :",
    approve: "Approuver",
    deny: "Refuser",
    consentNote:
      "Approuver vous amène à vous connecter avec votre compte. Le client n'obtient l'accès qu'après cette connexion. Refuser vous ramène au client sans lui donner accès. Saisissez votre mot de passe uniquement sur la page de connexion de votre fournisseur d'identité, jamais sur cette page.",
    errorTitle: "Erreur d'autorisation",
    error: {
      invalid_request: "La demande d'autorisation n'est pas valide.",
      consent:
        "Cette demande de consentement est inconnue, a expiré ou a déjà été utilisée.",
      callback:
        "Cette réponse de connexion est inconnue, a expiré ou a déjà été utilisée.",
      busy: "Trop de demandes d'autorisation sont en attente. Réessayez plus tard.",
    },
    errorNote:
      "Cette demande n'a pas abouti. Si votre application n'est pas connectée, revenez-y et relancez la connexion.",
  },
};

/** The language names of the switcher, each in its own language (BR-408). */
export const NAMES: Record<PageLanguage, string> = {
  en: "English",
  fr: "Français",
};

export const OTHER: Record<PageLanguage, PageLanguage> = { en: "fr", fr: "en" };
