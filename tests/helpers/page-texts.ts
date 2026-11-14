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
      "Serveur MCP non officiel pour kDrive, non affili\u00e9 \u00e0 Infomaniak.",
    sourceLink: "Code source sur GitHub",
    languageNav: "Langue",
    consentTitle: "Autoriser l'acc\u00e8s",
    consentIntro:
      "Une application demande \u00e0 se connecter \u00e0 ce kdrive-mcp-server. Ce serveur donne \u00e0 des clients MCP, tels que des assistants d'IA, acc\u00e8s \u00e0 des fichiers dans kDrive, dans la limite des dossiers et du mode configur\u00e9s par son op\u00e9rateur. N'approuvez que si vous avez vous-m\u00eame lanc\u00e9 cette connexion et reconnaissez le client ci-dessous.",
    requestDetails: "D\u00e9tails de la demande",
    clientIdLabel: "Identifiant du client\u00a0:",
    clientHostLabel: "H\u00f4te du client\u00a0:",
    clientNameLabel: "Nom du client\u00a0:",
    unnamedClient: "client sans nom",
    selfDeclaredSuffix:
      "(d\u00e9clar\u00e9 par le client, non v\u00e9rifi\u00e9)",
    metadataNotice:
      "Ce nom provient du document de m\u00e9tadonn\u00e9es du client et n'est pas v\u00e9rifi\u00e9.",
    loopbackLine:
      "Ce client redirige uniquement vers cet ordinateur (boucle locale).",
    selfDeclaredNotice:
      "Le nom du client est d\u00e9clar\u00e9 par le client lui-m\u00eame et n'est pas v\u00e9rifi\u00e9.",
    redirectUriLabel: "URI de redirection\u00a0:",
    resourceLabel: "Ressource prot\u00e9g\u00e9e\u00a0:",
    approve: "Approuver",
    deny: "Refuser",
    consentNote:
      "Approuver vous am\u00e8ne \u00e0 vous connecter avec votre compte. Le client n'obtient l'acc\u00e8s qu'apr\u00e8s cette connexion. Refuser vous ram\u00e8ne au client sans lui donner acc\u00e8s. Saisissez votre mot de passe uniquement sur la page de connexion de votre fournisseur d'identit\u00e9, jamais sur cette page.",
    errorTitle: "Erreur d'autorisation",
    error: {
      invalid_request: "La demande d'autorisation n'est pas valide.",
      consent:
        "Cette demande de consentement est inconnue, a expir\u00e9 ou a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9e.",
      callback:
        "Cette r\u00e9ponse de connexion est inconnue, a expir\u00e9 ou a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9e.",
      busy: "Trop de demandes d'autorisation sont en attente. R\u00e9essayez plus tard.",
    },
    errorNote:
      "Cette demande n'a pas abouti. Si votre application n'est pas connect\u00e9e, revenez-y et relancez la connexion.",
  },
};

/** The language names of the switcher, each in its own language (BR-408). */
export const NAMES: Record<PageLanguage, string> = {
  en: "English",
  fr: "Fran\u00e7ais",
};

export const OTHER: Record<PageLanguage, PageLanguage> = { en: "fr", fr: "en" };
